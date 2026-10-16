/**
 * Cache and daily-budget log for the paid research samples. Rows live in `research_cache` (per user, RLS). If the table has not been
 * created yet the memory store takes over: it still prevents repeats inside one server instance but cannot enforce a budget across
 * instances, and `persistent` says so.
 */
export type CacheHit<T> = { payload: T; fetchedAt: string; units: number }

/** Result of reserving quota BEFORE spending it. `used` includes this reservation when `ok`. */
export type Reservation = { ok: true; used: number; usedSearches: number } | { ok: false; reason: 'budget' | 'search_budget' | 'no_session'; used: number; usedSearches: number }
/** How many search.list calls (a separate daily limit from the quota units) a reservation needs and how many the app allows per day. */
export type SearchBudget = { need: number; cap: number }

export interface CacheStore {
  readonly persistent: boolean
  /** True when check-and-reserve and the lock are atomic across every server instance (database functions), not just inside one process. */
  readonly atomic: boolean
  get<T>(key: string, now?: number): Promise<CacheHit<T> | null>
  put(key: string, kind: string, payload: unknown, units: number, ttlMs: number, now?: number, searches?: number): Promise<void>
  delete(key: string): Promise<void>
  /** Units spent or reserved since the given instant (fresh fetches, usage lines and live reservations). */
  unitsSince(sinceMs: number): Promise<number>
  /** search.list calls made or reserved since the given instant: the second daily limit. */
  searchesSince(sinceMs: number): Promise<number>
  /**
   * Reserve `units` of today's budget BEFORE calling YouTube. The check and the reservation happen together, so two instances can never
   * both pass the cap. A reservation counts as spent until `settle` replaces it with the real amount or `release` drops it.
   */
  reserve(key: string, units: number, cap: number, ttlMs: number, now?: number, searches?: SearchBudget): Promise<Reservation>
  settle(key: string, actualUnits: number, now?: number, actualSearches?: number): Promise<void>
  release(key: string): Promise<void>
  /** Exclusive lease on one piece of work (e.g. one topic in one market) for `ttlMs`; false when another instance holds it. */
  lock(key: string, ttlMs: number, now?: number): Promise<boolean>
  unlock(key: string): Promise<void>
}

export const DEFAULT_TTL_MS = 7 * 86400000

export function cacheKey(kind: string, parts: Array<string | null | undefined>) {
  // v3: analyses made by an older engine (before the relevance, language, promo and window rules of this version) are never reused.
  return ['v3', kind, ...parts.map(p => (p ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' '))].join('|')
}

export const startOfUtcDay = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }

/**
 * YouTube Data API quota resets at midnight PACIFIC time (America/Los_Angeles, with daylight saving), not at midnight UTC. The daily
 * budget is therefore counted from the last Pacific midnight, so that «today» in this app is the same «today» YouTube bills against.
 */
export function quotaDayStart(now = Date.now()): number {
  // The wall-clock formatter below has second precision: with milliseconds left in `now` the boundary drifted by up to 999 ms between calls,
  // and every comparison against a stored day («ledger.day === quotaDayStart()») failed, resetting the counter. Work on whole seconds.
  now = Math.floor(now / 1000) * 1000
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const wall = (t: number) => { const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, Number(x.value)])); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) }
  const t0 = wall(now), midnightWall = t0 - (t0 % 86400000)           // the Pacific wall clock, truncated to its own midnight
  let guess = now - (t0 - midnightWall)                                // first estimate in real time
  for (let i = 0; i < 3; i++) guess += midnightWall - wall(guess)      // correct for a daylight-saving change between midnight and now
  return guess
}

/** Stable label of the quota day (Pacific calendar date), for comparing days without relying on timestamps. */
export const quotaDayKey = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))

/** The counter cannot be read or written, so paid searches are refused (fail closed) instead of running without a budget. */
export class CounterUnavailableError extends Error { constructor(message = 'No se puede comprobar el consumo de hoy, así que no se lanza ninguna búsqueda de pago. Inténtalo de nuevo en unos minutos.') { super(message) } }

