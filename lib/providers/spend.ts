/**
 * Server-side spending caps for paid AI generations (USD, list-price estimates).
 *
 * The cost confirmation in the page only proves the user saw an estimate; it does not stop a run of confirmed clicks, a script, or a
 * second tab from spending without limit. Every paid generation is therefore checked here against a daily and a monthly cap BEFORE
 * anything is sent to the provider. What counts as spent: the estimate recorded with each generated asset (same rule as /usage) plus
 * queued jobs that have not produced an asset yet (job ledger). Prepaid-credit providers (tier 'credits') and free tiers are not cash
 * spend and are not counted; their own balance or allowance guards apply.
 *
 * Caps (USD): GENERATION_DAILY_CAP_USD (default 5) and GENERATION_MONTHLY_CAP_USD (default 25). 0 disables paid generations.
 * Windows are UTC calendar day and month. Estimates are list prices: the provider's invoice is the reference.
 */
import { entryOf, isGeneration, type UsageAsset } from './usage'

export type SpendCaps = { dailyUsd: number; monthlyUsd: number }
export const DEFAULT_CAPS: SpendCaps = { dailyUsd: 5, monthlyUsd: 25 }

function parseCap(raw: string | undefined, fallback: number) {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function spendCaps(env: Record<string, string | undefined>): SpendCaps {
  return { dailyUsd: parseCap(env.GENERATION_DAILY_CAP_USD, DEFAULT_CAPS.dailyUsd), monthlyUsd: parseCap(env.GENERATION_MONTHLY_CAP_USD, DEFAULT_CAPS.monthlyUsd) }
}

export type PendingSpend = { createdAt: string; estimateUsd: number; tier?: string }
export type SpendStatus = { todayUsd: number; monthUsd: number; caps: SpendCaps; dayStart: string; monthStart: string }

const round = (n: number) => Math.round(n * 1000) / 1000

export function spendStatus(assets: UsageAsset[], pending: PendingSpend[], caps: SpendCaps, now = new Date()): SpendStatus {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  let today = 0, monthTotal = 0
  const add = (at: number, usd: number) => { if (!(usd > 0) || !Number.isFinite(at)) return; if (at >= month) monthTotal += usd; if (at >= day) today += usd }
  for (const a of assets) { if (!isGeneration(a)) continue; const e = entryOf(a); if (e.tier === 'paid') add(Date.parse(a.created_at), e.estimatedUsd) }
  for (const p of pending) if ((p.tier ?? 'paid') === 'paid') add(Date.parse(p.createdAt), p.estimateUsd)
  return { todayUsd: round(today), monthUsd: round(monthTotal), caps, dayStart: new Date(day).toISOString(), monthStart: new Date(month).toISOString() }
}

/** null when the generation fits; otherwise the reason it is refused (Spanish, for the user). */
export function capViolation(status: SpendStatus, estimateUsd: number): string | null {
  if (!(estimateUsd > 0)) return null
  const usd = (n: number) => `$${n.toFixed(2)}`
  if (status.caps.dailyUsd === 0 || status.caps.monthlyUsd === 0) return 'Las generaciones de pago están desactivadas (tope de gasto 0). Usa un modelo gratuito o sube el tope en la configuración del servidor.'
  if (status.todayUsd + estimateUsd > status.caps.dailyUsd + 1e-9) return `Tope diario de gasto: llevas ${usd(status.todayUsd)} hoy y esta generación (${usd(estimateUsd)}) superaría ${usd(status.caps.dailyUsd)}. No se ha enviado nada.`
  if (status.monthUsd + estimateUsd > status.caps.monthlyUsd + 1e-9) return `Tope mensual de gasto: llevas ${usd(status.monthUsd)} este mes y esta generación (${usd(estimateUsd)}) superaría ${usd(status.caps.monthlyUsd)}. No se ha enviado nada.`
  return null
}
