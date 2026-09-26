import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, type Connection } from '@/lib/oauth/google'

/**
 * Imports the owner's own channel metrics from YouTube Analytics API v2 into metric_snapshots.
 * Daily channel rows use external_content_id = "channel:<id>"; per-video rows use the video id
 * with metric_date = end of the period. Observed values are API values; calculated values are derived here.
 */

type Report = { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<string | number>> }

const day = (d: Date) => d.toISOString().slice(0, 10)

async function report(token: string, params: Record<string, string>) {
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
  url.search = new URLSearchParams({ ids: 'channel==MINE', ...params }).toString()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(response.status === 403 ? 'YouTube Analytics denegó el acceso: vuelve a conectar el canal con permisos de Analytics.' : body?.error?.message ?? `YouTube Analytics respondió ${response.status}.`)
  }
  const json = await response.json() as Report
  const names = (json.columnHeaders ?? []).map(h => h.name)
  return (json.rows ?? []).map(r => Object.fromEntries(r.map((v, i) => [names[i], v])) as Record<string, string | number>)
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

export async function importYouTubeAnalytics(db: SupabaseClient, ownerId: string, connection: Connection, days = 28) {
  const token = await accessTokenFor(db, connection)
  const end = new Date(Date.now() - 86400000)
  const start = new Date(end.getTime() - (days - 1) * 86400000)
  const period = { startDate: day(start), endDate: day(end) }

  const daily = await report(token, { ...period, dimensions: 'day', sort: 'day', metrics: 'views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost' })
  const videos = await report(token, { ...period, dimensions: 'video', sort: '-views', maxResults: '25', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,subscribersGained' })

  // Titles for the top videos (YouTube Data API with the same token).
  const ids = videos.map(v => String(v.video)).filter(Boolean)
  const titles = new Map<string, string>()
  if (ids.length) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(',')}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const j = await r.json().catch(() => ({})) as { items?: Array<{ id: string; snippet?: { title?: string } }> }
    for (const item of j.items ?? []) titles.set(item.id, item.snippet?.title ?? '')
  }

  // Link videos to projects when a publication job recorded the video id.
  const { data: jobs } = await db.from('publication_jobs').select('project_id,result').eq('owner_id', ownerId).eq('platform', 'youtube')
  const projectFor = new Map<string, string>()
  for (const j of (jobs ?? []) as Array<{ project_id: string; result: Record<string, unknown> | null }>) {
    const vid = j.result?.videoId
    if (typeof vid === 'string') projectFor.set(vid, j.project_id)
  }

  const importedAt = new Date().toISOString()
  const rows = [
    ...daily.map(d => {
      const views = num(d.views), minutes = num(d.estimatedMinutesWatched)
      return {
        owner_id: ownerId, project_id: null, platform: 'youtube', external_content_id: `channel:${connection.external_account_id}`, metric_date: String(d.day),
        observed: { views, estimatedMinutesWatched: minutes, averageViewDuration: num(d.averageViewDuration), likes: num(d.likes), comments: num(d.comments), shares: num(d.shares), subscribersGained: num(d.subscribersGained), subscribersLost: num(d.subscribersLost), source: 'youtube_analytics_api', importedAt },
        calculated: { netSubscribers: (num(d.subscribersGained) ?? 0) - (num(d.subscribersLost) ?? 0), minutesPerView: views ? Math.round(((minutes ?? 0) / views) * 100) / 100 : null },
      }
    }),
    ...videos.map(v => {
      const id = String(v.video), views = num(v.views)
      return {
        owner_id: ownerId, project_id: projectFor.get(id) ?? null, platform: 'youtube', external_content_id: id, metric_date: period.endDate,
        observed: { title: titles.get(id) ?? null, periodStart: period.startDate, periodEnd: period.endDate, views, estimatedMinutesWatched: num(v.estimatedMinutesWatched), averageViewDuration: num(v.averageViewDuration), averageViewPercentage: num(v.averageViewPercentage), likes: num(v.likes), comments: num(v.comments), subscribersGained: num(v.subscribersGained), source: 'youtube_analytics_api', importedAt },
        calculated: { likesPer1000Views: views ? Math.round(((num(v.likes) ?? 0) / views) * 100000) / 100 : null, subscribersPer1000Views: views ? Math.round(((num(v.subscribersGained) ?? 0) / views) * 100000) / 100 : null },
      }
    }),
  ]
  if (rows.length) {
    const { error } = await db.from('metric_snapshots').upsert(rows, { onConflict: 'owner_id,platform,external_content_id,metric_date' })
    if (error) throw new Error(`No se pudieron guardar las métricas: ${error.message}`)
  }
  return { period, days: daily.length, videos: videos.length, linkedToProjects: [...projectFor.keys()].filter(k => ids.includes(k)).length }
}
