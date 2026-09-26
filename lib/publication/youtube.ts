import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, hasScope, SCOPES, youtubeConnection } from '@/lib/oauth/google'
import { assertPublicationApproved, publicationApprovalKey, type ApprovalRecord } from './guard'

/**
 * Uploads an approved publication job to the owner's YouTube channel. Server-only.
 * Order of checks: job state → explicit approval record (guard) → connection with upload scope.
 * Idempotent: a job that already has a videoId is never uploaded again.
 */

export type YouTubePayload = {
  title: string
  description?: string
  tags?: string[]
  privacyStatus?: 'private' | 'unlisted' | 'public'
  categoryId?: string
  madeForKids?: boolean
  /** Altered or synthetic content disclosure required by YouTube for realistic AI media. */
  containsSyntheticMedia?: boolean
  videoAssetId?: string
  thumbnailAssetId?: string | null
}

export type PublicationJob = {
  id: string
  owner_id: string
  project_id: string
  platform: string
  status: string
  idempotency_key: string | null
  payload: YouTubePayload
  result: Record<string, unknown> | null
}

export class PublishError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function validatePayload(p: YouTubePayload) {
  if (!p.title?.trim() || p.title.length > 100) return 'El título es obligatorio y admite hasta 100 caracteres.'
  if (/[<>]/.test(p.title) || /[<>]/.test(p.description ?? '')) return 'YouTube no admite los caracteres < y > en título ni descripción.'
  if ((p.description ?? '').length > 5000) return 'La descripción admite hasta 5000 caracteres.'
  if ((p.tags ?? []).join(',').length > 500) return 'Las etiquetas superan 500 caracteres en total.'
  if (!p.videoAssetId) return 'Elige el vídeo que se va a subir.'
  return null
}

export function approvalKeyFor(job: Pick<PublicationJob, 'owner_id' | 'platform' | 'project_id' | 'idempotency_key'>) {
  if (!job.idempotency_key) throw new PublishError('El trabajo no tiene clave de idempotencia.')
  return publicationApprovalKey({ ownerId: job.owner_id, platform: job.platform, projectId: job.project_id, idempotencyKey: job.idempotency_key })
}

async function download(db: SupabaseClient, ownerId: string, assetId: string, types: string[]) {
  const { data: asset } = await db.from('assets').select('id,asset_type,storage_path,provenance').eq('id', assetId).eq('owner_id', ownerId).maybeSingle()
  const a = asset as { asset_type: string; storage_path: string | null; provenance: Record<string, unknown> | null } | null
  if (!a?.storage_path || !types.includes(a.asset_type)) throw new PublishError('El recurso elegido no existe o no es del tipo correcto.', 404)
  const { data, error } = await db.storage.from('generated-assets').download(a.storage_path)
  if (error || !data) throw new PublishError('No se pudo leer el archivo del almacenamiento.', 502)
  return { blob: data, mime: typeof a.provenance?.mimeType === 'string' ? a.provenance.mimeType : data.type || 'application/octet-stream' }
}

export async function publishJob(db: SupabaseClient, ownerId: string, jobId: string) {
  const { data } = await db.from('publication_jobs').select('id,owner_id,project_id,platform,status,idempotency_key,payload,result').eq('id', jobId).eq('owner_id', ownerId).maybeSingle()
  const job = data as PublicationJob | null
  if (!job || job.platform !== 'youtube') throw new PublishError('Trabajo de publicación no encontrado.', 404)
  if (typeof job.result?.videoId === 'string') return { videoId: job.result.videoId, url: String(job.result.url ?? ''), alreadyPublished: true }
  if (job.status !== 'approved') throw new PublishError('El trabajo no está aprobado.', 409)

  // Hard gate: explicit approval recorded by the owner for this exact job.
  const key = approvalKeyFor(job)
  const { data: approval } = await db.from('approvals').select('owner_id,action_type,entity_id,status')
    .eq('owner_id', ownerId).eq('action_type', 'publish').eq('entity_type', 'publication_job').eq('entity_id', key).eq('status', 'approved').maybeSingle()
  const record = approval as { owner_id: string; action_type: string; entity_id: string; status: string } | null
  const guardRecord: ApprovalRecord | null = record ? { owner_id: record.owner_id, action_type: record.action_type, action_key: record.entity_id, status: record.status } : null
  assertPublicationApproved({ ownerId, platform: 'youtube', projectId: job.project_id, idempotencyKey: job.idempotency_key! }, guardRecord)

  const problem = validatePayload(job.payload)
  if (problem) throw new PublishError(problem)
  const connection = await youtubeConnection(db, ownerId)
  if (!connection) throw new PublishError('Conecta tu canal de YouTube en Conectores.', 409)
  if (!hasScope(connection, SCOPES.publish[0])) throw new PublishError('La conexión no tiene permiso de subida. Pulsa «Permitir subida de vídeos» en Conectores.', 409)

  // Claim the job so a second click cannot start a parallel upload.
  const { data: claimed } = await db.from('publication_jobs').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId).eq('status', 'approved').select('id')
  if (!claimed?.length) throw new PublishError('La publicación ya está en curso.', 409)

  try {
    const token = await accessTokenFor(db, connection)
    const video = await download(db, ownerId, job.payload.videoAssetId!, ['video'])
    const metadata = {
      snippet: { title: job.payload.title.trim(), description: job.payload.description ?? '', tags: job.payload.tags ?? [], categoryId: job.payload.categoryId ?? '27' },
      status: { privacyStatus: job.payload.privacyStatus ?? 'private', selfDeclaredMadeForKids: job.payload.madeForKids ?? false, containsSyntheticMedia: job.payload.containsSyntheticMedia ?? true },
    }
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': video.mime, 'X-Upload-Content-Length': String(video.blob.size) },
      body: JSON.stringify(metadata),
    })
    const location = init.headers.get('location')
    if (!init.ok || !location) throw new PublishError(`YouTube rechazó la subida (${init.status}).`, 502)
    const upload = await fetch(location, { method: 'PUT', headers: { 'Content-Type': video.mime, 'Content-Length': String(video.blob.size) }, body: video.blob })
    const uploaded = await upload.json().catch(() => ({})) as { id?: string; error?: { message?: string } }
    if (!upload.ok || !uploaded.id) throw new PublishError(uploaded.error?.message ?? `La subida falló (${upload.status}).`, 502)

    const result: Record<string, unknown> = { videoId: uploaded.id, url: `https://www.youtube.com/watch?v=${uploaded.id}`, privacyStatus: metadata.status.privacyStatus, publishedAt: new Date().toISOString() }
    if (job.payload.thumbnailAssetId) {
      try {
        const thumb = await download(db, ownerId, job.payload.thumbnailAssetId, ['thumbnail', 'image'])
        const t = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${uploaded.id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': thumb.mime }, body: thumb.blob })
        result.thumbnail = t.ok ? 'set' : `failed (${t.status}); custom thumbnails require a verified channel`
      } catch { result.thumbnail = 'failed' }
    }
    await db.from('publication_jobs').update({ status: 'published', result, updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId)
    return { videoId: uploaded.id, url: String(result.url), alreadyPublished: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'La publicación falló.'
    // Back to approved so the owner can retry after fixing the cause; the approval stays valid for this job only.
    await db.from('publication_jobs').update({ status: 'approved', result: { lastError: message.slice(0, 500), failedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId)
    throw error
  }
}
