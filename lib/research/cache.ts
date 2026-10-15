/**
 * Cache and daily-budget log for the paid research samples. Rows live in `research_cache` (per user, RLS). If the table has not been
 * created yet the memory store takes over: it still prevents repeats inside one server instance but cannot enforce a budget across
 * instances, and `persistent` says so.
 */
export type CacheHit<T> = { payload: T; fetchedAt: string; units: number }

/** Result of reserving quota BEFORE spending it. `used` includes this reservation when `ok`. */
export type Reservation = { ok: true; used: number } | { ok: false; reason: 'budget' | 'no_session'; used: number }

export interface CacheStore {
  readonly persistent: boolean
  /** True when check-and-reserve and the lock are atomic across every server instance (database functions), not just inside one process. */
  readonly atomic: boolean
  get<T>(key: string, now?: number): Promise<CacheHit<T> | null>
  put(key: string, kind: string, payload: unknown, units: number, ttlMs: number, now?: number): Promise<void>
  delete(key: string): Promise<void>
  /** Units spent or reserved since the given instant (fresh fetches, usage lines and live reservations). */
  unitsSince(sinceMs: number): Promise<number>
  /**
   * Reserve `units` of today's budget BEFORE calling YouTube. The check and the reservation happen together, so two instances can never
   * both pass the cap. A reservation counts as spent until `settle` replaces it with the real amount or `release` drops it.
   */
  reserve(key: string, units: number, cap: number, ttlMs: number, now?: number): Promise<Reservation>
  settle(key: string, actualUnits: number, now?: number): Promise<void>
  release(key: string): Promise<void>
  /** Exclusive lease on one piece of work (e.g. one topic in one market) for `ttlMs`; false when another instance holds it. */
  lock(key: string, ttlMs: number, now?: number): Promise<boolean>
  unlock(key: string): Promise<void>
}

export const DEFAULT_TTL_MS = 7 * 86400000

export function cacheKey(kind: string, parts: Array<string | null | undefined>) {
  // v2: analyses made before the relevance/language/growth rules are never reused (they could contain off-topic videos).
  return ['v2', kind, ...parts.map(p => (p ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' '))].join('|')
}

export const startOfUtcDay = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }

/**
 * YouTube Data API quota resets at midnight PACIFIC time (America/Los_Angeles, with daylight saving), not at midnight UTC. The daily
 * budget is therefore counted from the last Pacific midnight, so that «today» in this app is the same «today» YouTube bills against.
 */
export function quotaDayStart(now = Date.now()): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const wall = (t: number) => { const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, Number(x.value)])); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) }
  const t0 = wall(now), midnightWall = t0 - (t0 % 86400000)           // the Pacific wall clock, truncated to its own midnight
  let guess = now - (t0 - midnightWall)                                // first estimate in real time
  for (let i = 0; i < 3; i++) guess += midnightWall - wall(guess)      // correct for a daylight-saving change between midnight and now
  return guess
}

type MemRow = { kind: string; payload: unknown; fetchedAt: number; expiresAt: number; units: number }
const memory = new Map<string, Map<string, MemRow>>()

