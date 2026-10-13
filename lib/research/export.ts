import { marketLabel } from './markets'
import { formatOpportunity, type TopicAnalysis } from './topic-analysis'

/** CSV safe to open in spreadsheets: quotes fields and neutralises formulas that start with = + - @. */
export function csvCell(v: unknown) {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (rows: unknown[][]) => rows.map(r => r.map(csvCell).join(',')).join('\n')

export function analysesCsv(list: TopicAnalysis[]) {
  return toCsv([
    ['tema', 'mercado', 'veredicto', 'demanda', 'oferta', 'competencia', 'crecimiento', 'oportunidad', 'confianza', 'muestra_top', 'muestra_recientes', 'formato_recomendado', 'fuente', 'actualizado'],
    ...list.map(a => [a.topic, marketLabel(a.region, a.language), a.verdict, a.indices.demand, a.indices.supply, a.indices.competition, a.indices.growth, a.indices.opportunity, a.confidence, a.sampleSizes.top, a.sampleSizes.recent, formatOpportunity(a).recommended ?? '', 'YouTube Data API (muestra)', a.fetchedAt]),
  ])
}

/** Related terms, questions and emerging terms of one analysis. Relative signals only: there is no search volume in this data. */
export function keywordsCsv(a: TopicAnalysis) {
  return toCsv([
    ['tipo', 'texto', 'vídeos_con_el_término', 'vistas_de_esos_vídeos', 'mercado', 'nota'],
    ...a.terms.map(t => ['término', t.term, t.videos, t.views, marketLabel(a.region, a.language), 'señal relativa de la muestra; no es volumen de búsqueda']),
    ...a.emerging.map(t => ['emergente', t.term, t.videos, t.views, marketLabel(a.region, a.language), 'pesa más en vídeos recientes que en el top del año']),
    ...a.questions.map(q => ['pregunta', q.text, '', q.views ?? '', marketLabel(a.region, a.language), 'título de vídeo formulado como pregunta']),
  ])
}
