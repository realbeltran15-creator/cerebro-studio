import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Acceso a YouTube SOLO desde servidor. Compatible con el formato de channel_connections.token_ciphertext
 * que escribe el flujo OAuth del proyecto: `v1.<iv>.<tag>.<datos>` (AES-256-GCM, base64url) con TOKEN_ENCRYPTION_KEY.
 */
export const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly'

type StoredTokens = { access_token: string; refresh_token?: string; expires_at: number; scope: string; token_type: string }
export type Connection = { id: string; owner_id: string; external_account_id: string | null; scopes: string[]; token_ciphertext: string | null }

function key() {
  const buf = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY?.trim() ?? '', 'base64')
  if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY ausente o no es de 32 bytes en base64')
  return buf
}
export function decryptTokens(payload: string): StoredTokens {
  const [version, iv, tag, data] = payload.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Formato de token no soportado')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8'))
}
export function encryptTokens(value: StoredTokens) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

export async function connectionWithScope(db: SupabaseClient, ownerId: string, scope: string): Promise<Connection | null> {
  const { data } = await db.from('channel_connections').select('id,owner_id,external_account_id,scopes,token_ciphertext')
    .eq('owner_id', ownerId).eq('provider', 'youtube').eq('status', 'connected').order('updated_at', { ascending: false })
  return ((data ?? []) as Connection[]).find(c => c.scopes?.includes(scope) && c.token_ciphertext) ?? null
}

export async function accessToken(db: SupabaseClient, c: Connection): Promise<string> {
  const tokens = decryptTokens(c.token_ciphertext!)
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token
  if (!tokens.refresh_token) throw new Error('La sesión de YouTube caducó: vuelve a conectar el canal en Conectores')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, cache: 'no-store',
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? '', client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? '',
      refresh_token: tokens.refresh_token, grant_type: 'refresh_token',
    }),
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') await db.from('channel_connections').update({ status: 'expired' }).eq('id', c.id).eq('owner_id', c.owner_id)
    throw new Error(`No se pudo refrescar el acceso a YouTube: ${json.error_description ?? json.error ?? res.status}`)
  }
  const next: StoredTokens = { ...tokens, access_token: json.access_token, expires_at: Date.now() + (json.expires_in ?? 3600) * 1000, scope: json.scope ?? tokens.scope }
  await db.from('channel_connections').update({ token_ciphertext: encryptTokens(next), token_metadata: { expires_at: next.expires_at, scope: next.scope }, updated_at: new Date().toISOString() }).eq('id', c.id).eq('owner_id', c.owner_id)
  return next.access_token
}

/**
 * Inicia una subida reanudable PRIVADA con contenido sintético declarado y devuelve la URL de sesión.
 * El navegador sube el MP4 directamente a esa URL (el token nunca sale del servidor y se evita el límite de cuerpo de Vercel).
 * Se envía `Origin` para que la URL de sesión admita CORS desde la app.
 */
export async function initPrivateUpload(token: string, meta: { title: string; description: string; tags: string[] }, file: { size: number; type: string }, origin: string) {
  const res = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': file.type, 'x-upload-content-length': String(file.size), origin,
    },
    body: JSON.stringify({
      snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: '27', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true, embeddable: true },
    }),
    cache: 'no-store',
  })
  const location = res.headers.get('location')
  if (!res.ok || !location) {
    const body = await res.text().catch(() => '')
    throw new Error(`YouTube rechazó iniciar la subida (${res.status}): ${body.slice(0, 300)}`)
  }
  return location
}

export async function getVideo(token: string, videoId: string) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${encodeURIComponent(videoId)}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`YouTube videos.list ${res.status}: ${json?.error?.message ?? ''}`)
  const v = json.items?.[0]
  return v ? { privacyStatus: v.status?.privacyStatus as string, containsSyntheticMedia: v.status?.containsSyntheticMedia as boolean | undefined, publishedAt: v.snippet?.publishedAt as string } : null
}

/** Métricas observadas de YouTube Analytics para un vídeo en una ventana (fechas YYYY-MM-DD, inclusivas). */
export async function videoReport(token: string, videoId: string, startDate: string, endDate: string) {
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
  url.search = new URLSearchParams({
    ids: 'channel==MINE', startDate, endDate, filters: `video==${videoId}`,
    metrics: 'views,averageViewPercentage,averageViewDuration,estimatedMinutesWatched',
  }).toString()
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`YouTube Analytics ${res.status}: ${json?.error?.message ?? ''}`)
  const row = json.rows?.[0]
  if (!row) return null
  const cols = (json.columnHeaders ?? []).map((h: any) => h.name as string)
  return Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as { views: number; averageViewPercentage: number; averageViewDuration: number; estimatedMinutesWatched: number }
}
