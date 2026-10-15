import { UNITS, CONFIRM_ABOVE } from './filters'
import { analysisKey, marketLabel, type Market } from './markets'
import { suggestSeeds, seedFallback } from './seeds'
import { COUNTRY_RPM, SCENARIO_VIEWS, formatAdjusted, nicheRpm, revenueScenarios, type RpmReading } from './monetization'
import { formatOpportunity, type TopicAnalysis } from './topic-analysis'
import { nicheLabel, NICHES } from './taxonomy'
import { toCsv } from './export'
import { fmtNumber } from './format'

export type Job = { topic: string; market: Market }

/**
 * Guided research: N candidate subniches per market, in the language of that market, taken from the seed catalogue (editorial queries to
 * TEST; their value is decided by the API data). Every job is one analysis (~204 units); nothing here calls YouTube.
 */
export function planGuided(opts: { markets: Market[]; nicheIds: string[]; perMarket: number; offset?: number }): { jobs: Job[]; fallbackMarkets: string[]; shortfall: Array<{ market: string; wanted: number; got: number }> } {
  const jobs: Job[] = [], fallbackMarkets: string[] = [], shortfall: Array<{ market: string; wanted: number; got: number }> = []
  for (const m of opts.markets) {
    const seeds = suggestSeeds(opts.nicheIds, m.language, Math.max(opts.perMarket, 0), opts.offset ?? 0)
    if (seedFallback(m.language)) fallbackMarkets.push(m.label)
    if (seeds.length < opts.perMarket) shortfall.push({ market: m.label, wanted: opts.perMarket, got: seeds.length })
    for (const t of seeds) jobs.push({ topic: t, market: m })
  }
  return { jobs, fallbackMarkets, shortfall }
}

export const jobKey = (j: Job, recentDays: number) => analysisKey(j.topic, j.market.region, j.market.language, recentDays)
export const pendingJobs = (jobs: Job[], done: Record<string, unknown>, recentDays: number) => jobs.filter(j => !done[jobKey(j, recentDays)])

export type BudgetPlan = { totalUnits: number; pending: number; doneCount: number; todayJobs: number; todayUnits: number; daysNeeded: number; message: string }

/** How much of a queue fits in what is left of today's budget, and how many days the whole queue needs at the daily cap. */
export function budgetPlan(opts: { jobs: Job[]; done: Record<string, unknown>; recentDays: number; remainingToday: number; dailyCap: number; /** Searches left today (a limit separate from the units); omitted = not limiting. */ remainingSearches?: number }): BudgetPlan {
  const pending = pendingJobs(opts.jobs, opts.done, opts.recentDays).length
  const totalUnits = pending * UNITS.topic
  const bySearches = opts.remainingSearches === undefined ? Infinity : Math.max(Math.floor(opts.remainingSearches / 2), 0)
  const todayJobs = Math.min(pending, Math.max(Math.floor(opts.remainingToday / UNITS.topic), 0), bySearches)
  const daysNeeded = pending === 0 ? 0 : Math.ceil(totalUnits / Math.max(opts.dailyCap, UNITS.topic))
  const doneCount = opts.jobs.length - pending
  const message = pending === 0 ? `Plan completo: ${doneCount} de ${opts.jobs.length} análisis hechos.`
    : `${pending} análisis pendientes × ${UNITS.topic} = ${fmtNumber(totalUnits)} unidades. Hoy caben ${todayJobs} (${fmtNumber(todayJobs * UNITS.topic)} unidades); con un tope de ${fmtNumber(opts.dailyCap)} al día hacen falta ${daysNeeded} día${daysNeeded === 1 ? '' : 's'}.${bySearches < Math.floor(opts.remainingToday / UNITS.topic) ? ' Hoy manda el límite de búsquedas de YouTube, no el de unidades.' : ''}`
  return { totalUnits, pending, doneCount, todayJobs, todayUnits: todayJobs * UNITS.topic, daysNeeded, message }
}
export const needsConfirm = (units: number) => units > CONFIRM_ABOVE