type MemRow = { kind: string; payload: unknown; fetchedAt: number; expiresAt: number; units: number; searches: number }
const memory = new Map<string, Map<string, MemRow>>()

export class MemoryCacheStore implements CacheStore {
  readonly persistent = false
  readonly atomic = true     // single-threaded: every check-and-set below runs without an await in between
  private rows: Map<string, MemRow>
  constructor(owner: string) { this.rows = memory.get(owner) ?? new Map(); memory.set(owner, this.rows) }
  async get<T>(key: string, now = Date.now()) { const r = this.rows.get(key); return r && r.expiresAt > now && r.kind !== 'lock' && r.kind !== 'reserve' ? { payload: r.payload as T, fetchedAt: new Date(r.fetchedAt).toISOString(), units: r.units } : null }
  async put(key: string, kind: string, payload: unknown, units: number, ttlMs: number, now = Date.now(), searches = 0) { this.rows.set(key, { kind, payload, fetchedAt: now, expiresAt: now + ttlMs, units, searches }) }
  async delete(key: string) { this.rows.delete(key) }
  async unitsSince(sinceMs: number) { let t = 0; for (const r of this.rows.values()) if (r.fetchedAt >= sinceMs) t += r.units; return t }
  async searchesSince(sinceMs: number) { let t = 0; for (const r of this.rows.values()) if (r.fetchedAt >= sinceMs) t += r.searches; return t }
  async reserve(key: string, units: number, cap: number, ttlMs: number, now = Date.now(), searches?: SearchBudget): Promise<Reservation> {
    let used = 0, usedSearches = 0; for (const r of this.rows.values()) if (r.fetchedAt >= quotaDayStart(now)) { used += r.units; usedSearches += r.searches }
    if (used + units > cap) return { ok: false, reason: 'budget', used, usedSearches }
    if (searches && usedSearches + searches.need > searches.cap) return { ok: false, reason: 'search_budget', used, usedSearches }
    this.rows.set(key, { kind: 'reserve', payload: {}, fetchedAt: now, expiresAt: now + ttlMs, units, searches: searches?.need ?? 0 })
    return { ok: true, used: used + units, usedSearches: usedSearches + (searches?.need ?? 0) }
  }
  async settle(key: string, actual: number, now = Date.now(), actualSearches = 0) { this.rows.set(key, { kind: 'usage', payload: {}, fetchedAt: now, expiresAt: now + 2 * 86400000, units: Math.max(Math.round(actual), 0), searches: Math.max(Math.round(actualSearches), 0) }) }
  async release(key: string) { this.rows.delete(key) }
  async lock(key: string, ttlMs: number, now = Date.now()) {
    const k = `v2|lock|${key}`, r = this.rows.get(k)
    if (r && r.expiresAt > now) return false
    this.rows.set(k, { kind: 'lock', payload: {}, fetchedAt: now, expiresAt: now + ttlMs, units: 0, searches: 0 }); return true
  }
  async unlock(key: string) { this.rows.delete(`v2|lock|${key}`) }
}

// The Supabase query builder is too generic to type structurally here; the store only uses select/eq/gte/upsert.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc?: (fn: string, args: Record<string, unknown>) => any }

const missingFunction = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42883' || e.code === 'PGRST202' || /research_(reserve|lock)/i.test(e.message ?? '') && /does not exist|could not find/i.test(e.message ?? ''))

