import type { SupabaseClient } from '@supabase/supabase-js'
import { categoryRetention, type CategoryRetention } from './gates'
import { ANALYTICS_SCOPE, accessToken, connectionWithScope, getVideo, videoReport } from './youtube'

/** Con menos vistas la retención media es ruido: se guarda pero no se usa para priorizar. */
export const MIN_VIEWS_FOR_LEARNING = 30
export const RETENTION_KIND = 'shorts_retention_7d'
const ANALYTICS_LAG_DAYS = 2

const day = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000))

/** Solo datos OBSERVADOS (averageViewPercentage a 7 días) con muestra suficiente, agregados por categoría. */
export async function loadRetention(db: SupabaseClient, ownerId: string): Promise<CategoryRetention> {
  const { data: shorts } = await db.from('shorts').select('video_id,category').eq('owner_id', ownerId).not('video_id', 'is', null)
  const ids = (shorts ?? []).map(s => s.video_id as string)
  if (!ids.length) return new Map()
  const { data: snaps } = await db.from('metric_snapshots').select('external_content_id,observed')
    .eq('owner_id', ownerId).eq('platform', 'youtube').in('external_content_id', ids).eq('observed->>kind', RETENTION_KIND)
  const byVideo = new Map((snaps ?? []).map(s => [s.external_content_id as string, s.observed as any]))
  return categoryRetention((shorts ?? []).map(s => {
    const o = byVideo.get(s.video_id as string)
    return { category: s.category as string | null, averageViewPercentage: o && o.views >= MIN_VIEWS_FOR_LEARNING ? Number(o.averageViewPercentage) : null }
  }))
}

export type SyncOutcome = { shortId: string; videoId: string; result: 'recorded' | 'awaiting_public' | 'window_open' | 'no_data' | 'already_recorded' | 'error'; detail?: string }

/**
 * Guarda la retención media a 7 días (YouTube Analytics) de los Shorts subidos.
 * Ventana = los 7 primeros días desde snippet.publishedAt (cuando el vídeo ya es público). Mientras siga privado no hay audiencia
 * real, así que no se mide. Se espera 2 días tras cerrar la ventana por la latencia de Analytics.
 */
export async function syncRetention(db: SupabaseClient, ownerId: string): Promise<SyncOutcome[]> {
  const { data: shorts } = await db.from('shorts').select('id,video_id').eq('owner_id', ownerId).eq('status', 'uploaded_private').not('video_id', 'is', null)
  if (!shorts?.length) return []
  const conn = await connectionWithScope(db, ownerId, ANALYTICS_SCOPE)
  if (!conn) return shorts.map(s => ({ shortId: s.id, videoId: s.video_id!, result: 'error' as const, detail: 'sin conexión de YouTube con yt-analytics.readonly' }))
  const token = await accessToken(db, conn)
  const out: SyncOutcome[] = []

  const { data: prior } = await db.from('metric_snapshots').select('observed').eq('owner_id', ownerId).eq('platform', 'youtube').eq('observed->>kind', RETENTION_KIND)
  const priorMean = (() => {
    const v = (prior ?? []).map(p => p.observed as any).filter(o => o.views >= MIN_VIEWS_FOR_LEARNING).map(o => Number(o.averageViewPercentage))
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  })()

  for (const s of shorts) {
    const videoId = s.video_id as string
    try {
      const { data: have } = await db.from('metric_snapshots').select('id').eq('owner_id', ownerId).eq('platform', 'youtube').eq('external_content_id', videoId).eq('observed->>kind', RETENTION_KIND).limit(1)
      if (have?.length) { out.push({ shortId: s.id, videoId, result: 'already_recorded' }); continue }
      const video = await getVideo(token, videoId)
      if (!video || video.privacyStatus !== 'public') { out.push({ shortId: s.id, videoId, result: 'awaiting_public', detail: video?.privacyStatus ?? 'no encontrado' }); continue }
      const start = video.publishedAt.slice(0, 10)
      const end = addDays(start, 6)
      if (end > addDays(day(new Date()), -ANALYTICS_LAG_DAYS)) { out.push({ shortId: s.id, videoId, result: 'window_open', detail: `la ventana cierra el ${end}` }); continue }
      const report = await videoReport(token, videoId, start, end)
      if (!report) { out.push({ shortId: s.id, videoId, result: 'no_data' }); continue }
      const fetchedAt = new Date().toISOString()
      const lowSample = report.views < MIN_VIEWS_FOR_LEARNING
      await db.from('metric_snapshots').insert({
        owner_id: ownerId, platform: 'youtube', external_content_id: videoId, metric_date: end,
        // OBSERVADO: valores tal cual los devuelve YouTube Analytics.
        observed: {
          kind: RETENTION_KIND, averageViewPercentage: report.averageViewPercentage, views: report.views,
          averageViewDuration: report.averageViewDuration, estimatedMinutesWatched: report.estimatedMinutesWatched,
          window: { start, end, days: 7, basis: 'snippet.publishedAt' }, source: 'youtube_analytics_api', fetched_at: fetchedAt,
        },
        // INFERIDO/CALCULADO por Cerebro, nunca mezclado con lo observado.
        calculated: {
          low_sample: lowSample, min_views_for_learning: MIN_VIEWS_FOR_LEARNING,
          relative_to_channel_mean: priorMean && !lowSample ? Math.round((report.averageViewPercentage / priorMean) * 100) / 100 : null,
          method: 'averageViewPercentage / media observada de los Shorts anteriores con ≥ muestra mínima',
        },
      })
      out.push({ shortId: s.id, videoId, result: 'recorded', detail: `${report.averageViewPercentage.toFixed(1)}% · ${report.views} vistas${lowSample ? ' (muestra baja: no se usará para priorizar)' : ''}` })
    } catch (e) {
      out.push({ shortId: s.id, videoId, result: 'error', detail: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}
