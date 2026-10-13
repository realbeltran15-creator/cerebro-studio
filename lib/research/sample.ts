import { searchYouTubeVideosMeta, type YouTubeSearchInput, type YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { analyzeTopic, type TopicAnalysis, type TopicSamples } from './topic-analysis'
import { cacheKey, DEFAULT_TTL_MS, startOfUtcDay, type CacheStore } from './cache'
import { DEFAULT_DAILY_CAP, UNITS } from './filters'

export class BudgetError extends Error { constructor(message: string, readonly used: number, readonly cap: number) { super(message) } }

export type SearchFn = (input: YouTubeSearchInput) => Promise<{ videos: YouTubeVideoResult[]; approxTotal: number | null }>

export type TopicRequest = { topic: string; region: string | null; language: string | null; refresh?: boolean; /** Return only what is already cached; never call YouTube. */ cacheOnly?: boolean }
export type TopicResult = { analysis: TopicAnalysis | null; cached: boolean; usage: { usedToday: number; cap: number; persistent: boolean } }

export const dailyCap = (env: Record<string, string | undefined> = process.env) => { const n = Number(env.RESEARCH_DAILY_UNIT_CAP); return Number.isInteger(n) && n >= 200 && n <= 10000 ? n : DEFAULT_DAILY_CAP }

/**
 * One topic in one market = two samples (most viewed of the last year, newest of the last month), about 204 quota units.
 * Cached per user for a week; a fresh fetch is refused when it would pass the daily research budget.
 */
export async function getTopicAnalysis(req: TopicRequest, deps: { store: CacheStore; search?: SearchFn; now?: () => number; cap?: number }): Promise<TopicResult> {
  const now = deps.now ?? Date.now, search = deps.search ?? searchYouTubeVideosMeta, cap = deps.cap ?? dailyCap()
  const topic = req.topic.trim().replace(/\s+/g, ' ')
  const key = cacheKey('topic', [topic, req.region, req.language])
  const used = () => deps.store.unitsSince(startOfUtcDay(now()))

  if (!req.refresh) {
    const hit = await deps.store.get<TopicAnalysis>(key, now())
    if (hit) return { analysis: hit.payload, cached: true, usage: { usedToday: await used(), cap, persistent: deps.store.persistent } }
  }
  if (req.cacheOnly) return { analysis: null, cached: false, usage: { usedToday: await used(), cap, persistent: deps.store.persistent } }
  const before = await used()
  if (before + UNITS.topic > cap) throw new BudgetError(`Presupuesto diario de Investigación agotado: ${before} de ${cap} unidades usadas hoy. Vuelve mañana o repite búsquedas ya guardadas (son gratis).`, before, cap)

  const common = { query: topic, regionCode: req.region ?? undefined, language: req.language ?? undefined, maxResults: 25 }
  const top = await search({ ...common, order: 'viewCount', publishedWithinDays: 365 })
  const recent = await search({ ...common, order: 'date', publishedWithinDays: 30 })
  const samples: TopicSamples = { topic, region: req.region, language: req.language, top, recent, fetchedAt: new Date(now()).toISOString(), units: UNITS.topic }
  const analysis = analyzeTopic(samples, now())
  await deps.store.put(key, 'topic', analysis, UNITS.topic, DEFAULT_TTL_MS, now())
  return { analysis, cached: false, usage: { usedToday: before + UNITS.topic, cap, persistent: deps.store.persistent } }
}