// ---------- Editorial viability (NOT measured) ----------
export type Level = 'bajo' | 'medio' | 'alto'
export type Viability = { production: Level; faceless: Level; expertise: Level; copyright: Level; monetizationRisk: Level; automation: Level; note: string }

/**
 * Editorial criteria per niche: how hard it is to produce, whether it works without showing your face, and so on. This is Cerebro Studio's
 * rule of thumb, NOT data from YouTube, and the report labels it that way. `copyright` and `monetizationRisk` mean "risk" (alto = worse).
 */
export const VIABILITY: Record<string, Viability> = {
  tecnologia: { production: 'medio', faceless: 'alto', expertise: 'medio', copyright: 'medio', monetizationRisk: 'bajo', automation: 'medio', note: 'Reseñas exigen producto; tutoriales de pantalla se hacen sin cara.' },
  ia: { production: 'bajo', faceless: 'alto', expertise: 'medio', copyright: 'bajo', monetizationRisk: 'bajo', automation: 'alto', note: 'Tutoriales de pantalla y explicadores; el tema cambia rápido y envejece pronto.' },
  finanzas: { production: 'medio', faceless: 'alto', expertise: 'alto', copyright: 'bajo', monetizationRisk: 'medio', automation: 'medio', note: 'Exige rigor; el consejo financiero tiene riesgo legal y YouTube restringe afirmaciones engañosas.' },
  negocios: { production: 'medio', faceless: 'alto', expertise: 'medio', copyright: 'bajo', monetizationRisk: 'medio', automation: 'medio', note: 'Mucho contenido de baja calidad; promesas de ingresos pueden limitar la monetización.' },
  educacion: { production: 'medio', faceless: 'alto', expertise: 'alto', copyright: 'bajo', monetizationRisk: 'bajo', automation: 'medio', note: 'Animaciones y voz en off; la exactitud científica es imprescindible.' },
  historia: { production: 'medio', faceless: 'alto', expertise: 'medio', copyright: 'medio', monetizationRisk: 'bajo', automation: 'medio', note: 'Imágenes de archivo: comprobar licencias; temas bélicos pueden tener restricciones de anunciantes.' },
  salud: { production: 'medio', faceless: 'medio', expertise: 'alto', copyright: 'bajo', monetizationRisk: 'alto', automation: 'bajo', note: 'Contenido médico: YouTube exige fuentes fiables y limita afirmaciones de salud.' },
  fitness: { production: 'alto', faceless: 'bajo', expertise: 'alto', copyright: 'medio', monetizationRisk: 'bajo', automation: 'bajo', note: 'Necesita demostrar ejercicios; música con derechos es un riesgo habitual.' },
  cocina: { production: 'alto', faceless: 'medio', expertise: 'medio', copyright: 'medio', monetizationRisk: 'bajo', automation: 'bajo', note: 'Producción de vídeo real; se puede hacer solo con manos y sin cara.' },
  viajes: { production: 'alto', faceless: 'medio', expertise: 'bajo', copyright: 'medio', monetizationRisk: 'bajo', automation: 'bajo', note: 'Requiere viajar o material propio; con imágenes de stock pierde diferenciación.' },
  gaming: { production: 'medio', faceless: 'alto', expertise: 'medio', copyright: 'alto', monetizationRisk: 'medio', automation: 'bajo', note: 'Música y material de editores: revisar sus normas de uso.' },
  entretenimiento: { production: 'alto', faceless: 'bajo', expertise: 'medio', copyright: 'alto', monetizationRisk: 'medio', automation: 'bajo', note: 'Resúmenes y reacciones con material ajeno tienen riesgo alto de reclamaciones.' },
  musica: { production: 'bajo', faceless: 'alto', expertise: 'bajo', copyright: 'alto', monetizationRisk: 'alto', automation: 'alto', note: 'Música generada o con licencia clara; el contenido repetitivo o reutilizado puede perder monetización.' },
  noticias: { production: 'medio', faceless: 'alto', expertise: 'medio', copyright: 'alto', monetizationRisk: 'alto', automation: 'medio', note: 'Imágenes de agencias con derechos; temas sensibles limitan anunciantes.' },
  hogar: { production: 'alto', faceless: 'medio', expertise: 'medio', copyright: 'bajo', monetizationRisk: 'bajo', automation: 'bajo', note: 'Requiere hacer los proyectos; sin cara es viable con manos y plano cenital.' },
  motor: { production: 'alto', faceless: 'medio', expertise: 'alto', copyright: 'medio', monetizationRisk: 'bajo', automation: 'bajo', note: 'Necesita vehículos o acceso a ellos; la fiabilidad técnica importa.' },
  animales: { production: 'medio', faceless: 'alto', expertise: 'medio', copyright: 'medio', monetizationRisk: 'bajo', automation: 'medio', note: 'Recopilaciones de vídeos ajenos tienen riesgo de copyright; adiestramiento exige experiencia.' },
  belleza: { production: 'alto', faceless: 'bajo', expertise: 'medio', copyright: 'medio', monetizationRisk: 'bajo', automation: 'bajo', note: 'Visual y personal; mercado muy competido por marcas.' },
  misterio: { production: 'medio', faceless: 'alto', expertise: 'bajo', copyright: 'medio', monetizationRisk: 'alto', automation: 'medio', note: 'Casos reales pueden tener restricciones por violencia; guion e investigación son el coste principal.' },
  desarrollo: { production: 'bajo', faceless: 'alto', expertise: 'bajo', copyright: 'bajo', monetizationRisk: 'bajo', automation: 'alto', note: 'Mucha competencia genérica; la diferenciación viene del enfoque, no de la producción.' },
  idiomas: { production: 'medio', faceless: 'alto', expertise: 'alto', copyright: 'bajo', monetizationRisk: 'bajo', automation: 'medio', note: 'Requiere dominar el idioma; el público es global y el RPM depende del país de los espectadores.' },
}

