import type { SupabaseClient } from '@supabase/supabase-js'
import { generateJson } from './gemini'
import { median, normalizeTopicKey } from './gates'
import type { Candidate, FactoryConfig, InterestData, Trend } from './types'

const YT = 'https://www.googleapis.com/youtube/v3'

export class YouTubeQuotaError extends Error {}

async function yt<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY?.trim()
  const url = new URL(`${YT}/${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  if (key) url.searchParams.set('key', key)
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  const json: any = await res.json().catch(() => ({}))
  if (res.status === 403 && /quota/i.test(JSON.stringify(json))) throw new YouTubeQuotaError('Cuota diaria de YouTube Data API agotada')
  if (!res.ok) throw new Error(`YouTube Data API ${res.status}: ${json?.error?.message ?? 'error'}`)
  return json as T
}

const isoSeconds = (iso: string) => {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : Infinity
}

type ShortVideo = { views: number; ageDays: number }

/** Shorts (≤60 s) de los últimos 12 meses para una consulta. Cuesta 100 + 1 unidades de cuota. */
async function searchShorts(q: string, max: number): Promise<ShortVideo[]> {
  const publishedAfter = new Date(Date.now() - 365 * 86400_000).toISOString()
  const found = await yt<{ items?: { id: { videoId: string } }[] }>('search', {
    part: 'id', type: 'video', videoDuration: 'short', q, maxResults: String(max), order: 'relevance',
    regionCode: 'ES', relevanceLanguage: 'es', publishedAfter,
  })
  const ids = (found.items ?? []).map(i => i.id.videoId).filter(Boolean)
  if (!ids.length) return []
  const vids = await yt<{ items?: { statistics?: { viewCount?: string }; contentDetails?: { duration: string }; snippet?: { publishedAt: string } }[] }>('videos', {
    part: 'statistics,contentDetails,snippet', id: ids.join(','),
  })
  return (vids.items ?? [])
    .filter(v => isoSeconds(v.contentDetails?.duration ?? '') <= 61 && v.statistics?.viewCount != null)
    .map(v => ({ views: Number(v.statistics!.viewCount), ageDays: Math.max(1, (Date.now() - Date.parse(v.snippet!.publishedAt)) / 86400_000) }))
}

function trendOf(videos: ShortVideo[]): Trend | null {
  const recent = videos.filter(v => v.ageDays <= 90).map(v => v.views / v.ageDays)
  const older = videos.filter(v => v.ageDays > 90).map(v => v.views / v.ageDays)
  if (recent.length < 2 || older.length < 2) return null
  const ratio = median(recent) / Math.max(median(older), 1)
  return ratio > 1.25 ? 'rising' : ratio < 0.75 ? 'falling' : 'flat'
}

/** Lee los datos de interés ya guardados en la oportunidad (observados + tendencia calculada). */
export function interestFromOpportunity(o: { observed_metrics?: any; calculated_metrics?: any }): InterestData | null {
  const obs = o.observed_metrics ?? {}
  if (!Array.isArray(obs.similar_views) || typeof obs.niche_median_views !== 'number') return null
  return { similarViews: obs.similar_views.filter(Number.isFinite), nicheMedian: obs.niche_median_views, trend: o.calculated_metrics?.trend ?? null, fetchedAt: obs.fetched_at }
}

const NICHE_TTL_MS = 7 * 86400_000

/** Mediana del nicho, cacheada 7 días en la config de la automatización para ahorrar cuota. */
async function nicheMedian(db: SupabaseClient, automationId: string | null, config: FactoryConfig, cache: any) {
  if (cache?.median && Date.now() - Date.parse(cache.fetched_at) < NICHE_TTL_MS && cache.query === config.nicheQuery) return cache.median as number
  const videos = await searchShorts(config.nicheQuery, 40)
  const m = median(videos.map(v => v.views))
  if (automationId && m > 0) {
    const { data } = await db.from('automations').select('config').eq('id', automationId).maybeSingle()
    await db.from('automations').update({ config: { ...(data?.config ?? {}), niche_cache: { median: m, fetched_at: new Date().toISOString(), query: config.nicheQuery, samples: videos.length } } }).eq('id', automationId)
  }
  return m
}

export async function enrichOpportunity(db: SupabaseClient, ownerId: string, opp: { id: string; title: string; observed_metrics?: any; calculated_metrics?: any }, config: FactoryConfig, automation: { id: string | null; nicheCache: any }) {
  const median0 = await nicheMedian(db, automation.id, config, automation.nicheCache)
  const videos = await searchShorts(opp.title, 15)
  const fetchedAt = new Date().toISOString()
  const trend = trendOf(videos)
  const observed = { ...(opp.observed_metrics ?? {}), similar_views: videos.map(v => v.views), niche_median_views: median0, source: 'youtube_data_api', fetched_at: fetchedAt }
  const calculated = { ...(opp.calculated_metrics ?? {}), trend, similar_median_views: median(videos.map(v => v.views)), interest_ratio: median0 > 0 ? median(videos.map(v => v.views)) / median0 : null, method: 'median(similar)/median(niche); trend = median views/day (≤90d vs >90d)' }
  await db.from('opportunities').update({ observed_metrics: observed, calculated_metrics: calculated, updated_at: fetchedAt }).eq('id', opp.id).eq('owner_id', ownerId)
  return interestFromOpportunity({ observed_metrics: observed, calculated_metrics: calculated })
}

const OPEN_STATUSES = ['discovered', 'research_needed', 'candidate', 'experiment_approved']

export async function loadCandidates(db: SupabaseClient, ownerId: string, usedKeys: Set<string>): Promise<(Candidate & { raw: any })[]> {
  const { data } = await db.from('opportunities')
    .select('id,title,status,observed_metrics,calculated_metrics,created_at')
    .eq('owner_id', ownerId).in('status', OPEN_STATUSES).order('created_at', { ascending: false }).limit(60)
  return (data ?? [])
    .map(o => ({ opportunityId: o.id as string, title: o.title as string, topicKey: normalizeTopicKey(o.title as string), interest: interestFromOpportunity(o), raw: o }))
    .filter(c => c.topicKey && !usedKeys.has(c.topicKey))
}

/** Ideas de curiosidades para alimentar Market Intelligence. Son ideas, NO datos: pasan por el filtro de interés. */
export async function ideateTopics(db: SupabaseClient, ownerId: string, config: FactoryConfig, avoidTitles: string[], count = 8) {
  const out = await generateJson<{ ideas?: { title: string }[] }>(
    `Canal: ${config.channelName}. ${config.nicheDescription} Tono: ${config.tone}. Idioma: ${config.language}.\n` +
    `Propón ${count} temas de curiosidades concretos (un dato sorprendente y comprobable cada uno, apto para un Short de 30 s) de estas categorías: ${config.categories.join(', ')}.\n` +
    `Temas ya usados o en cola, NO repetir ni parafrasear: ${avoidTitles.slice(0, 60).join(' | ') || '(ninguno)'}.\n` +
    `Responde JSON {"ideas":[{"title": string}]} con títulos descriptivos de 4-10 palabras.`,
    0.9,
  )
  const rows = (out.ideas ?? []).filter(i => i.title && normalizeTopicKey(i.title)).slice(0, count).map(i => ({
    owner_id: ownerId, title: i.title.trim().slice(0, 160), source_platform: 'youtube', query: i.title.trim().slice(0, 160),
    region: 'ES', language: config.language, status: 'discovered', observed_metrics: {}, calculated_metrics: {},
    evidence: [{ source: 'gemini_ideation', note: 'Idea sugerida por IA: sin datos de interés hasta que Radar los compruebe', captured_at: new Date().toISOString() }],
  }))
  if (rows.length) await db.from('opportunities').insert(rows)
  return rows.length
}