export class MemoryCacheStore implements CacheStore {
  readonly persistent = false
  readonly atomic = true     // single-threaded: every check-and-set below runs without an await in between
  private rows: Map<string, MemRow>
  constructor(owner: string) { this.rows = memory.get(owner) ?? new Map(); memory.set(owner, this.rows) }
  async get<T>(key: string, now = Date.now()) { const r = this.rows.get(key); return r && r.expiresAt > now && r.kind !== 'lock' && r.kind !== 'reserve' ? { payload: r.payload as T, fetchedAt: new Date(r.fetchedAt).toISOString(), units: r.units } : null }
  async put(key: string, kind: string, payload: unknown, units: number, ttlMs: number, now = Date.now()) { this.rows.set(key, { kind, payload, fetchedAt: now, expiresAt: now + ttlMs, units }) }
  async delete(key: string) { this.rows.delete(key) }
  async unitsSince(sinceMs: number) { let t = 0; for (const r of this.rows.values()) if (r.fetchedAt >= sinceMs) t += r.units; return t }
  async reserve(key: string, units: number, cap: number, ttlMs: number, now = Date.now()): Promise<Reservation> {
    let used = 0; for (const r of this.rows.values()) if (r.fetchedAt >= quotaDayStart(now)) used += r.units
    if (used + units > cap) return { ok: false, reason: 'budget', used }
    this.rows.set(key, { kind: 'reserve', payload: {}, fetchedAt: now, expiresAt: now + ttlMs, units })
    return { ok: true, used: used + units }
  }
  async settle(key: string, actual: number, now = Date.now()) { this.rows.set(key, { kind: 'usage', payload: {}, fetchedAt: now, expiresAt: now + 2 * 86400000, units: Math.max(Math.round(actual), 0) }) }
  async release(key: string) { this.rows.delete(key) }
  async lock(key: string, ttlMs: number, now = Date.now()) {
    const k = `v2|lock|${key}`, r = this.rows.get(k)
    if (r && r.expiresAt > now) return false
    this.rows.set(k, { kind: 'lock', payload: {}, fetchedAt: now, expiresAt: now + ttlMs, units: 0 }); return true
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
  async put(key: string, kind: string, payload: unknown, units: number, ttlMs: number, now = Date.now()) {
    const { error } = await this.db.from('research_cache').upsert({ owner_id: this.owner, cache_key: key, kind, payload, units, fetched_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString() }, { onConflict: 'owner_id,cache_key' })
    if (error) throw error
    // Housekeeping: now and then drop this user's rows that expired a month ago (cached analyses and usage log lines). Best effort.
    if (Math.random() < 0.05) await this.db.from('research_cache').delete().eq('owner_id', this.owner).lt('expires_at', new Date(now - 30 * 86400000).toISOString()).then(() => undefined, () => undefined)
  }
  async delete(key: string) { const { error } = await this.db.from('research_cache').delete().eq('owner_id', this.owner).eq('cache_key', key); if (error) throw error }
  async unitsSince(sinceMs: number) {
    const { data, error } = await this.db.from('research_cache').select('units').eq('owner_id', this.owner).gte('fetched_at', new Date(sinceMs).toISOString())
    if (error) throw error
    return ((data ?? []) as Array<{ units: number }>).reduce((t, r) => t + (r.units ?? 0), 0)
  }
  /** Database function (atomic under an advisory lock); falls back to check-then-insert when the function is not installed. */
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; value: T } | { ok: false }> {
    if (this.rpcMissing || typeof this.db.rpc !== 'function') return { ok: false }
    const { data, error } = await this.db.rpc(fn, args)
    if (error) { if (missingFunction(error)) { this.rpcMissing = true; return { ok: false } } throw error }
    this.atomic = true
    return { ok: true, value: data as T }
  }
  async reserve(key: string, units: number, cap: number, ttlMs: number, now = Date.now()): Promise<Reservation> {
    const r = await this.rpc<{ ok: boolean; used: number; reason?: string }>('research_reserve', { p_key: key, p_units: units, p_cap: cap, p_ttl_seconds: Math.round(ttlMs / 1000) })
    if (r.ok) return r.value.ok ? { ok: true, used: r.value.used } : { ok: false, reason: r.value.reason === 'no_session' ? 'no_session' : 'budget', used: r.value.used ?? 0 }
    const used = await this.unitsSince(quotaDayStart(now))      // not atomic: two instances could both pass here (documented limitation without the function)
    if (used + units > cap) return { ok: false, reason: 'budget', used }
    await this.put(key, 'reserve', {}, units, ttlMs, now)
    return { ok: true, used: used + units }
  }
  async settle(key: string, actual: number, now = Date.now()) {
    const { error } = await this.db.from('research_cache').update({ kind: 'usage', units: Math.max(Math.round(actual), 0), fetched_at: new Date(now).toISOString(), expires_at: new Date(now + 2 * 86400000).toISOString() }).eq('owner_id', this.owner).eq('cache_key', key)
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

/** Uses the table when it exists; falls back to memory when it does not (migration not applied yet). */
export async function openStore(db: Db, owner: string): Promise<CacheStore> {
  const probe = await db.from('research_cache').select('id').eq('owner_id', owner).limit(1)
  if (probe.error) return new MemoryCacheStore(owner)
  return new SupabaseCacheStore(db, owner)
}

/**
 * Records quota spent by calls that are not cached analyses (free-text searches, official charts) so that the server-side daily counter
 * and the budget check see ALL of the project's research spending. Never throws: a failed log must not hide data already paid for.
 */
export async function recordUsage(store: CacheStore, kind: string, units: number, now = Date.now()) {
  try { await store.put(`v1|usage|${kind}|${now}|${Math.random().toString(36).slice(2, 8)}`, 'usage', {}, units, 2 * 86400000, now) } catch (e) { console.error('Could not record research usage', e instanceof Error ? e.message : e) }
}
