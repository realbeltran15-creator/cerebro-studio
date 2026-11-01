/**
 * Explicación y comparación de oportunidades SIN puntuaciones inventadas.
 * Todo sale de datos guardados: observado (con fuente), calculado (derivado) y lo que FALTA. Nunca probabilidad de éxito ni viralidad.
 */
import { calculatedSummary, observedAt, observedSummary, viewsHistory } from './opportunity-metrics'
import { metricsFreshness, type Freshness } from './opportunity-project'

type Metrics = Record<string, unknown> | null | undefined
export type Opp = {
  id: string; title: string; source_platform: string; source_id: string | null; query: string | null; region: string | null; language: string | null
  status: string; created_at: string; observed_metrics: Metrics; calculated_metrics: Metrics; evidence?: unknown; confidence?: number | null
}

export type Explanation = {
  observed: string[]; calculated: string[]; estimated: string[]; missing: string[]; risks: string[]
  freshness: Freshness; hasSource: boolean; readings: number
  /** Cuántas evidencias comprobables respaldan la oportunidad. NO es una probabilidad. */
  evidenceCount: number
  evidenceLevel: 'sin_datos' | 'baja' | 'media' | 'alta'
}

const num = (m: Metrics, k: string) => (m && typeof m[k] === 'number' && Number.isFinite(m[k] as number) ? (m[k] as number) : null)

export function explainOpportunity(o: Opp, now: number): Explanation {
  const observed = observedSummary(o.observed_metrics)
  const calculated = calculatedSummary(o.calculated_metrics)
  const freshness = metricsFreshness(o.observed_metrics, now)
  const readings = viewsHistory(o.observed_metrics).length
  const hasSource = !!o.source_id && /^https?:\/\//.test(o.source_id)
  const notes = Array.isArray(o.evidence) ? o.evidence.filter(e => e && typeof e === 'object' && typeof (e as { note?: unknown }).note === 'string' && (e as { note: string }).note.trim()).length : 0

  const missing: string[] = []
  if (!observed.length) missing.push('Métricas observadas (vistas, interacción): sin lectura guardada')
  if (num(o.observed_metrics, 'channelSubscribers') === null) missing.push('Tamaño del canal de origen (suscriptores)')
  if (readings < 2) missing.push('Al menos dos lecturas para medir crecimiento')
  if (!hasSource) missing.push('Enlace a la fuente original verificable')
  if (!o.region && !o.language) missing.push('Mercado (país/idioma) del hallazgo')
  missing.push('Demanda y competencia del tema (requieren una investigación de palabras clave)')

  const risks: string[] = []
  if (freshness.level === 'stale') risks.push(`Datos desactualizados (hace ${freshness.days} días)`)
  if (readings === 1) risks.push('Una sola lectura: no distingue un pico puntual de una tendencia')
  if (o.source_platform === 'manual') risks.push('Hallazgo manual sin verificación automática')
  if (!observed.length && !notes) risks.push('Sin evidencias comprobables: es una idea, no una oportunidad medida')
  risks.push('Que un vídeo ajeno funcione no garantiza que el tuyo funcione')

  const evidenceCount = (observed.length ? 1 : 0) + (calculated.length ? 1 : 0) + (hasSource ? 1 : 0) + (readings >= 2 ? 1 : 0) + (notes ? 1 : 0)
  const evidenceLevel: Explanation['evidenceLevel'] = evidenceCount === 0 ? 'sin_datos' : evidenceCount <= 2 ? 'baja' : evidenceCount <= 3 ? 'media' : 'alta'
  return { observed, calculated, estimated: [], missing, risks, freshness, hasSource, readings, evidenceCount, evidenceLevel }
}

export const evidenceLabel: Record<Explanation['evidenceLevel'], string> = {
  sin_datos: 'Sin datos suficientes', baja: 'Evidencia baja', media: 'Evidencia media', alta: 'Evidencia alta',
}

export const NO_DATA = 'Sin datos suficientes'
export const MAX_COMPARE = 4

export type CompareRow = { label: string; values: string[] }

/** Tabla lado a lado. Donde falta información dice «Sin datos suficientes»; nunca rellena con estimaciones. */
export function compareOpportunities(list: Opp[], now: number): { rows: CompareRow[]; error?: string } {
  if (list.length < 2) return { rows: [], error: 'Selecciona al menos 2 oportunidades.' }
  if (list.length > MAX_COMPARE) return { rows: [], error: `Se pueden comparar como máximo ${MAX_COMPARE}.` }
  const ex = list.map(o => explainOpportunity(o, now))
  const metric = (o: Opp, k: string, f: (n: number) => string) => { const v = num(o.observed_metrics, k) ?? num(o.calculated_metrics, k); return v === null ? NO_DATA : f(v) }
  const n = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 })
  const date = (o: Opp) => { const at = observedAt(o.observed_metrics); return at ? at.slice(0, 10) : NO_DATA }
  return {
    rows: [
      { label: 'Tema', values: list.map(o => o.title) },
      { label: 'Consulta', values: list.map(o => o.query || NO_DATA) },
      { label: 'Mercado', values: list.map(o => [o.region, o.language].filter(Boolean).join(' / ') || NO_DATA) },
      { label: 'Fuente', values: list.map(o => o.source_platform) },
      { label: 'Enlace verificable', values: ex.map(e => (e.hasSource ? 'Sí' : 'No')) },
      { label: 'Fecha de la lectura', values: list.map(date) },
      { label: 'Frescura', values: ex.map(e => (e.freshness.level === 'none' ? NO_DATA : e.freshness.level === 'stale' ? `Desactualizado (${e.freshness.days} días)` : `Reciente (${e.freshness.days} días)`)) },
      { label: 'Vistas (observado)', values: list.map(o => metric(o, 'views', n)) },
      { label: 'Vistas/día (calculado)', values: list.map(o => metric(o, 'viewsPerDay', n)) },
      { label: 'Vistas / suscriptores (calculado)', values: list.map(o => metric(o, 'viewsToSubscribers', n)) },
      { label: 'Crecimiento reciente (calculado)', values: list.map(o => metric(o, 'viewsPerDaySinceLastCheck', n)) },
      { label: 'Lecturas guardadas', values: ex.map(e => String(e.readings)) },
      { label: 'Nivel de evidencia', values: ex.map(e => `${evidenceLabel[e.evidenceLevel]} (${e.evidenceCount}/5)`) },
      { label: 'Datos que faltan', values: ex.map(e => e.missing.slice(0, 3).join('; ')) },
      { label: 'Riesgos', values: ex.map(e => e.risks.slice(0, 3).join('; ')) },
    ],
  }
}
