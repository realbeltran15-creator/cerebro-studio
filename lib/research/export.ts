import { GEO_LEVEL_LABEL } from './geo'
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
    ['tema', 'mercado', 'veredicto', 'demanda', 'oferta', 'competencia', 'crecimiento', 'oportunidad', 'confianza', 'muestra_top', 'muestra_recientes', 'formato_recomendado', 'confianza_geografica', 'fuente', 'actualizado'],
    ...list.map(a => [a.topic, marketLabel(a.region, a.language), a.verdict, a.indices.demand, a.indices.supply, a.indices.competition, a.indices.growth ?? 'No calculable', a.indices.opportunity, a.confidence, a.sampleSizes.top, a.sampleSizes.recent, formatOpportunity(a).recommended ?? '', a.geo && a.geo.requested ? GEO_LEVEL_LABEL[a.geo.level] : 'sin país pedido', 'YouTube Data API (muestra)', a.fetchedAt]),
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

const STATUS = { aceptado: 'aceptado', dudoso: 'dudoso (sin confirmar)', descartado: 'descartado' } as const
/** Every video the search returned for one analysis, accepted or not, with the reason: lets the user audit the engine's judgement. */
export function sampleCsv(a: TopicAnalysis) {
  return toCsv([
    ['estado', 'motivo', 'detalle', 'título', 'canal', 'enlace', 'vistas', 'publicado', 'duración_s', 'muestra', 'idioma', 'verificación_idioma', 'posible_anuncio', 'viral_atípico', 'formato_inferido', 'consulta', 'mercado', 'fecha_consulta'],
    ...(a.sample ?? []).map(v => [STATUS[v.status], v.reason ?? '', v.detail, v.title, v.channelTitle, v.url, v.views ?? '', v.publishedAt, v.durationSeconds ?? '', v.inTop && v.inRecent ? 'más vistos y recientes' : v.inTop ? 'más vistos del año' : 'recientes', v.language ?? '', v.languageVerdict, v.promo ? 'sí' : 'no', v.outlier ? 'sí' : 'no', v.format, a.topic, marketLabel(a.region, a.language), a.fetchedAt]),
  ])
}