// ---------- Report ----------
export type ReportRow = {
  a: TopicAnalysis; market: string; nicheMain: string | null; format: 'short' | 'long' | null; formatReason: string; languageRecommended: string | null
  rpm: RpmReading; rpmNiche: string | null; scenario100k: { low: number; mid: number; high: number } | null; scenario1m: { low: number; mid: number; high: number } | null
  country: { low: number; high: number } | null; viability: Viability | null
}

const KIND_LABEL = { oportunidad: 'Nicho desatendido con demanda', saturado: 'Popular y saturado', sin_demanda: 'Poca oferta pero poca demanda (no es oportunidad)', mixto: 'Señales mixtas' } as const

export function reportRow(a: TopicAnalysis): ReportRow {
  const niche = a.niches.find(n => nicheRpm(n).status === 'estimado') ?? a.niches[0] ?? null
  const fo = formatOpportunity(a)
  const format = fo.recommended ?? (a.byFormat.long.count + a.byFormat.long.recentCount >= a.byFormat.short.count + a.byFormat.short.recentCount ? 'long' : 'short')
  const rpm = niche ? formatAdjusted(nicheRpm(niche), format) : ({ status: 'desconocido', reason: 'No se pudo inferir el nicho del tema.' } as RpmReading)
  const sc = (n: number) => (rpm.status === 'estimado' ? revenueScenarios(rpm, [n])[0] : null)
  const c = a.region ? COUNTRY_RPM.find(x => x.code === a.region) : null
  return {
    a, market: marketLabel(a.region, a.language), nicheMain: niche, format, formatReason: fo.recommended ? fo.reason : 'Sin hueco claro: se indica el formato con más presencia en la muestra.', languageRecommended: a.language,
    rpm, rpmNiche: niche, scenario100k: sc(SCENARIO_VIEWS[0]), scenario1m: sc(SCENARIO_VIEWS[2]), country: c ? { low: c.low, high: c.high } : null, viability: niche ? VIABILITY[niche] ?? null : null,
  }
}

