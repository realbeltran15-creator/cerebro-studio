import { NextResponse } from 'next/server'
import { CounterUnavailableError, openStore, quotaDayKey, quotaDayStart, type CacheStore } from './cache'
import { BudgetError } from './quota'
import { LEDGER_HEADER } from './guard-header'

/**
 * Header the browser sends with every paid request: what ITS ledger says it spent today («units,searches,dayKey»). When the server has no
 * persistent counter (the table is not created yet) a cold start would forget the day's spending, so the server never trusts itself to
 * know less than the browser does. The header can only RAISE the figure the server uses, never lower it.
 */
export { LEDGER_HEADER }

export function parseLedgerHeader(raw: string | null, now = Date.now()): { units: number; searches: number } | null {
  const m = /^(\d{1,6}),(\d{1,4}),(\d{4}-\d{2}-\d{2})$/.exec(raw ?? '')
  if (!m || m[3] !== quotaDayKey(now)) return null
  return { units: Number(m[1]), searches: Number(m[2]) }
}

/** Raises the memory store's day counters to what the browser reports. A persistent store is the authority and is left alone. */
export async function syncBrowserLedger(store: CacheStore, raw: string | null, now = Date.now()) {
  if (store.persistent) return
  const seen = parseLedgerHeader(raw, now); if (!seen) return
  const key = `v2|browser-ledger|${quotaDayKey(now)}`
  const mine = (await store.get<{ units: number; searches: number }>(key, now))?.payload ?? { units: 0, searches: 0 }
  const since = quotaDayStart(now)
  const baseUnits = (await store.unitsSince(since)) - mine.units, baseSearches = (await store.searchesSince(since)) - mine.searches
  const units = Math.max(seen.units - baseUnits, 0), searches = Math.max(seen.searches - baseSearches, 0)
  if (units > mine.units || searches > mine.searches) await store.put(key, 'usage', { units, searches }, units, 2 * 86400000, now, searches)
}

/** Opens the counter (failing closed when it cannot be read) and folds in the browser's own ledger when the server has no persistent one. */
export async function openGuardedStore(supabase: unknown, owner: string, request: Request, now = Date.now()): Promise<CacheStore> {
  const store = await openStore(supabase as never, owner)
  await syncBrowserLedger(store, request.headers.get(LEDGER_HEADER), now)
  return store
}

/** Maps the quota errors to HTTP answers; null when the error is something else. */
export function quotaErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof BudgetError) return NextResponse.json({ error: error.message, budget: { used: error.used, cap: error.cap, limit: error.limit }, configured: true }, { status: 429 })
  if (error instanceof CounterUnavailableError) return NextResponse.json({ error: error.message, counterUnavailable: true, configured: true }, { status: 503 })
  return null
}
