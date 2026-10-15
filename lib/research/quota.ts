import { OFFICIAL_LIMITS, isExhausted, markExhausted, quotaDayStart, type CacheStore } from './cache'
import { YouTubeApiError } from '@/lib/providers/youtube-data'
import { DEFAULT_DAILY_CAP } from './filters'

/**
 * Two independent daily limits protect the YouTube key, and BOTH are enforced:
 *   units    — the quota units every call costs (search.list 100, videos.list 1, channels.list 1…); 10 000 per day by default.
 *   searches — the number of search.list calls per day; 100 per day was observed in the Google Cloud console. It is NOT assumed to be the
 *              same limit as the units: a day can run out of searches with units to spare, or the other way round.
 * The app's own counters only see what THIS application spent. Other applications that share the Google Cloud project spend from the same
 * pools and cannot be seen from here, so the counters are an estimate, never a confirmation. The owner may declare how much other
 * applications use (YOUTUBE_EXTERNAL_RESERVED_UNITS / _SEARCHES) to leave that room untouched, and when YouTube itself reports the quota
 * as spent the app locks both limits until the next Pacific midnight (`markExhausted`).
 */
export const DEFAULT_SEARCH_CAP = 60   // 60 % of the 100 searches, like the 6 000-unit default is 60 % of 10 000

export type QuotaLimits = { unitCap: number; searchCap: number; official: { units: number; searches: number }; externalUnits: number; externalSearches: number }

const intIn = (v: string | undefined, lo: number, hi: number) => { const n = Number(v); return v !== undefined && v.trim() !== '' && Number.isInteger(n) && n >= lo && n <= hi ? n : null }

export function quotaLimits(env: Record<string, string | undefined> = process.env): QuotaLimits {
  const externalUnits = intIn(env.YOUTUBE_EXTERNAL_RESERVED_UNITS, 0, OFFICIAL_LIMITS.units) ?? 0
  const externalSearches = intIn(env.YOUTUBE_EXTERNAL_RESERVED_SEARCHES, 0, OFFICIAL_LIMITS.searches) ?? 0
  const appUnits = intIn(env.RESEARCH_DAILY_UNIT_CAP, 200, OFFICIAL_LIMITS.units) ?? DEFAULT_DAILY_CAP
  const appSearches = intIn(env.RESEARCH_DAILY_SEARCH_CAP, 2, OFFICIAL_LIMITS.searches) ?? DEFAULT_SEARCH_CAP
  return {
    unitCap: Math.max(Math.min(appUnits, OFFICIAL_LIMITS.units - externalUnits), 0),
    searchCap: Math.max(Math.min(appSearches, OFFICIAL_LIMITS.searches - externalSearches), 0),
    official: { ...OFFICIAL_LIMITS }, externalUnits, externalSearches,
  }
}

export class BudgetError extends Error {
  constructor(message: string, readonly used: number, readonly cap: number, readonly limit: 'units' | 'searches' | 'exhausted' = 'units') { super(message) }
}

export type Usage = { units: { used: number; cap: number }; searches: { used: number; cap: number }; exhausted: boolean; persistent: boolean; atomic: boolean; /** Always false: consumption by other applications cannot be read from here. */ verified: false }

export async function readUsage(store: CacheStore, limits = quotaLimits(), now = Date.now()): Promise<Usage> {
  const since = quotaDayStart(now)
  const [units, searches, exhausted] = await Promise.all([store.unitsSince(since), store.searchesSince(since), isExhausted(store, now)])
  return { units: { used: units, cap: limits.unitCap }, searches: { used: searches, cap: limits.searchCap }, exhausted, persistent: store.persistent, atomic: store.atomic, verified: false }
}

export type Spend = { release(): Promise<void>; settle(units: number, searches: number): Promise<void>; used: number; usedSearches: number }

/**
 * Reserves units AND searches atomically before any call to YouTube. Throws BudgetError when either limit would be passed, or when
 * YouTube already reported the quota as spent today. A failure of the counter itself propagates (the caller must not search).
 */
export async function reserveSpend(store: CacheStore, label: string, units: number, searches: number, now = Date.now(), limits = quotaLimits()): Promise<Spend> {
  if (await isExhausted(store, now)) throw new BudgetError('YouTube ha informado de que la cuota de hoy está agotada (puede que otra aplicación del mismo proyecto de Google Cloud la haya gastado). No se lanzan más búsquedas hasta mañana.', 0, 0, 'exhausted')
  const key = `v2|reserve|${label}|${now}|${Math.random().toString(36).slice(2, 8)}`
  const r = await store.reserve(key, units, limits.unitCap, 600_000, now, searches > 0 ? { need: searches, cap: limits.searchCap } : undefined)
  if (!r.ok) {
    if (r.reason === 'search_budget') throw new BudgetError(`Límite diario de búsquedas de YouTube alcanzado: ${r.usedSearches} de ${limits.searchCap} búsquedas usadas o reservadas hoy por esta aplicación. Es un límite distinto del de unidades. Vuelve mañana o repite búsquedas ya guardadas (son gratis).`, r.usedSearches, limits.searchCap, 'searches')
    throw new BudgetError(`Presupuesto diario de Investigación agotado: ${r.used} de ${limits.unitCap} unidades usadas o reservadas hoy. Vuelve mañana o repite búsquedas ya guardadas (son gratis).`, r.used, limits.unitCap, 'units')
  }
  return {
    used: r.used, usedSearches: r.usedSearches,
    release: () => store.release(key),
    settle: (u, s) => (u > 0 || s > 0 ? store.settle(key, u, now, s) : store.release(key)),
  }
}

/** True for the errors YouTube uses to say the daily quota is spent (403 quotaExceeded / dailyLimitExceeded / rateLimitExceeded, or 429). */
export const isQuotaExceeded = (e: unknown) => e instanceof YouTubeApiError && (e.status === 429 || ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(e.reason ?? ''))

/** Call when YouTube reports exhausted quota: both limits stay locked until the next Pacific midnight. */
export const lockForToday = (store: CacheStore, now = Date.now()) => markExhausted(store, now)