export const verdictLabel = (v: TopicAnalysis['verdict']) => KIND_LABEL[v]

/** One row per analysis with every field the report promises; unknowns are written as "desconocido". */
export function reportCsv(list: TopicAnalysis[]) {
  const U = 'desconocido'
  return toCsv([
    ['país_mercado', 'idioma_consulta', 'nicho_principal_inferido', 'subnicho_consultado', 'clasificación', 'oportunidad_0_100', 'demanda', 'oferta', 'competencia', 'crecimiento', 'crecimiento_pct', 'confianza', 'muestra_top', 'muestra_recientes', 'resultados_examinados', 'resultados_útiles', 'descartados_tema_nicho', 'descartados_idioma', 'idioma_sin_verificar', 'posibles_anuncios', 'virales_atípicos', 'ventana_recientes_días', 'formato_recomendado', 'rpm_estado', 'rpm_bajo_usd', 'rpm_medio_usd', 'rpm_alto_usd', 'rpm_confianza', 'ingreso_100k_bajo', 'ingreso_100k_alto', 'ingreso_1M_bajo', 'ingreso_1M_alto', 'rpm_pais_ref_bajo', 'rpm_pais_ref_alto', 'dificultad_producción(editorial)', 'sin_cara(editorial)', 'riesgo_copyright(editorial)', 'riesgo_monetización(editorial)', 'automatización(editorial)', 'frases_relacionadas', 'fuente', 'fecha_consulta'],
    ...list.map(reportRow).map(r => [
      r.market, r.a.language ?? U, r.nicheMain ? nicheLabel(r.nicheMain) : U, r.a.topic, verdictLabel(r.a.verdict), r.a.indices.opportunity, r.a.indices.demand, r.a.indices.supply, r.a.indices.competition, r.a.indices.growth ?? 'No calculable', r.a.growthPct ?? U, r.a.confidence, r.a.sampleSizes.top, r.a.sampleSizes.recent, r.a.quality?.examined ?? U, r.a.quality?.kept ?? U, r.a.quality ? r.a.quality.excluded.tema + r.a.quality.excluded.nicho : U, r.a.quality?.excluded.idioma ?? U, r.a.quality?.languageUnverified ?? U, r.a.quality?.promo ?? U, r.a.quality?.outliers ?? U, r.a.recentDays ?? 30, r.format === 'short' ? 'Shorts' : 'vídeo largo',
      r.rpm.status === 'estimado' ? 'ESTIMADO' : 'DESCONOCIDO', r.rpm.status === 'estimado' ? r.rpm.low : U, r.rpm.status === 'estimado' ? r.rpm.mid : U, r.rpm.status === 'estimado' ? r.rpm.high : U, r.rpm.status === 'estimado' ? r.rpm.confidence : U,
      r.scenario100k?.low ?? U, r.scenario100k?.high ?? U, r.scenario1m?.low ?? U, r.scenario1m?.high ?? U, r.country?.low ?? U, r.country?.high ?? U,
      r.viability?.production ?? U, r.viability?.faceless ?? U, r.viability?.copyright ?? U, r.viability?.monetizationRisk ?? U, r.viability?.automation ?? U,
      r.a.terms.slice(0, 5).map(t => t.term).join(' | ') || U, 'YouTube Data API v3 (search.list + videos.list + channels.list), muestra', r.a.fetchedAt,
    ]),
  ])
}

const usd = (n: number) => `$${n.toLocaleString('es-ES', { useGrouping: true, maximumFractionDigits: 2 })}`

