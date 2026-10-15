import { searchYouTubeVideosMeta, type YouTubeSearchInput, type YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { analyzeTopic, type TopicAnalysis, type TopicSamples } from './topic-analysis'
import { cacheKey, DEFAULT_TTL_MS, recordUsage, startOfUtcDay, type CacheStore } from './cache'
import { DEFAULT_DAILY_CAP, UNITS } from './filters'

export class BudgetError extends Error { constructor(message: string, readonly used: number, readonly cap: number) { super(message) } }

export type SearchFn = (input: YouTubeSearchInput) => Promise<{ videos: YouTubeVideoResult[]; approxTotal: number | null }>

export type TopicRequest = { topic: string; region: string | null; language: string | null; /** Window of the "recent" sample (7–365 days, default 30). */ recentDays?: number; refresh?: boolean; /** Return only what is already cached; never call YouTube. */ cacheOnly?: boolean }
export type TopicResult = { analysis: TopicAnalysis | null; cached: boolean; usage: { usedToday: number; cap: number; persistent: boolean } }

export const dailyCap = (env: Record<string, string | undefined> = process.env) => { const n = Number(env.RESEARCH_DAILY_UNIT_CAP); return Number.isInteger(n) && n >= 200 && n <= 10000 ? n : DEFAULT_DAILY_CAP }

/**
 * One topic in one market = two samples (most viewed of the last year, newest of the last month), about 204 quota units.
 * Cached per user for a week; a fresh fetch is refused when it would pass the daily research budget.
 */
// Requests for the same owner run one at a time through the paid part, and identical requests share one fetch: two tabs or a double
// click can neither pay twice for the same topic nor both pass the budget check before either one has been recorded.
const inflight = new Map<string, Promise<TopicResult>>()
const chains = new Map<string, Promise<unknown>>()
const serial = <T>(owner: string, job: () => Promise<T>): Promise<T> => {
  const run = (chains.get(owner) ?? Promise.resolve()).then(job, job)
  const tail = run.catch(() => undefined)
  chains.set(owner, tail); void tail.then(() => { if (chains.get(owner) === tail) chains.delete(owner) })
  return run
}

export function getTopicAnalysis(req: TopicRequest, deps: { store: CacheStore; search?: SearchFn; now?: () => number; cap?: number; /** Who is asking; scopes the queue and de-duplication. */ owner?: string }): Promise<TopicResult> {
  if (req.cacheOnly) return fetchTopicAnalysis(req, deps)
  const owner = deps.owner ?? 'anonymous'
  const key = `${owner}|${[req.topic.trim().toLowerCase().replace(/\s+/g, ' '), req.region ?? '', req.language ?? '', String(req.recentDays ?? 30), req.refresh ? 'r' : ''].join('|')}`
  const running = inflight.get(key); if (running) return running
  const p = serial(owner, () => fetchTopicAnalysis(req, deps)).finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
  inflight.set(key, p)
  return p
}

async function fetchTopicAnalysis(req: TopicRequest, deps: { store: CacheStore; search?: SearchFn; now?: () => number; cap?: number }): Promise<TopicResult> {
  const now = deps.now ?? Date.now, search = deps.search ?? searchYouTubeVideosMeta, cap = deps.cap ?? dailyCap()
  const topic = req.topic.trim().replace(/\s+/g, ' ')
  const recentDays = Math.min(Math.max(Math.round(req.recentDays ?? 30), 7), 365)
  const key = cacheKey('topic', [topic, req.region, req.language, String(recentDays)])
  const used = () => deps.store.unitsSince(startOfUtcDay(now()))

  if (!req.refresh) {
    const hit = await deps.store.get<TopicAnalysis>(key, now())
    if (hit) return { analysis: hit.payload, cached: true, usage: { usedToday: await used(), cap, persistent: deps.store.persistent } }
  }
  if (req.cacheOnly) return { analysis: null, cached: false, usage: { usedToday: await used(), cap, persistent: deps.store.persistent } }
  const before = await used()
  if (before + UNITS.topic > cap) throw new BudgetError(`Presupuesto diario de Investigación agotado: ${before} de ${cap} unidades usadas hoy. Vuelve mañana o repite búsquedas ya guardadas (son gratis).`, before, cap)

  const common = { query: topic, regionCode: req.region ?? undefined, language: req.language ?? undefined, maxResults: 25 }
  // Every call that reached YouTube is recorded as its own usage line the moment it succeeds: a refresh (which overwrites the cached
  // analysis) and a second search that fails half-way are both counted, so a retry can never look free.
  const paid = async (input: Parameters<SearchFn>[0]) => { const r = await search(input); await recordUsage(deps.store, 'topic', UNITS.topic / 2, now()); return r }
  const top = await paid({ ...common, order: 'viewCount', publishedWithinDays: 365 })
  const recent = await paid({ ...common, order: 'date', publishedWithinDays: recentDays })
  const samples: TopicSamples = { topic, region: req.region, language: req.language, top, recent, recentDays, fetchedAt: new Date(now()).toISOString(), units: UNITS.topic }
  const analysis = analyzeTopic(samples, now())
  // The quota is already spent: if the cache write fails, still return the analysis instead of throwing it away.
  try { await deps.store.put(key, 'topic', analysis, 0, DEFAULT_TTL_MS, now()) } catch (e) { console.error('Could not cache topic analysis', e instanceof Error ? e.message : e) }
  return { analysis, cached: false, usage: { usedToday: before + UNITS.topic, cap, persistent: deps.store.persistent } }
}
