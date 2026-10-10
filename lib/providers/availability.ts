import type { SupabaseClient } from '@supabase/supabase-js'
import { POOLS, isConfigured, type Allowance, type CatalogModel } from './catalog'
import { poolStatus, promoStartFor, type AllowanceAsset, type PoolStatus } from './allowance'
import type { Availability } from './router'

/** Every distinct free-allowance pool declared by the catalogue. */
export const allPools = (models: CatalogModel[]): Allowance[] => {
  const seen = new Map<string, Allowance>()
  for (const m of models) if (m.allowance && !seen.has(m.allowance.pool)) seen.set(m.allowance.pool, m.allowance)
  return [...seen.values()]
}

/** Assets older than this cannot matter: the longest window is a 90-day promo (plus a margin). */
const LOOKBACK_DAYS = 120

export async function loadPoolStatuses(db: SupabaseClient, ownerId: string, models: CatalogModel[], env: Record<string, string | undefined>, now = new Date()): Promise<Record<string, PoolStatus>> {
  const pools = allPools(models)
  if (!pools.length) return {}
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data } = await db.from('assets').select('created_at,provenance').eq('owner_id', ownerId).gte('created_at', since)
    .not('provenance->>allowancePool', 'is', null).order('created_at', { ascending: false }).limit(2000)
  const assets = (data ?? []) as AllowanceAsset[]
  return Object.fromEntries(pools.map(p => [p.pool, poolStatus(p, assets, now, p.kind === 'promo' ? promoStartFor(p.pool, env) : null)]))
}

/**
 * Availability map for the router. `balances` carries live figures when a provider reports them
 * (ElevenLabs does); otherwise remaining comes from Cerebro's own counter of what it generated.
 */
export function buildAvailability(models: CatalogModel[], env: Record<string, string | undefined>, pools: Record<string, PoolStatus>, opts: { jobsReady: boolean; exhaustedProviders?: string[] }): Record<string, Availability> {
  const out: Record<string, Availability> = {}
  for (const m of models) {
    const status = m.allowance ? pools[m.allowance.pool] : undefined
    out[m.id] = {
      ready: isConfigured(m, env) && (m.sync || opts.jobsReady),
      creditsExhausted: opts.exhaustedProviders?.includes(m.provider) || undefined,
      remaining: status ? status.remaining : undefined,
    }
  }
  return out
}

export { POOLS }
