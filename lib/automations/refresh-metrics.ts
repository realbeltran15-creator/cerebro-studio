import type { SupabaseClient } from '@supabase/supabase-js'
import { youtubeVideoId, youtubeVideosByIds } from '@/lib/providers/youtube-data'

// Own module on purpose: the open route /api/opportunities/refresh imports only this, not the automation runner (which reaches the AI providers).
type OppRow = { id: string; source_id: string | null; observed_metrics: Record<string, unknown> | null; calculated_metrics: Record<string, unknown> | null }

/**
 * Re-reads YouTube metrics for the owner's opportunities (all non-discarded ones, oldest first,
 * or only the given ids), keeping a 30-entry history and growth since the previous reading.
 */
export async function refreshOpportunityMetrics(db: SupabaseClient, ownerId: string, opts: { maxItems?: number; ids?: string[] } = {}) {
  const a = { owner_id: ownerId }
  let query = db.from('opportunities').select('id,source_id,observed_metrics,calculated_metrics')
    .eq('owner_id', ownerId).eq('source_platform', 'youtube').neq('status', 'discarded')
  if (opts.ids?.length) query = query.in('id', opts.ids.slice(0, 50))
  const { data, error } = await query.order('updated_at', { ascending: true }).limit(Math.min(opts.maxItems ?? 50, 200))
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as OppRow[]).map(r => ({ row: r, videoId: youtubeVideoId(r.source_id) })).filter(r => r.videoId)
  if (rows.length === 0) return { checked: 0, updated: 0, missing: 0, top: [] }
  const current = new Map((await youtubeVideosByIds(rows.map(r => r.videoId!))).map(v => [v.videoId, v]))
  let updated = 0, missing = 0
  const growth: Array<{ title: string; url: string; viewsGained: number; viewsPerDaySinceLastCheck: number | null }> = []
  for (const { row, videoId } of rows) {
    const v = current.get(videoId!)
    if (!v) { missing++; continue }
    const prev = row.observed_metrics ?? {}
    const prevViews = typeof prev.views === 'number' ? prev.views : null
    const prevAt = typeof prev.fetchedAt === 'string' ? Date.parse(prev.fetchedAt) : NaN
    const history = Array.isArray(prev.history) ? prev.history.slice(-29) : []
    if (prevViews !== null && Number.isFinite(prevAt)) history.push({ fetchedAt: prev.fetchedAt, views: prevViews, likes: prev.likes ?? null, comments: prev.comments ?? null })
    const days = Number.isFinite(prevAt) ? (Date.parse(v.observed.fetchedAt) - prevAt) / 86400000 : null
    const gained = prevViews !== null && v.observed.views !== null ? v.observed.views - prevViews : null
    const sinceLast = gained !== null && days && days > 0.01 ? Math.round(gained / days) : null
    const { error: updateError } = await db.from('opportunities').update({
      observed_metrics: { ...prev, ...v.observed, channel_title: v.channelTitle, channel_id: v.channelId, published_at: v.publishedAt, source: 'youtube_data_api', history },
      calculated_metrics: { ...(row.calculated_metrics ?? {}), ...v.calculated, viewsGainedSinceLastCheck: gained, viewsPerDaySinceLastCheck: sinceLast },
      updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('owner_id', a.owner_id)
    if (updateError) throw new Error(updateError.message)
    updated++
    if (gained !== null) growth.push({ title: v.title, url: v.url, viewsGained: gained, viewsPerDaySinceLastCheck: sinceLast })
  }
  return { checked: rows.length, updated, missing, top: growth.sort((x, y) => y.viewsGained - x.viewsGained).slice(0, 5) }
}
