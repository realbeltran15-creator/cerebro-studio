/**
 * Display helpers for opportunity metrics. Observed values come from a source (API or manual);
 * calculated values are derived by Cerebro. They are always shown apart and never invented.
 */

type Metrics = Record<string, unknown> | null | undefined

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const fmt = (v: number) => v.toLocaleString('es-ES', { notation: v >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 2 })

const observedLabels: Array<[string, string, (v: number) => string]> = [
  ['views', 'vistas', fmt], ['likes', 'likes', fmt], ['comments', 'comentarios', fmt],
  ['channelSubscribers', 'suscriptores del canal', fmt],
  ['durationSeconds', 'duración', v => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`],
]
const calculatedLabels: Array<[string, string, (v: number) => string]> = [
  ['viewsPerDay', 'vistas/día', fmt], ['viewsToSubscribers', 'vistas/suscriptores', v => fmt(v)], ['engagementRate', 'interacción', v => `${fmt(v)}%`],
  ['viewsGainedSinceLastCheck', 'vistas desde la última lectura', v => `${v >= 0 ? '+' : ''}${fmt(v)}`],
  ['viewsPerDaySinceLastCheck', 'vistas/día recientes', fmt],
]

function describe(m: Metrics, labels: typeof observedLabels) {
  if (!m) return []
  return labels.flatMap(([key, label, f]) => { const v = num(m[key]); return v === null ? [] : [`${f(v)} ${label}`] })
}

export const observedSummary = (m: Metrics) => describe(m, observedLabels)
export const calculatedSummary = (m: Metrics) => describe(m, calculatedLabels)

export function observedAt(m: Metrics) {
  return m && typeof m.fetchedAt === 'string' ? m.fetchedAt : null
}

/** Views across stored readings, oldest first, including the current one. */
export function viewsHistory(m: Metrics) {
  if (!m) return []
  const past = Array.isArray(m.history) ? (m.history as Array<Record<string, unknown>>).flatMap(h => num(h.views) === null || typeof h.fetchedAt !== 'string' ? [] : [{ at: h.fetchedAt, views: num(h.views)! }]) : []
  const current = num(m.views)
  return current !== null && typeof m.fetchedAt === 'string' ? [...past, { at: m.fetchedAt, views: current }] : past
}

export type MetricSort = 'viewsPerDay' | 'viewsToSubscribers' | 'growth'

/** Sort key; opportunities without the metric sort last. */
export function metricSortValue(observed: Metrics, calculated: Metrics, sort: MetricSort) {
  const key = sort === 'growth' ? 'viewsPerDaySinceLastCheck' : sort
  return num(calculated?.[key]) ?? num(observed?.[key]) ?? Number.NEGATIVE_INFINITY
}
