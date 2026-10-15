import { quotaDayKey } from './cache'

/**
 * Browser-side record of the quota this browser has spent today. The server only counts what it saw and, when the cache table is
 * missing, forgets it on every cold start, so the screen also keeps its own tally of EVERYTHING it asked YouTube for
 * (analyses, free-text searches, charts): quota units AND search.list calls, the two daily limits. The budget shown and enforced is the
 * stricter of the two, and the server receives this tally with each paid request so a cold start never resets the day.
 *
 * The day is a calendar label (Pacific date), not a timestamp: comparing timestamps made the counter reset whenever a value carried
 * milliseconds that the boundary calculation did not.
 */
export type Ledger = { day: string; units: number; searches: number }

export const emptyLedger = (now = Date.now()): Ledger => ({ day: quotaDayKey(now), units: 0, searches: 0 })

export function parseLedger(raw: string | null, now = Date.now()): Ledger {
  try {
    const p = raw ? JSON.parse(raw) as Partial<Ledger> : null
    if (p && typeof p.day === 'string' && p.day === quotaDayKey(now) && typeof p.units === 'number' && Number.isFinite(p.units) && p.units >= 0) {
      const searches = typeof p.searches === 'number' && Number.isFinite(p.searches) && p.searches >= 0 ? Math.round(p.searches) : 0
      return { day: p.day, units: Math.round(p.units), searches }
    }
  } catch { /* corrupt ledger starts again */ }
  return emptyLedger(now)
}

export const addUnits = (l: Ledger, units: number, now = Date.now(), searches = 0): Ledger => {
  const same = l.day === quotaDayKey(now)
  return { day: quotaDayKey(now), units: (same ? l.units : 0) + Math.max(Math.round(units), 0), searches: (same ? l.searches : 0) + Math.max(Math.round(searches), 0) }
}

/** `x-research-spent` header value for a paid request («units,searches,day»). */
export const ledgerHeader = (l: Ledger, now = Date.now()) => (l.day === quotaDayKey(now) ? `${Math.min(l.units, 999999)},${Math.min(l.searches, 9999)},${l.day}` : `0,0,${quotaDayKey(now)}`)

export type ServerUsage = { usedToday: number; cap: number; persistent: boolean; day?: string; searchesToday?: number; searchCap?: number; exhausted?: boolean }

/**
 * What this app believes it has spent and may still spend. It is an ESTIMATE of this application's own consumption: other applications
 * sharing the Google Cloud project cannot be seen, so `verified` is always false and «remaining» is never a guarantee.
 */
export function effectiveUsage(server: ServerUsage | null, ledger: Ledger, defaultCap = 6000, now = Date.now(), defaultSearchCap = 60) {
  const today = quotaDayKey(now)
  const liveServer = server && (server.day === undefined || server.day === today) ? server : null
  const cap = server?.cap ?? defaultCap, searchCap = server?.searchCap ?? defaultSearchCap
  const usedToday = Math.max(liveServer?.usedToday ?? 0, ledger.day === today ? ledger.units : 0)
  const searchesToday = Math.max(liveServer?.searchesToday ?? 0, ledger.day === today ? ledger.searches : 0)
  const exhausted = !!liveServer?.exhausted
  return {
    usedToday, cap, remaining: exhausted ? 0 : Math.max(cap - usedToday, 0), persistent: server?.persistent ?? false,
    searchesToday, searchCap, searchesRemaining: exhausted ? 0 : Math.max(searchCap - searchesToday, 0), exhausted, verified: false as const,
  }
}
