import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, hasScope, type Connection } from '@/lib/oauth/google'

/**
 * Acceso a YouTube SOLO desde servidor. El cifrado de tokens (`v1.iv.tag.datos`, AES-256-GCM con TOKEN_ENCRYPTION_KEY) y el
 * refresco del acceso viven en lib/oauth/google.ts y lib/security/tokens.ts; aquí solo se elige la conexión con el permiso adecuado.
 */
export const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly'
export type { Connection }
export const accessToken = accessTokenFor

/** Hay varias conexiones por canal (analytics / publish): se elige la que tiene el permiso pedido, no solo la más reciente. */
export async function connectionWithScope(db: SupabaseClient, ownerId: string, scope: string): Promise<Connection | null> {
  const { data } = await db.from('channel_connections').select('id,owner_id,external_account_id,external_account_name,scopes,status,token_ciphertext')
    .eq('owner_id', ownerId).eq('provider', 'youtube').eq('status', 'connected').order('updated_at', { ascending: false })
  return ((data ?? []) as Connection[]).find(c => hasScope(c, scope) && c.token_ciphertext) ?? null
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
