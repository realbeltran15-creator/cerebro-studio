import { searchYouTubeVideosMeta, type YouTubeSearchInput, type YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { analyzeTopic, applyGrowth, isCurrentEngine, upgradeAnalysis, type Sample, type TopicAnalysis, type TopicSamples } from './topic-analysis'
import { cacheKey, DEFAULT_TTL_MS, quotaDayStart, type CacheStore } from './cache'
import { isExhausted } from './cache'
import { BudgetError, isQuotaExceeded, lockForToday, quotaLimits, reserveSpend } from './quota'
import { DEFAULT_DAILY_CAP, UNITS } from './filters'

export { BudgetError } from './quota'

export type SearchFn = (input: YouTubeSearchInput) => Promise<{ videos: YouTubeVideoResult[]; approxTotal: number | null }>

export type TopicRequest = { topic: string; region: string | null; language: string | null; /** Window of the "recent" sample (7–365 days, default 30). */ recentDays?: number; refresh?: boolean; /** Return only what is already cached; never call YouTube. */ cacheOnly?: boolean }
export class NoBaseAnalysisError extends Error {}
export type TopicResult = { analysis: TopicAnalysis | null; cached: boolean; usage: { usedToday: number; cap: number; persistent: boolean; searchesToday: number; searchCap: number; exhausted: boolean } }

export const dailyCap = (env: Record<string, string | undefined> = process.env) => quotaLimits(env).unitCap

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

export function getTopicAnalysis(req: TopicRequest, deps: Deps & { /** Who is asking; scopes the queue and de-duplication. */ owner?: string }): Promise<TopicResult> {
  if (req.cacheOnly) return fetchTopicAnalysis(req, deps)
  const owner = deps.owner ?? 'anonymous'
  const key = `${owner}|${[req.topic.trim().toLowerCase().replace(/\s+/g, ' '), req.region ?? '', req.language ?? '', String(req.recentDays ?? 30), req.refresh ? 'r' : ''].join('|')}`
  const running = inflight.get(key); if (running) return running
  const p = serial(owner, () => fetchTopicAnalysis(req, deps)).finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
  inflight.set(key, p)
  return p
}

const usageOf = async (store: CacheStore, cap: number, now: number, extra = 0) => {
  const since = quotaDayStart(now), limits = quotaLimits()
  return { usedToday: (await store.unitsSince(since)) + extra, cap, persistent: store.persistent, searchesToday: await store.searchesSince(since), searchCap: limits.searchCap, exhausted: await isExhausted(store, now) }
}


/**
 * A cached analysis is served only if it was made by the current engine, or can be upgraded for free (see `upgradeAnalysis`). Anything else is a
 * miss: the topic is analysed again instead of showing numbers the current rules would not produce.
 */
async function currentFromCache(store: CacheStore, key: string, now: number): Promise<{ payload: TopicAnalysis } | null> {
  const hit = await store.get<TopicAnalysis>(key, now)
  if (!hit) return null
  if (isCurrentEngine(hit.payload)) return hit
  const up = upgradeAnalysis(hit.payload, now)
  if (!up) return null
  await store.put(key, 'topic', up, 0, DEFAULT_TTL_MS, now).catch(() => undefined)
  return { payload: up }
}

/** Another server instance is running this very research: the caller should retry shortly instead of paying for it twice. */
export class InProgressError extends Error { constructor(message: string) { super(message) } }

type Deps = { store: CacheStore; search?: SearchFn; now?: () => number; cap?: number; /** Test hook: how long to wait between polls while another instance works (ms). */ pollMs?: number; /** Test hook: how long to wait for another instance before giving up (ms). */ waitMs?: number }
const LEASE_MS = 120_000, RESERVE_TTL_MS = 600_000, PARTIAL_TTL_MS = 3_600_000
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Waits for the instance that holds the lease to publish its result; null when it did not finish in time. */
async function waitForResult(key: string, deps: Deps): Promise<TopicAnalysis | null> {
  const now = deps.now ?? Date.now, poll = deps.pollMs ?? 1500, deadline = Date.now() + (deps.waitMs ?? 25_000)
  while (Date.now() < deadline) { const hit = await currentFromCache(deps.store, key, now()); if (hit) return hit.payload; await sleep(poll) }
  return currentFromCache(deps.store, key, now()).then(h => h?.payload ?? null)
}

async function fetchTopicAnalysis(req: TopicRequest, deps: Deps): Promise<TopicResult> {
  const now = deps.now ?? Date.now, search = deps.search ?? searchYouTubeVideosMeta, cap = deps.cap ?? dailyCap()
  const topic = req.topic.trim().replace(/\s+/g, ' ')
  const recentDays = Math.min(Math.max(Math.round(req.recentDays ?? 30), 7), 365)
  const key = cacheKey('topic', [topic, req.region, req.language, String(recentDays)])
  const used = () => deps.store.unitsSince(quotaDayStart(now()))
  const result = async (analysis: TopicAnalysis, cached: boolean, usedToday?: number): Promise<TopicResult> => ({ analysis, cached, usage: usedToday === undefined ? await usageOf(deps.store, cap, now()) : { ...(await usageOf(deps.store, cap, now())), usedToday } })

  if (!req.refresh) { const hit = await currentFromCache(deps.store, key, now()); if (hit) return result(hit.payload, true) }
  if (req.cacheOnly) return { analysis: null, cached: false, usage: await usageOf(deps.store, cap, now()) }

  // Exclusive lease across ALL server instances: two instances never run the same research at once. The loser waits for the winner's result.
  if (!(await deps.store.lock(`topic:${key}`, LEASE_MS, now()))) {
    const shared = await waitForResult(key, deps)
    if (shared) return result(shared, true)
    throw new InProgressError('Otra consulta idéntica sigue en marcha. Espera unos segundos y vuelve a intentarlo: no se ha gastado cuota.')
  }
  try {
    if (!req.refresh) { const hit = await currentFromCache(deps.store, key, now()); if (hit) return result(hit.payload, true) }   // the winner before us may have just finished
    // A first search that succeeded before an earlier failure is reused: only the missing search is paid again.
    const partialKey = cacheKey('partial', [topic, req.region, req.language, 'top'])
    const partial = req.refresh ? null : await deps.store.get<Sample>(partialKey, now())
    const need = partial ? UNITS.topic / 2 : UNITS.topic
    // Reserve BOTH daily limits (quota units and search.list calls) BEFORE spending, in one atomic step, then settle with what was really spent.
    const needSearches = partial ? 1 : 2
    const spend = await reserveSpend(deps.store, `topic|${key}`, need, needSearches, now(), { ...quotaLimits(), ...(deps.cap !== undefined ? { unitCap: deps.cap } : {}) })
    let spent = 0, searchesDone = 0
    try {
      const common = { query: topic, regionCode: req.region ?? undefined, language: req.language ?? undefined, maxResults: 25 }
      let top: Sample
      if (partial) top = partial.payload
      else { top = await search({ ...common, order: 'viewCount', publishedWithinDays: 365 }); spent += UNITS.topic / 2; searchesDone++; await deps.store.put(partialKey, 'partial', top, 0, PARTIAL_TTL_MS, now()).catch(() => undefined) }
      const recent = await search({ ...common, order: 'date', publishedWithinDays: recentDays }); spent += UNITS.topic / 2; searchesDone++
      const samples: TopicSamples = { topic, region: req.region, language: req.language, top, recent, recentDays, fetchedAt: new Date(now()).toISOString(), units: UNITS.topic }
      const analysis = analyzeTopic(samples, now())
      // The quota is already spent: if the cache write fails, still return the analysis instead of throwing it away.
      try { await deps.store.put(key, 'topic', analysis, 0, DEFAULT_TTL_MS, now()); await deps.store.delete(partialKey).catch(() => undefined) } catch (e) { console.error('Could not cache topic analysis', e instanceof Error ? e.message : e) }
      return result(analysis, false, spend.used - need + spent)
    } catch (e) {
      // YouTube says the quota is spent although our counters had room: other applications share the project. Lock both limits for today.
      if (isQuotaExceeded(e)) await lockForToday(deps.store, now())
      throw e
    } finally {
      // Whatever happened, what reached YouTube is counted; a reservation that spent nothing is released.
      await spend.settle(spent, searchesDone).catch(e => console.error('Could not settle quota reservation', e instanceof Error ? e.message : e))
    }
  } finally { await deps.store.unlock(`topic:${key}`).catch(() => undefined) }
}

/**
 * Measures growth for an analysis already in the cache: one more search for the PREVIOUS window (same length, adjacent, newest first),
 * judged by the same relevance rules (~102 units). Without a cached analysis there is nothing to compare, so it refuses.
 */
/** A client-supplied analysis is accepted only if it is the same research, from the current engine, with the numbers growth needs. */
export function usableAnalysis(a: unknown, req: { topic: string; region: string | null; language: string | null; recentDays: number }): a is TopicAnalysis {
  const x = a as Partial<TopicAnalysis> | null
  return !!x && typeof x === 'object' && isCurrentEngine(x) && typeof x.topic === 'string' && x.topic.trim().toLowerCase() === req.topic.trim().toLowerCase()
    && (x.region ?? null) === req.region && (x.language ?? null) === req.language && x.recentDays === req.recentDays
    && !!x.growth && typeof x.growth.recent?.n === 'number' && !!x.indices && typeof x.indices.demand === 'number' && typeof x.indices.competition === 'number' && typeof x.indices.supply === 'number'
    && Array.isArray(x.reasons) && Array.isArray(x.evidence)
}

export function getGrowth(req: { topic: string; region: string | null; language: string | null; recentDays?: number; /** The analysis the browser already holds (it may live only there: the server cache can be another instance's memory). */ analysis?: unknown }, deps: Deps & { owner?: string }): Promise<TopicResult> {
  const owner = deps.owner ?? 'anonymous'
  return serial(owner, async () => {
    const now = deps.now ?? Date.now, search = deps.search ?? searchYouTubeVideosMeta
    const topic = req.topic.trim().replace(/\s+/g, ' ')
    const recentDays = Math.min(Math.max(Math.round(req.recentDays ?? 30), 7), 365)
    const key = cacheKey('topic', [topic, req.region, req.language, String(recentDays)])
    const cached = await currentFromCache(deps.store, key, now())
    const supplied = usableAnalysis(req.analysis, { topic, region: req.region, language: req.language, recentDays }) ? req.analysis : null
    const hit = cached ? { payload: cached.payload } : supplied ? { payload: supplied } : null
    if (!hit) throw new NoBaseAnalysisError('No hay un análisis actual de este tema con el que comparar (puede venir de una versión anterior del motor). Vuelve a analizarlo primero.')
    const cap = deps.cap ?? dailyCap()
    const usage = (extra = 0) => usageOf(deps.store, cap, now(), extra)
    if (hit.payload.growth?.state === 'calculable' || hit.payload.growth?.previous || hit.payload.growth?.measuredAt) return { analysis: hit.payload, cached: true, usage: await usage() }
    const lockKey = `growth:${key}`
    if (!(await deps.store.lock(lockKey, LEASE_MS, now()))) throw new InProgressError('Otra medición del crecimiento de este tema sigue en marcha. Vuelve a intentarlo en unos segundos: no se ha gastado cuota.')
    try {
      const spend = await reserveSpend(deps.store, `growth|${key}`, UNITS.search, 1, now(), { ...quotaLimits(), ...(deps.cap !== undefined ? { unitCap: deps.cap } : {}) })
      let spent = 0
      try {
        const previous = await search({ query: topic, regionCode: req.region ?? undefined, language: req.language ?? undefined, maxResults: 25, order: 'date', publishedWithinDays: recentDays * 2, publishedBeforeDays: recentDays })
        spent = UNITS.search
        const analysis = applyGrowth(hit.payload, previous, now())
        try { await deps.store.put(key, 'topic', analysis, 0, DEFAULT_TTL_MS, now()) } catch (e) { console.error('Could not cache growth', e instanceof Error ? e.message : e) }
        return { analysis, cached: false, usage: await usage() }
      } catch (e) { if (isQuotaExceeded(e)) await lockForToday(deps.store, now()); throw e } finally { await spend.settle(spent, spent > 0 ? 1 : 0).catch(() => undefined) }
    } finally { await deps.store.unlock(lockKey).catch(() => undefined) }
  })
}
