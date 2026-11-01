/**
 * Convierte una oportunidad en el borrador de un proyecto SIN perder su procedencia:
 * fuente original, consulta, mercado, fecha de la lectura y observaciones. Nada se estima ni se inventa.
 */
import { observedAt, observedSummary } from './opportunity-metrics'

type Opp = {
  title: string; source_platform: string; source_id: string | null; query: string | null; region: string | null; language: string | null
  observed_metrics?: Record<string, unknown> | null; evidence?: unknown; status?: string
}

export const STALE_AFTER_DAYS = 7

export type Freshness = { level: 'none' | 'fresh' | 'stale'; days: number | null }

/** Antigüedad de la última lectura de métricas. Sin lectura => 'none' (no se afirma nada sobre los datos). */
export function metricsFreshness(observed: Record<string, unknown> | null | undefined, now: number): Freshness {
  const at = observedAt(observed)
  const t = at ? Date.parse(at) : NaN
  if (!Number.isFinite(t)) return { level: 'none', days: null }
  const days = Math.max(0, Math.floor((now - t) / 86_400_000))
  return { level: days > STALE_AFTER_DAYS ? 'stale' : 'fresh', days }
}

const notes = (evidence: unknown) =>
  Array.isArray(evidence) ? evidence.flatMap(ev => ev && typeof ev === 'object' && !Array.isArray(ev) && typeof (ev as { note?: unknown }).note === 'string' && (ev as { note: string }).note.trim() ? [(ev as { note: string }).note.trim()] : []) : []

export function projectDraftFromOpportunity(o: Opp, now: number) {
  const url = o.source_id && /^https?:\/\//.test(o.source_id) ? o.source_id : null
  const metrics = observedSummary(o.observed_metrics)
  const at = observedAt(o.observed_metrics)
  const fresh = metricsFreshness(o.observed_metrics, now)
  const lines = [
    `Oportunidad (${o.source_platform}${o.query ? ` · ${o.query}` : ''})`,
    ...(o.region || o.language ? [`Mercado: ${[o.region, o.language].filter(Boolean).join(' / ')}`] : []),
    ...(url ? [`Fuente original: ${url}`] : o.source_id ? [`Referencia de la fuente: ${o.source_id}`] : []),
    ...(metrics.length ? [`Observado${at ? ` el ${at.slice(0, 10)}` : ''}${fresh.level === 'stale' ? ` (hace ${fresh.days} días: pueden estar desactualizados)` : ''}: ${metrics.join(' · ')}`] : []),
    ...notes(o.evidence).map(n => `Observación: ${n}`),
  ]
  return { name: o.title, status: 'research' as const, target_platforms: ['youtube'], description: lines.join('\n') }
}
