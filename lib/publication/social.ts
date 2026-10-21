import { instagramReadiness } from '@/lib/editor/container'
import type { SupabaseClient } from '@supabase/supabase-js'
import { socialAccessToken, socialConnection, SOCIAL_SCOPES, type SocialPlatform } from '@/lib/oauth/social'
import { downloadObject, signedReadUrl } from '@/lib/storage/server'
import { assertPublicationApproved, publicationApprovalKey, type ApprovalRecord } from './guard'
import { approvalStillValid, STALE_APPROVAL_MESSAGE } from './approval'

/**
 * Publishes an APPROVED job to Instagram (Reels) or TikTok (Direct Post). Server-only.
 * Order: job state → explicit approval record (guard) → connection with publish scope → upload.
 * Idempotent: a job with a published media id is never published again; an Instagram container
 * that is still processing is resumed on the next click instead of creating a new one.
 *
 * Instagram: POST graph.instagram.com/{ig-user}/media (REELS, public video_url) → poll status_code →
 *            POST /{ig-user}/media_publish. The video must be MP4 and reachable by Instagram: a
 *            short-lived signed URL of the private bucket is used.
 * TikTok: creator_info/query → video/init (FILE_UPLOAD, chunks) → PUT upload_url → status/fetch.
 *         Unaudited apps can only post with privacy SELF_ONLY. Interactions are OFF unless the owner allowed them, and the
 *         creator's own settings always win (Content Sharing Guidelines).
 */

export type SocialPayload = {
  videoAssetId?: string
  caption?: string
  /** TikTok privacy; must be one of the creator's allowed options and chosen by the owner (TikTok forbids a default). */
  privacyLevel?: 'SELF_ONLY' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'PUBLIC_TO_EVERYONE'
  /** TikTok commercial content disclosure: promoting the creator's own business («Tu marca»). */
  brandOrganic?: boolean
  /** TikTok commercial content disclosure: paid partnership («Contenido de marca»). Cannot be private. */
  brandContent?: boolean
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
  /** TikTok AI-generated content label. Default true for Cerebro content. */
  isAigc?: boolean
  /** Instagram: also show the Reel in the profile grid. */
  shareToFeed?: boolean
}

export type SocialJob = { id: string; owner_id: string; project_id: string; platform: string; status: string; idempotency_key: string | null; payload: SocialPayload; result: Record<string, unknown> | null }

