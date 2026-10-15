/**
 * Cache and daily-budget log for the paid research samples. Rows live in `research_cache` (per user, RLS). If the table has not been
 * created yet the memory store takes over: it still prevents repeats inside one server instance but cannot enforce a budget across
 * instances, and `persistent` says so.
 */
export type CacheHit<T> = { payload: T; fetchedAt: string; units: number }

export interface CacheStore {
  readonly persistent: boolean
  get<T>(key: string, now?: number): Promise<CacheHit<T> | null>
  put(key: string, kind: string, payload: unknown, units: number, ttlMs: number, now?: number): Promise<void>
  /** Units spent by fresh fetches since the given instant. */
  unitsSince(sinceMs: number): Promise<number>
}

export const DEFAULT_TTL_MS = 7 * 86400000

export function cacheKey(kind: string, parts: Array<string | null | undefined>) {
  return ['v1', kind, ...parts.map(p => (p ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' '))].join('|')
}

export const startOfUtcDay = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }

const memory = new Map<string, Map<string, { payload: unknown; fetchedAt: number; expiresAt: number; units: number }>>()

export class MemoryCacheStore implements CacheStore {
  readonly persistent = false
  private rows: Map<string, { payload: unknown; fetchedAt: number; expiresAt: number; units: number }>
  constructor(owner: string) { this.rows = memory.get(owner) ?? new Map(); memory.set(owner, this.rows) }
  async get<T>(key: string, now = Date.now()) { const r = this.rows.get(key); return r && r.expiresAt > now ? { payload: r.payload as T, fetchedAt: new Date(r.fetchedAt).toISOString(), units: r.units } : null }
  async put(key: string, _kind: string, payload: unknown, units: number, ttlMs: number, now = Date.now()) { this.rows.set(key, { payload, fetchedAt: now, expiresAt: now + ttlMs, units }) }
  async unitsSince(sinceMs: number) { let t = 0; for (const r of this.rows.values()) if (r.fetchedAt >= sinceMs) t += r.units; return t }
}

// The Supabase query builder is too generic to type structurally here; the store only uses select/eq/gte/upsert.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export class SupabaseCacheStore implements CacheStore {
  readonly persistent = true
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
  }
  async unitsSince(sinceMs: number) {
    const { data, error } = await this.db.from('research_cache').select('units').eq('owner_id', this.owner).gte('fetched_at', new Date(sinceMs).toISOString())
    if (error) throw error
    return ((data ?? []) as Array<{ units: number }>).reduce((t, r) => t + (r.units ?? 0), 0)
  }
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
