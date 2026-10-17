import type { CostTier } from './directory'

/** A model counts as free when it costs nothing to run: the free tier of a provider or a local model. */
export const isFreeTier = (t: CostTier) => t === 'free' || t === 'local'

/**
 * The model that «Automático» preselects: the best ELIGIBLE one that costs nothing. A paid model is never preselected: it must be
 * chosen by the person, who then confirms its cost. `ranked` is the router's order (best first).
 */
export function autoPick<T extends { eligible: boolean; model: { tier: CostTier } }>(ranked: T[]): { auto: T | null; paidEligible: T[] } {
  return { auto: ranked.find(r => r.eligible && isFreeTier(r.model.tier)) ?? null, paidEligible: ranked.filter(r => r.eligible && !isFreeTier(r.model.tier)) }
}