export class SupabaseCacheStore implements CacheStore {
  readonly persistent = true
  /** True once the database functions answered: then reservations and locks are atomic across instances. */
  atomic = false
  private rpcMissing = false
  constructor(private db: Db, private owner: string) {}
  async get<T>(key: string, now = Date.now()) {
    const { data, error } = await this.db.from('research_cache').select('payload,fetched_at,units,expires_at').eq('owner_id', this.owner).eq('cache_key', key).limit(1)
    if (error) throw error
    const row = (data as Array<{ payload: T; fetched_at: string; units: number; expires_at: string }> | null)?.[0]
    return row && Date.parse(row.expires_at) > now ? { payload: row.payload, fetchedAt: row.fetched_at, units: row.units } : null
  }
  async put(key: string, kind: string, payload: unknown, units: number, ttlMs: number, now = Date.now(), searches = 0) {
    const { error } = await this.db.from('research_cache').upsert({ owner_id: this.owner, cache_key: key, kind, payload, units, searches, fetched_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString() }, { onConflict: 'owner_id,cache_key' })
    if (error) throw error
    // Housekeeping: now and then drop this user's rows that expired a month ago (cached analyses and usage log lines). Best effort.
    if (Math.random() < 0.05) { try { await this.db.from('research_cache').delete().eq('owner_id', this.owner).lt('expires_at', new Date(now - 30 * 86400000).toISOString()) } catch { /* housekeeping is best effort and must never fail a write */ } }
  }
  async delete(key: string) { const { error } = await this.db.from('research_cache').delete().eq('owner_id', this.owner).eq('cache_key', key); if (error) throw error }
  async unitsSince(sinceMs: number) {
    const { data, error } = await this.db.from('research_cache').select('units').eq('owner_id', this.owner).gte('fetched_at', new Date(sinceMs).toISOString())
    if (error) throw error
    return ((data ?? []) as Array<{ units: number }>).reduce((t, r) => t + (r.units ?? 0), 0)
  }
  async searchesSince(sinceMs: number) {
    const { data, error } = await this.db.from('research_cache').select('searches').eq('owner_id', this.owner).gte('fetched_at', new Date(sinceMs).toISOString())
    if (error) throw error
    return ((data ?? []) as Array<{ searches?: number }>).reduce((t, r) => t + (r.searches ?? 0), 0)
  }
  /** Database function (atomic under an advisory lock); falls back to check-then-insert when the function is not installed. */
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; value: T } | { ok: false }> {
    if (this.rpcMissing || typeof this.db.rpc !== 'function') return { ok: false }
    const { data, error } = await this.db.rpc(fn, args)
    if (error) { if (missingFunction(error)) { this.rpcMissing = true; return { ok: false } } throw error }
    this.atomic = true
    return { ok: true, value: data as T }
  }
  async reserve(key: string, units: number, cap: number, ttlMs: number, now = Date.now(), searches?: SearchBudget): Promise<Reservation> {
    const r = await this.rpc<{ ok: boolean; used: number; used_searches?: number; reason?: string }>('research_reserve', { p_key: key, p_units: units, p_cap: cap, p_ttl_seconds: Math.round(ttlMs / 1000), p_searches: searches?.need ?? 0, p_search_cap: searches?.cap ?? 1_000_000 })
    if (r.ok) {
      const v = r.value, us = v.used_searches ?? 0
      return v.ok ? { ok: true, used: v.used, usedSearches: us } : { ok: false, reason: v.reason === 'no_session' ? 'no_session' : v.reason === 'search_budget' ? 'search_budget' : 'budget', used: v.used ?? 0, usedSearches: us }
    }
    // Not atomic: without the database functions two instances could both pass this check (documented limitation).
    const used = await this.unitsSince(quotaDayStart(now)), usedSearches = await this.searchesSince(quotaDayStart(now))
    if (used + units > cap) return { ok: false, reason: 'budget', used, usedSearches }
    if (searches && usedSearches + searches.need > searches.cap) return { ok: false, reason: 'search_budget', used, usedSearches }
    await this.put(key, 'reserve', {}, units, ttlMs, now, searches?.need ?? 0)
    return { ok: true, used: used + units, usedSearches: usedSearches + (searches?.need ?? 0) }
  }
  async settle(key: string, actual: number, now = Date.now(), actualSearches = 0) {
    const { error } = await this.db.from('research_cache').update({ kind: 'usage', units: Math.max(Math.round(actual), 0), searches: Math.max(Math.round(actualSearches), 0), fetched_at: new Date(now).toISOString(), expires_at: new Date(now + 2 * 86400000).toISOString() }).eq('owner_id', this.owner).eq('cache_key', key)
    if (error) throw error
  }
  async release(key: string) { await this.delete(key) }
  async lock(key: string, ttlMs: number, now = Date.now()) {
    const r = await this.rpc<boolean>('research_lock', { p_key: `v2|lock|${key}`, p_ttl_seconds: Math.max(Math.round(ttlMs / 1000), 1) })
    if (r.ok) return r.value === true
    const k = `v2|lock|${key}`
    const { data, error } = await this.db.from('research_cache').select('expires_at').eq('owner_id', this.owner).eq('cache_key', k).limit(1)
    if (error) throw error
    const row = (data as Array<{ expires_at: string }> | null)?.[0]
    if (row && Date.parse(row.expires_at) > now) return false
    await this.put(k, 'lock', {}, 0, ttlMs, now); return true
  }
  async unlock(key: string) { await this.delete(`v2|lock|${key}`) }
}

