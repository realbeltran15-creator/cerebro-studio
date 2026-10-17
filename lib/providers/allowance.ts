/**
 * Free-allowance accounting. Providers give three different kinds of free credit and they must not be
 * confused: daily (renews every day), monthly (renews every month) and promo (a one-off grant that expires).
 *
 * Cerebro can only count what it generated itself: each generation stores `allowancePool` and
 * `allowanceUnits` in the asset provenance. Usage made elsewhere (the provider's web app, other tools)
 * is invisible here, so the numbers are a floor on what was spent, never a guarantee of what is left.
 * The provider's own refusal (429 and similar) always wins; this only lets us warn before sending.
 */
import type { Allowance } from './catalog'

export type AllowanceAsset = { created_at: string; provenance: Record<string, unknown> | null }

export type PoolStatus = {
  pool: string
  kind: Allowance['kind']
  unit: Allowance['unit']
  amount: number
  /** Units Cerebro has recorded inside the current window. */
  used: number
  remaining: number
  windowStart: string | null
  /** When a daily/monthly pool renews, or when a promo grant expires (null = unknown). */
  endsAt: string | null
  expired: boolean
  exhausted: boolean
  note: string
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function windowFor(a: Allowance, now: Date, promoStart?: Date | null): { start: Date | null; end: Date | null } {
  if (a.kind === 'daily') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    return { start, end: new Date(start.getTime() + 86_400_000) }
  }
  if (a.kind === 'monthly') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) }
  }
  // promo: counts everything since activation; the end date is only known when the activation date is.
  if (promoStart && a.validDays) return { start: promoStart, end: new Date(promoStart.getTime() + a.validDays * 86_400_000) }
  return { start: promoStart ?? null, end: null }
}

export function poolStatus(a: Allowance, assets: AllowanceAsset[], now: Date, promoStart?: Date | null): PoolStatus {
  const { start, end } = windowFor(a, now, promoStart)
  const used = assets.reduce((total, asset) => {
    const p = asset.provenance
    if (!p || p.allowancePool !== a.pool) return total
    const at = Date.parse(asset.created_at)
    if (!Number.isFinite(at) || (start && at < start.getTime()) || (end && at >= end.getTime())) return total
    return total + num(p.allowanceUnits)
  }, 0)
  const expired = a.kind === 'promo' && end !== null && now.getTime() >= end.getTime()
  const remaining = expired ? 0 : Math.max(0, Math.round((a.amount - used) * 100) / 100)
  return {
    pool: a.pool, kind: a.kind, unit: a.unit, amount: a.amount, used: Math.round(used * 100) / 100, remaining,
    windowStart: start ? start.toISOString() : null, endsAt: end ? end.toISOString() : null, expired,
    exhausted: remaining <= 0, note: a.note,
  }
}

/** Whether a generation that needs `units` still fits (always true when the units are unknown/zero). */
export const fits = (status: PoolStatus | undefined, units: number) => !status || units <= 0 || status.remaining + 1e-9 >= units

export function statusLabel(s: PoolStatus) {
  const kind = s.kind === 'daily' ? 'diario' : s.kind === 'monthly' ? 'mensual' : 'promocional'
  if (s.expired) return `Crédito ${kind} caducado`
  return `${Math.round(s.remaining).toLocaleString('es-ES')} de ${s.amount.toLocaleString('es-ES')} ${unitLabel[s.unit]} (${kind})`
}

export const unitLabel: Record<Allowance['unit'], string> = { neurons: 'neuronas', seconds: 's', characters: 'caracteres', usd: 'USD' }

/** Optional env var holding the activation date of a promo grant (ISO date), so its expiry can be tracked. */
export const promoStartEnv: Record<string, string> = { 'alibaba-wan-promo': 'DASHSCOPE_PROMO_START', 'topmediai-tts-chars': 'TOPMEDIAI_FREE_START' }

export function promoStartFor(pool: string, env: Record<string, string | undefined>): Date | null {
  const raw = env[promoStartEnv[pool] ?? '']?.trim()
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
