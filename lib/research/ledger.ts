import { quotaDayStart } from './cache'

/**
 * Browser-side record of the quota this browser has spent today. The server only counts topic analyses and, when the cache table is
 * missing, forgets them on every cold start, so the screen also keeps its own tally of EVERYTHING it asked YouTube for
 * (analyses, free-text searches, charts). The budget shown and enforced is the stricter of the two.
 */
export type Ledger = { day: number; units: number }

export const emptyLedger = (now = Date.now()): Ledger => ({ day: quotaDayStart(now), units: 0 })

export function parseLedger(raw: string | null, now = Date.now()): Ledger {
  try {
    const p = raw ? JSON.parse(raw) as Partial<Ledger> : null
    if (p && typeof p.day === 'number' && typeof p.units === 'number' && Number.isFinite(p.units) && p.units >= 0 && p.day === quotaDayStart(now)) return { day: p.day, units: Math.round(p.units) }
  } catch { /* corrupt ledger starts again */ }
  return emptyLedger(now)
}

export const addUnits = (l: Ledger, units: number, now = Date.now()): Ledger => ({ day: quotaDayStart(now), units: (l.day === quotaDayStart(now) ? l.units : 0) + Math.max(Math.round(units), 0) })

/** `server.day` (UTC midnight the figure belongs to) lets a tab left open past midnight drop yesterday's numbers instead of staying blocked. */
export function effectiveUsage(server: { usedToday: number; cap: number; persistent: boolean; day?: number } | null, ledger: Ledger, defaultCap = 6000, now = Date.now()) {
  const today = quotaDayStart(now)
  const liveServer = server && (server.day === undefined || server.day === today) ? server : null
  const cap = server?.cap ?? defaultCap
  const usedToday = Math.max(liveServer?.usedToday ?? 0, ledger.day === today ? ledger.units : 0)
  return { usedToday, cap, remaining: Math.max(cap - usedToday, 0), persistent: server?.persistent ?? false }
}