/** The table is simply not there (migration not applied yet), as opposed to a transient failure of the database. */
export const isMissingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .*research_cache.* does not exist|could not find the table .*research_cache/i.test(e.message ?? ''))

/**
 * Uses the table when it exists; falls back to memory ONLY when the table is missing (migration not applied yet). Any other failure means
 * the daily counter cannot be read, and a paid search must not run without one: it throws CounterUnavailableError (fail closed).
 */
export async function openStore(db: Db, owner: string): Promise<CacheStore> {
  const probe = await db.from('research_cache').select('id').eq('owner_id', owner).limit(1)
  if (probe.error) {
    if (isMissingTable(probe.error)) return new MemoryCacheStore(owner)
    console.error('research_cache unavailable', probe.error.message ?? probe.error)
    throw new CounterUnavailableError()
  }
  return new SupabaseCacheStore(db, owner)
}

/**
 * Records quota spent by calls that are not cached analyses (free-text searches, official charts) so that the server-side daily counter
 * and the budget check see ALL of the project's research spending. Never throws: a failed log must not hide data already paid for.
 */
export async function recordUsage(store: CacheStore, kind: string, units: number, now = Date.now(), searches = 0) {
  try { await store.put(`v1|usage|${kind}|${now}|${Math.random().toString(36).slice(2, 8)}`, 'usage', {}, units, 2 * 86400000, now, searches) } catch (e) { console.error('Could not record research usage', e instanceof Error ? e.message : e) }
}

/** The official daily limits as observed in the Google Cloud console (to be confirmed there: they are NOT read from the API). */
export const OFFICIAL_LIMITS = { units: 10_000, searches: 100 } as const

/**
 * YouTube itself said the quota is spent (quotaExceeded / 403 / 429) although this app's own counters had room: other applications that
 * share the Google Cloud project spend from the same pool. From then until the next Pacific midnight the app treats BOTH limits as full.
 */
export async function markExhausted(store: CacheStore, now = Date.now()) {
  try {
    const used = await store.unitsSince(quotaDayStart(now)), usedSearches = await store.searchesSince(quotaDayStart(now))
    const key = `v2|exhausted|${quotaDayKey(now)}`
    await store.put(key, 'exhausted', {}, Math.max(OFFICIAL_LIMITS.units - used, 0) + 0, 2 * 86400000, now, Math.max(OFFICIAL_LIMITS.searches - usedSearches, 0))
  } catch (e) { console.error('Could not record exhausted quota', e instanceof Error ? e.message : e) }
}
export async function isExhausted(store: CacheStore, now = Date.now()) {
  try { return !!(await store.get(`v2|exhausted|${quotaDayKey(now)}`, now)) } catch { return false }
}