export class SocialPublishError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function validateSocialPayload(platform: SocialPlatform, p: SocialPayload) {
  if (!p.videoAssetId) return 'Elige el vídeo que se va a publicar.'
  const caption = p.caption ?? ''
  if (platform === 'instagram' && caption.length > 2200) return 'Instagram admite hasta 2.200 caracteres en el texto.'
  if (platform === 'tiktok' && [...caption].length > 2200) return 'TikTok admite hasta 2.200 caracteres en el título.'
  if (platform === 'instagram' && (caption.match(/#/g) ?? []).length > 30) return 'Instagram admite como máximo 30 hashtags.'
  if (platform === 'tiktok') {
    if (!p.privacyLevel) return 'Elige quién puede ver el vídeo en TikTok (no hay opción por defecto).'
    if (p.brandContent && p.privacyLevel === 'SELF_ONLY') return 'El contenido de marca no puede publicarse en privado en TikTok.'
  }
  return null
}

export function socialApprovalKey(job: Pick<SocialJob, 'owner_id' | 'platform' | 'project_id' | 'idempotency_key'>) {
  if (!job.idempotency_key) throw new SocialPublishError('El trabajo no tiene clave de idempotencia.')
  return publicationApprovalKey({ ownerId: job.owner_id, platform: job.platform, projectId: job.project_id, idempotencyKey: job.idempotency_key })
}

async function videoAsset(db: SupabaseClient, ownerId: string, assetId: string) {
  const { data } = await db.from('assets').select('id,asset_type,storage_path,provenance').eq('id', assetId).eq('owner_id', ownerId).maybeSingle()
  const a = data as { asset_type: string; storage_path: string | null; provenance: Record<string, unknown> | null } | null
  if (!a?.storage_path || a.asset_type !== 'video') throw new SocialPublishError('El vídeo elegido no existe.', 404)
  const mime = typeof a.provenance?.mimeType === 'string' ? a.provenance.mimeType : a.storage_path.endsWith('.webm') ? 'video/webm' : 'video/mp4'
  const durationMs = typeof a.provenance?.durationMs === 'number' ? a.provenance.durationMs : null
  return { path: a.storage_path, mime, durationMs }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const igGraph = 'https://graph.instagram.com'

async function igJson(r: Response) {
  const j = await r.json().catch(() => ({})) as Record<string, unknown>
  if (!r.ok) throw new SocialPublishError(`Instagram: ${String((j.error as Record<string, unknown> | undefined)?.message ?? r.status)}`, 502)
  return j
}

async function publishInstagram(db: SupabaseClient, job: SocialJob, token: string, igUserId: string, writer: SupabaseClient = db) {
  let containerId = typeof job.result?.containerId === 'string' ? job.result.containerId : null
  if (!containerId) {
    const v = await videoAsset(db, job.owner_id, job.payload.videoAssetId!)
    const ready = instagramReadiness(v.mime)
    if (!ready.ok) throw new SocialPublishError(ready.reason ?? 'Este vídeo no es válido para Instagram.', 409)
    let signedUrl: string
    try { signedUrl = await signedReadUrl(db, job.owner_id, v.path, 3600) } catch { throw new SocialPublishError('No se pudo preparar el enlace temporal del vídeo.', 502) }
    const created = await igJson(await fetch(`${igGraph}/${encodeURIComponent(igUserId)}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ media_type: 'REELS', video_url: signedUrl, caption: job.payload.caption ?? '', share_to_feed: String(job.payload.shareToFeed !== false), access_token: token }),
    }))
    containerId = String(created.id ?? '')
    if (!containerId) throw new SocialPublishError('Instagram no devolvió un contenedor.', 502)
    await writer.from('publication_jobs').update({ result: { ...(job.result ?? {}), containerId }, updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', job.owner_id)
  }
  // Instagram processes the video asynchronously; wait up to ~4 minutes, then let the user resume.
  for (let i = 0; i < 24; i++) {
    const s = await igJson(await fetch(`${igGraph}/${encodeURIComponent(containerId)}?${new URLSearchParams({ fields: 'status_code,status', access_token: token })}`))
    const code = String(s.status_code ?? '')
    if (code === 'FINISHED') break
    if (code === 'PUBLISHED') return { mediaId: String(job.result?.mediaId ?? ''), url: String(job.result?.url ?? '') }
    if (code === 'ERROR' || code === 'EXPIRED') {
      await writer.from('publication_jobs').update({ result: { ...(job.result ?? {}), containerId: null, lastContainerStatus: code, lastContainerDetail: String(s.status ?? '').slice(0, 300) } }).eq('id', job.id).eq('owner_id', job.owner_id)
      throw new SocialPublishError(`Instagram no pudo procesar el vídeo (${code}). ${String(s.status ?? '')}`.trim(), 502)
    }
    if (i === 23) throw new SocialPublishError('Instagram sigue procesando el vídeo. Vuelve a pulsar «Publicar» en unos minutos; se reanudará sin duplicar.', 202)
    await sleep(10000)
  }
  const published = await igJson(await fetch(`${igGraph}/${encodeURIComponent(igUserId)}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: containerId, access_token: token }),
  }))
  const mediaId = String(published.id ?? '')
  const info = await fetch(`${igGraph}/${encodeURIComponent(mediaId)}?${new URLSearchParams({ fields: 'permalink', access_token: token })}`).then(r => r.json()).catch(() => ({})) as { permalink?: string }
  return { mediaId, url: info.permalink ?? '' }
}

const TT = 'https://open.tiktokapis.com/v2/post/publish'
async function ttJson(r: Response) {
  const j = await r.json().catch(() => ({})) as { data?: Record<string, unknown>; error?: { code?: string; message?: string } }
  if (!r.ok || (j.error?.code && j.error.code !== 'ok')) throw new SocialPublishError(`TikTok: ${j.error?.message || j.error?.code || r.status}`, 502)
  return j.data ?? {}
}

/** Chunks per TikTok's rules: files ≤ 64 MB go in one chunk; larger ones in 10 MB chunks (last one absorbs the remainder). */
export function tiktokChunks(size: number) {
  if (size <= 64 * 1024 * 1024) return { chunkSize: size, count: 1 }
  const chunkSize = 10 * 1024 * 1024
  return { chunkSize, count: Math.floor(size / chunkSize) }
}

async function publishTikTok(db: SupabaseClient, job: SocialJob, token: string, writer: SupabaseClient = db) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' }
  let publishId = typeof job.result?.publishId === 'string' ? job.result.publishId : null
  if (!publishId) {
    const creator = await ttJson(await fetch(`${TT}/creator_info/query/`, { method: 'POST', headers }))
    const options = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options as string[] : []
    const privacy = job.payload.privacyLevel
    if (!privacy || !options.includes(privacy)) throw new SocialPublishError(`Privacidad no permitida para esta cuenta. Opciones: ${options.join(', ') || 'ninguna'}.`, 409)
    const v = await videoAsset(db, job.owner_id, job.payload.videoAssetId!)
    const maxSec = Number(creator.max_video_post_duration_sec ?? 0)
    if (maxSec > 0 && v.durationMs && v.durationMs / 1000 > maxSec) throw new SocialPublishError(`El vídeo dura ${Math.round(v.durationMs / 1000)} s y esta cuenta de TikTok admite como máximo ${maxSec} s.`, 409)
    let file: Blob
    try { file = await downloadObject(db, job.owner_id, v.path) } catch { throw new SocialPublishError('No se pudo leer el vídeo.', 502) }
    const uploadMime = v.mime.split(';')[0]
    const size = file.size
    const { chunkSize, count } = tiktokChunks(size)
    const init = await ttJson(await fetch(`${TT}/video/init/`, {
      method: 'POST', headers,
      body: JSON.stringify({
        post_info: { title: job.payload.caption ?? '', privacy_level: privacy, disable_comment: creator.comment_disabled === true || (job.payload.disableComment ?? true), disable_duet: creator.duet_disabled === true || (job.payload.disableDuet ?? true), disable_stitch: creator.stitch_disabled === true || (job.payload.disableStitch ?? true), brand_content_toggle: job.payload.brandContent === true, brand_organic_toggle: job.payload.brandOrganic === true, is_aigc: job.payload.isAigc !== false },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count },
      }),
    }))
    publishId = String(init.publish_id ?? '')
    const uploadUrl = String(init.upload_url ?? '')
    if (!publishId || !uploadUrl.startsWith('https://')) throw new SocialPublishError('TikTok no devolvió la URL de subida.', 502)
    await writer.from('publication_jobs').update({ result: { ...(job.result ?? {}), publishId }, updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', job.owner_id)
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize
      const end = i === count - 1 ? size - 1 : start + chunkSize - 1
      const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': uploadMime, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` }, body: file.slice(start, end + 1) })
      if (!r.ok && r.status !== 206 && r.status !== 201) throw new SocialPublishError(`La subida a TikTok falló (${r.status}).`, 502)
    }
  }
  for (let i = 0; i < 18; i++) {
    const s = await ttJson(await fetch(`${TT}/status/fetch/`, { method: 'POST', headers, body: JSON.stringify({ publish_id: publishId }) }))
    const status = String(s.status ?? '')
    if (status === 'PUBLISH_COMPLETE') {
      const ids = Array.isArray(s.publicaly_available_post_id) ? s.publicaly_available_post_id as unknown[] : []
      return { mediaId: ids.length ? String(ids[0]) : publishId, url: '' }
    }
    if (status === 'FAILED') throw new SocialPublishError(`TikTok rechazó la publicación: ${String(s.fail_reason ?? 'sin motivo')}.`, 502)
    if (i === 17) throw new SocialPublishError('TikTok sigue procesando el vídeo. Vuelve a pulsar «Publicar» en unos minutos para comprobarlo.', 202)
    await sleep(10000)
  }
  return { mediaId: publishId, url: '' }
}

/** `writer` writes the job's status/result (service role after the RLS hardening migration); `db` reads with the owner's session. */
/** `expectedAccountId`: the account ID the owner confirmed on screen for this publication; the server refuses any other account. */
export async function publishSocialJob(db: SupabaseClient, ownerId: string, jobId: string, writer: SupabaseClient = db, expectedAccountId?: string) {
  const { data } = await db.from('publication_jobs').select('id,owner_id,project_id,platform,status,idempotency_key,payload,result,updated_at').eq('id', jobId).eq('owner_id', ownerId).maybeSingle()
  const job = data as SocialJob | null
  if (!job || (job.platform !== 'instagram' && job.platform !== 'tiktok')) throw new SocialPublishError('Trabajo de publicación no encontrado.', 404)
  const platform = job.platform as SocialPlatform
  if (typeof job.result?.mediaId === 'string' && job.status === 'published') return { mediaId: job.result.mediaId, url: String(job.result.url ?? ''), alreadyPublished: true }
  // A job left in «publishing» by a killed function (timeout, deploy) would stay stuck forever. After 30 minutes it goes back to «approved»
  // so the owner can retry, but THIS click does not upload: the upload may have reached the platform, so the owner must check first.
  if (job.status === 'publishing') {
    const since = Date.parse(String((job as { updated_at?: string }).updated_at ?? ''))
    if (Number.isFinite(since) && Date.now() - since > 30 * 60_000) {
      await writer.from('publication_jobs').update({ status: 'approved', result: { ...(job.result ?? {}), interruptedAt: new Date().toISOString(), lastError: 'La publicación anterior se interrumpió.' }, updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId).eq('status', 'publishing')
      throw new SocialPublishError('La publicación anterior se interrumpió sin confirmar el resultado. Comprueba en la plataforma que no se subió y vuelve a pulsar «Publicar» para reintentarlo.', 409)
    }
    throw new SocialPublishError('La publicación ya está en curso.', 409)
  }
  if (job.status !== 'approved') throw new SocialPublishError('El trabajo no está aprobado.', 409)

  const key = socialApprovalKey(job)
  const { data: approval } = await db.from('approvals').select('owner_id,action_type,entity_id,status')
    .eq('owner_id', ownerId).eq('action_type', 'publish').eq('entity_type', 'publication_job').eq('entity_id', key).eq('status', 'approved').maybeSingle()
  const record = approval as { owner_id: string; action_type: string; entity_id: string; status: string } | null
  const guardRecord: ApprovalRecord | null = record ? { owner_id: record.owner_id, action_type: record.action_type, action_key: record.entity_id, status: record.status } : null
  assertPublicationApproved({ ownerId, platform, projectId: job.project_id, idempotencyKey: job.idempotency_key! }, guardRecord)

  // Server-only seal over exactly what was approved (see seal.ts): blocks forged approvals and payloads changed afterwards.
  if (!(await approvalStillValid(db, job))) throw new SocialPublishError(STALE_APPROVAL_MESSAGE, 403)

  const problem = validateSocialPayload(platform, job.payload)
  if (problem) throw new SocialPublishError(problem)
  const connection = await socialConnection(db, ownerId, platform)
  if (!connection) throw new SocialPublishError(`Conecta tu cuenta de ${platform === 'instagram' ? 'Instagram' : 'TikTok'} en Redes sociales.`, 409)
  const needed = platform === 'instagram' ? SOCIAL_SCOPES.instagram[1] : SOCIAL_SCOPES.tiktok[1]
  if (!connection.scopes.includes(needed)) throw new SocialPublishError(`La conexión no tiene el permiso ${needed}. Vuelve a conectar la cuenta.`, 409)
  if (expectedAccountId !== undefined && connection.external_account_id !== expectedAccountId) {
    throw new SocialPublishError(`La cuenta conectada (${connection.external_account_name ?? 'sin nombre'}, ID ${connection.external_account_id}) no es la que confirmaste. No se ha publicado nada.`, 409)
  }

  const { data: claimed } = await writer.from('publication_jobs').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId).eq('status', 'approved').select('id')
  if (!claimed?.length) throw new SocialPublishError('La publicación ya está en curso.', 409)
  try {
    const token = await socialAccessToken(db, connection)
    const r = platform === 'instagram' ? await publishInstagram(db, job, token, connection.external_account_id, writer) : await publishTikTok(db, job, token, writer)
    const { data: latest } = await db.from('publication_jobs').select('result').eq('id', job.id).maybeSingle()
    const result = { ...((latest?.result as Record<string, unknown> | null) ?? {}), mediaId: r.mediaId, url: r.url, publishedAt: new Date().toISOString(), privacy: platform === 'tiktok' ? job.payload.privacyLevel ?? null : null }
    await writer.from('publication_jobs').update({ status: 'published', result, updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId)
    return { mediaId: r.mediaId, url: r.url, alreadyPublished: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'La publicación falló.'
    const { data: latest } = await db.from('publication_jobs').select('result').eq('id', job.id).maybeSingle()
    await writer.from('publication_jobs').update({ status: 'approved', result: { ...((latest?.result as Record<string, unknown> | null) ?? {}), lastError: message.slice(0, 500), failedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId)
    throw error
  }
}

/** What TikTok requires showing before a post (Content Sharing Guidelines): nickname, allowed privacy options, disabled interactions, max length. */
export type TikTokCreatorInfo = { nickname: string | null; username: string | null; privacyOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxDurationSec: number | null }
export async function tiktokCreatorInfo(token: string): Promise<TikTokCreatorInfo> {
  const c = await ttJson(await fetch(`${TT}/creator_info/query/`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' } }))
  return {
    nickname: typeof c.creator_nickname === 'string' ? c.creator_nickname : null, username: typeof c.creator_username === 'string' ? c.creator_username : null,
    privacyOptions: Array.isArray(c.privacy_level_options) ? (c.privacy_level_options as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    commentDisabled: c.comment_disabled === true, duetDisabled: c.duet_disabled === true, stitchDisabled: c.stitch_disabled === true,
    maxDurationSec: typeof c.max_video_post_duration_sec === 'number' ? c.max_video_post_duration_sec : null,
  }
}
