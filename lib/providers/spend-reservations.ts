/**
 * In-memory holds on the spending cap. The cap check reads what was spent and the booking happens later, so N parallel paid requests
 * could all pass the check. A request takes a hold synchronously right after its check passes; the next one sees it.
 * Per instance only: the complete fix is an atomic reservation in the database (see supabase/pending).
 */
type Hold = { id: string; usd: number; until: number }
const holds = new Map<string, Hold[]>()
const TTL_MS = 120_000

const live = (owner: string, now: number) => {
  const list = (holds.get(owner) ?? []).filter(h => h.until > now)
  if (list.length) holds.set(owner, list); else holds.delete(owner)
  return list
}

export const heldUsd = (owner: string, now = Date.now()) => live(owner, now).reduce((s, h) => s + h.usd, 0)

export function holdSpend(owner: string, usd: number, now = Date.now()) {
  const id = `${now}-${Math.random().toString(36).slice(2, 10)}`
  holds.set(owner, [...live(owner, now), { id, usd, until: now + TTL_MS }])
  return id
}

export function releaseSpend(owner: string, id: string) {
  const list = (holds.get(owner) ?? []).filter(h => h.id !== id)
  if (list.length) holds.set(owner, list); else holds.delete(owner)
}