/** Readable report: method, limits, then every analysis with its evidence. Generated from what Cerebro Studio fetched; nothing is added. */
export function reportMarkdown(list: TopicAnalysis[], meta: { generatedAt: string; unitsSpent?: number }) {
  // Analyses with enough relevant evidence rank first; a low-confidence one never outranks a reliable one, whatever its score.
  const rows = list.map(reportRow).sort((x, y) => Number(y.a.confidence !== 'baja') - Number(x.a.confidence !== 'baja') || y.a.indices.opportunity - x.a.indices.opportunity)
  const byMarket = new Map<string, ReportRow[]>(); for (const r of rows) byMarket.set(r.market, [...(byMarket.get(r.market) ?? []), r])
  const L: string[] = []
  L.push('# Informe de investigación de nichos — Cerebro Studio', '', `Generado: ${meta.generatedAt} · ${rows.length} análisis · ${byMarket.size} mercado(s)${meta.unitsSpent ? ` · ${meta.unitsSpent.toLocaleString('es-ES')} unidades de cuota` : ''}`, '')
  L.push('## Método y límites', '',
    '- **Fuente:** YouTube Data API v3 (solo lectura). Cada análisis combina dos muestras de 25 vídeos por tema y mercado: los más vistos del último año y los más recientes (ventana indicada). Es una **muestra**, no un censo de vídeos ni de creadores.',
    '- **Observado:** vistas, suscriptores y fechas tal como los da la API. **Calculado:** índices 0–100 de demanda, oferta, competencia, crecimiento y oportunidad. **Inferido:** nicho, formato (los Shorts se deducen por duración y #shorts) y tipo de contenido. **Editorial:** viabilidad (producción, sin cara, copyright…), criterio de Cerebro Studio, no medido.',
    '- **Relevancia y calidad de los datos:** cada resultado de YouTube se juzga antes de contar: tema (términos de la consulta), nicho, idioma del mercado y directos en emisión. Los anuncios y los vídeos virales atípicos se muestran pero no fijan la demanda. En cada análisis se indica cuántos resultados sirvieron y por qué se descartó el resto. El país de búsqueda no garantiza que el vídeo sea de ese país.',
    '- **Crecimiento:** solo se calcula comparando dos ventanas seguidas de la misma duración con al menos 8 vídeos relevantes cada una; si no, aparece «No calculable». Con confianza baja (muestra relevante insuficiente) un análisis no se clasifica como oportunidad.',
    '- **RPM:** YouTube no publica el RPM de canales ajenos. Los rangos son ESTIMACIONES de estudios de terceros (ver fuentes en la app); nada de lo de aquí es RPM verificado ni ingreso real de un canal. Un nicho sin referencia es DESCONOCIDO.',
    '- **País:** dónde YouTube ordena y muestra los resultados; no es dónde viven los espectadores. **Idioma:** el de la consulta.',
    '- **Un nicho con poca oferta y poca demanda no es una oportunidad.** Suiza y otros países sin tabla de RPM por país aparecen como desconocidos en esa columna.', '')
  for (const [market, rs] of byMarket) {
    L.push(`## ${market} — ${rs.length} análisis`, '', '| # | Subnicho | Nicho (inferido) | Clasificación | Opp. | Dem. | Of. | Comp. | Crec. | Formato | RPM estimado (USD/1000) | 100k / 1M visitas | Conf. |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    rs.forEach((r, i) => L.push(`| ${i + 1} | ${r.a.topic} | ${r.nicheMain ? nicheLabel(r.nicheMain) : 'desconocido'} | ${verdictLabel(r.a.verdict)} | ${r.a.indices.opportunity} | ${r.a.indices.demand} | ${r.a.indices.supply} | ${r.a.indices.competition} | ${r.a.indices.growth ?? 'No calculable'} | ${r.format === 'short' ? 'Shorts' : 'Largo'} | ${r.rpm.status === 'estimado' ? `${usd(r.rpm.low)}–${usd(r.rpm.high)} (${r.rpm.confidence})` : 'DESCONOCIDO'} | ${r.scenario100k && r.scenario1m ? `${usd(r.scenario100k.low)}–${usd(r.scenario100k.high)} / ${usd(r.scenario1m.low)}–${usd(r.scenario1m.high)}` : 'desconocido'} | ${r.a.confidence} |`))
    L.push('')
  }
  L.push('## Detalle por análisis', '')
  for (const r of rows) {
    const a = r.a
    L.push(`### ${a.topic} — ${r.market}`, '', `- **Clasificación:** ${verdictLabel(a.verdict)} · ${a.headline}.`, `- **Calidad de la muestra:** ${a.quality ? `${a.quality.kept} de ${a.quality.examined} resultados de YouTube sirven (descartados: ${a.quality.excluded.tema + a.quality.excluded.nicho} por tema o nicho, ${a.quality.excluded.idioma} por idioma, ${a.quality.excluded.directo} directos; ${a.quality.promo} posibles anuncios y ${a.quality.outliers} virales atípicos fuera de la demanda; idioma sin verificar: ${a.quality.languageUnverified})` : 'sin datos de calidad (análisis anterior a las reglas de relevancia)'}. **Crecimiento:** ${a.growth?.state === 'calculable' ? `${a.growth.label} (×${a.growth.ratio?.toFixed(2)})` : 'No calculable'}.`, `- **Parámetros:** mercado ${r.market}, idioma ${a.language ?? 'cualquiera'}, ventana de recientes ${a.recentDays ?? 30} días, muestra ${a.sampleSizes.top}+${a.sampleSizes.recent} vídeos. **Fecha de consulta:** ${a.fetchedAt}.`, `- **Por qué:** ${a.reasons.join(' ')}`,
      `- **Evidencia:** ${a.evidence.map(e => `${e.label}: ${e.value} (${e.kind})`).join('; ')}.`, `- **Confianza:** ${a.confidence}. ${a.confidenceNote}`, `- **Formato recomendado:** ${r.format === 'short' ? 'Shorts' : 'vídeo largo'} — ${r.formatReason}`,
      `- **Palabras clave (de títulos y etiquetas, sin volúmenes de búsqueda):** ${a.terms.slice(0, 6).map(t => t.term).join(', ') || 'desconocido'}.${a.emerging.length ? ` Al alza: ${a.emerging.slice(0, 3).map(t => t.term).join(', ')}.` : ''}`,
      r.rpm.status === 'estimado' ? `- **RPM ESTIMADO (${nicheLabel(r.rpmNiche!)}):** ${usd(r.rpm.low)}–${usd(r.rpm.high)} por 1000 visitas, confianza ${r.rpm.confidence}. ${r.rpm.note}` : `- **RPM:** DESCONOCIDO. ${r.rpm.reason}`,
      r.scenario100k && r.scenario1m ? `- **Escenarios (RPM estimado × visitas):** 100.000 visitas ${usd(r.scenario100k.low)}–${usd(r.scenario100k.high)}; 1.000.000 visitas ${usd(r.scenario1m.low)}–${usd(r.scenario1m.high)}. No predice cuántas visitas tendrás.` : '- **Escenarios:** no calculables sin RPM de referencia.',
      r.country ? `- **Referencia de RPM del país (contenido general, terceros):** ${usd(r.country.low)}–${usd(r.country.high)}; no se combina con el del nicho.` : `- **Referencia de RPM del país:** desconocida.`,
      r.viability ? `- **Viabilidad (criterio editorial, no medido):** producción ${r.viability.production}; sin mostrar la cara ${r.viability.faceless}; experiencia necesaria ${r.viability.expertise}; riesgo de copyright ${r.viability.copyright}; riesgo de monetización ${r.viability.monetizationRisk}; automatización ${r.viability.automation}. ${r.viability.note}` : '- **Viabilidad:** desconocida (nicho no inferido).',
      '- **No disponible con esta fuente:** interés de búsqueda y estacionalidad (Google Trends no está conectado), coste exacto de creación.', '')
  }
  L.push('## Nichos de la lista (referencia)', '', NICHES.map(n => n.label).join(', '), '')
  return L.join('\n')
}
