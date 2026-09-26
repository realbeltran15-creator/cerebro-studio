import type { SupabaseClient } from '@supabase/supabase-js'
import { trendingYouTubeVideos, youtubeVideoId, youtubeVideosByIds, type YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { recurringTerms } from '@/lib/radar'

/**
 * Server-side automation runner. Works with a user-session client (manual runs, RLS applies)
 * or a service-role client (scheduled runs), so every query filters by owner explicitly.
 * Automations only read external sources and write into the owner's workspace: they never publish.
 */

export type AutomationKind = 'trend_watch' | 'opportunity_refresh'

export type Automation = {
  id: string
  owner_id: string
  kind: AutomationKind
  name: string
  enabled: boolean
  schedule: 'manual' | 'daily'
  config: Record<string, unknown>
  last_run_at: string | null
}

export type TrendWatchConfig = { region: string; categoryId: string | null; keywords: string[]; autoSave: boolean }
export type RefreshConfig = { maxItems: number }

export function trendWatchConfig(raw: Record<string, unknown>): TrendWatchConfig {
  const region = typeof raw.region === 'string' && /^[A-Z]{2}$/.test(raw.region) ? raw.region : 'ES'
  const categoryId = typeof raw.categoryId === 'string' && /^\d{1,4}$/.test(raw.categoryId) ? raw.categoryId : null
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 1).map(k => k.trim().toLowerCase()).slice(0, 20) : []
  return { region, categoryId, keywords, autoSave: raw.autoSave === true }
}

export function refreshConfig(raw: Record<string, unknown>): RefreshConfig {
  const n = Number(raw.maxItems)
  return { maxItems: Number.isInteger(n) && n > 0 && n <= 200 ? n : 50 }
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

/** Videos whose title contains any keyword (accent- and case-insensitive). No keywords = none match. */
export function matchKeywords(videos: YouTubeVideoResult[], keywords: string[]) {
  const keys = keywords.map(normalize)
  return videos.filter(v => keys.some(k => normalize(v.title).includes(k)))
}

function opportunityFromVideo(ownerId: string, v: YouTubeVideoResult, cfg: TrendWatchConfig, automationName: string) {
  return {
    owner_id: ownerId,
    title: v.title.slice(0, 180) || v.url,
    source_platform: 'youtube',
    source_id: v.url,
    query: `automatización:${automationName}`.slice(0, 200),
    region: cfg.region,
    language: null,
    status: 'discovered',
    observed_metrics: { ...v.observed, channel_title: v.channelTitle, channel_id: v.channelId, published_at: v.publishedAt, source: 'youtube_data_api', origin: 'automation' },
    calculated_metrics: { ...v.calculated, formula: { viewsPerDay: 'views / días desde publicación', viewsToSubscribers: 'views / suscriptores del canal', engagementRate: '(likes + comentarios) / views × 100' } },
    evidence: [{ url: v.url, source: 'youtube_data_api', captured_at: v.observed.fetchedAt, note: `Canal: ${v.channelTitle} · tendencia ${cfg.region} detectada por «${automationName}»` }],
  }
}

async function runTrendWatch(db: SupabaseClient, a: Automation) {
  const cfg = trendWatchConfig(a.config)
  const videos = await trendingYouTubeVideos({ regionCode: cfg.region, categoryId: cfg.categoryId ?? undefined })
  const matched = matchKeywords(videos, cfg.keywords)
  let saved = 0, duplicates = 0
  if (cfg.autoSave && matched.length) {
    const { data: existing, error } = await db.from('opportunities').select('source_id').eq('owner_id', a.owner_id).eq('source_platform', 'youtube').in('source_id', matched.map(v => v.url))
    if (error) throw new Error(error.message)
    const known = new Set((existing ?? []).map((r: { source_id: string }) => r.source_id))
    const fresh = matched.filter(v => !known.has(v.url))
    duplicates = matched.length - fresh.length
    if (fresh.length) {
      const { error: insertError } = await db.from('opportunities').insert(fresh.map(v => opportunityFromVideo(a.owner_id, v, cfg, a.name)))
      if (insertError) throw new Error(insertError.message)
      saved = fresh.length
    }
  }
  return {
    region: cfg.region, categoryId: cfg.categoryId, checked: videos.length, matched: matched.length, saved, duplicates,
    matches: matched.slice(0, 10).map(v => ({ title: v.title, url: v.url, views: v.observed.views })),
    recurringTerms: recurringTerms(videos.map(v => v.title), 2, 10),
  }
}

type OppRow = { id: string; source_id: string | null; observed_metrics: Record<string, unknown> | null; calculated_metrics: Record<string, unknown> | null }

async function runOpportunityRefresh(db: SupabaseClient, a: Automation) {
  const cfg = refreshConfig(a.config)
  const { data, error } = await db.from('opportunities').select('id,source_id,observed_metrics,calculated_metrics')
    .eq('owner_id', a.owner_id).eq('source_platform', 'youtube').neq('status', 'discarded').order('updated_at', { ascending: true }).limit(cfg.maxItems)
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

/** Runs one automation and records the run. Never throws: failures are stored on the run. */
export async function executeAutomation(db: SupabaseClient, a: Automation, trigger: 'manual' | 'schedule') {
  const { data: run, error } = await db.from('automation_runs').insert({ owner_id: a.owner_id, automation_id: a.id, trigger, status: 'running' }).select('id').single()
  if (error) return { ok: false as const, error: error.message }
  const runId = (run as { id: string }).id
  try {
    const summary = a.kind === 'trend_watch' ? await runTrendWatch(db, a) : await runOpportunityRefresh(db, a)
    const now = new Date().toISOString()
    await db.from('automation_runs').update({ status: 'succeeded', summary, finished_at: now }).eq('id', runId)
    await db.from('automations').update({ last_run_at: now, updated_at: now }).eq('id', a.id).eq('owner_id', a.owner_id)
    return { ok: true as const, runId, summary }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'La ejecución falló.'
    const now = new Date().toISOString()
    await db.from('automation_runs').update({ status: 'failed', error: message.slice(0, 500), finished_at: now }).eq('id', runId)
    await db.from('automations').update({ last_run_at: now, updated_at: now }).eq('id', a.id).eq('owner_id', a.owner_id)
    return { ok: false as const, runId, error: message }
  }
}
