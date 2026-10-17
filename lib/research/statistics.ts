/**
 * Statistical layer of the Investigación engine: the weights and thresholds that turn observations into scores, plus the measures that say
 * how far a score can be trusted (concentration, sustained vs one-off demand, entry difficulty, sensitivity to the weights).
 * Pure functions over plain numbers: nothing here calls YouTube and nothing is invented — a measure that cannot be computed says so.
 */
import type { Confidence } from './taxonomy'

export type Verdict = 'oportunidad' | 'saturado' | 'sin_demanda' | 'mixto'

/** Every weight and threshold the verdict uses, in one place; the screen prints them from here so the explanation can never drift from the code. */
export const METHOD = {
  opportunityWeights: { demand: 0.45, openCompetition: 0.25, openSupply: 0.2, growth: 0.1 },
  /** When growth is not calculable its 10 % is not replaced by a neutral guess: the other three weights are rescaled to 100 %. */
  growthRenormalised: true,
  demand: { noDemandBelow: 25, opportunityFrom: 50, topSampleWeight: 0.6, recentSampleWeight: 0.4, viewsPerDayForFullScore: 20_000 },
  competition: { weights: { authority: 0.4, dominance: 0.35, topChannelShare: 0.25 }, opportunityMax: 55, saturatedAbove: 70, bigChannelSubscribers: 100_000, authorityFullScoreSubscribers: 5_000_000 },
  supply: { weights: { uploadsPerWeek: 0.6, distinctChannels: 0.4 }, opportunityMax: 60, saturatedAbove: 75, uploadsPerWeekForFullScore: 100, channelsForFullScore: 25 },
  /**
   * Supply counts only COMPETITIVE videos: those with traction. Below `tractionViews` total views a video says almost nothing about audience pull (it is
   * mostly its own channel's reach), so it is reported as published volume but does not weigh in the supply score. A video younger than
   * `tractionGraceDays` that has not reached the threshold is «too new to judge», not «without traction».
   */
  traction: { tractionViews: 100, tractionGraceDays: 3 },
  /** How much a demand figure is trusted. The factor shrinks the demand score when the sample cannot represent the topic; the reasons are always printed. */
  demandReliability: { minRelevantTop: 20, lowBelowChannels: 6, topVideoShareMax: 0.4, top3VideoShareMax: 0.7, shortsViewShareMax: 0.5, factor: { media: 1, baja: 0.75, insuficiente: 0.5 } },
  /** A score whose confidence is «baja» never reaches the band of an opportunity: it is capped just under `demand.opportunityFrom`. */
  lowConfidenceOpportunityCap: 49,
} as const

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

export function opportunityOf(demand: number, competition: number, supply: number, growth: number | null, w: { demand: number; openCompetition: number; openSupply: number; growth: number } = METHOD.opportunityWeights) {
  const open = w.demand * demand + w.openCompetition * (100 - competition) + w.openSupply * (100 - supply)
  const raw = growth === null ? open / (w.demand + w.openCompetition + w.openSupply) : open + w.growth * growth
  return Math.round(demand < METHOD.demand.noDemandBelow ? Math.min(raw, 20) : raw)
}

/** The opportunity index as it may be SHOWN: a low-confidence analysis cannot display a score in the opportunity band. */
export const shownOpportunity = (raw: number, confidence: Confidence) => (confidence === 'baja' ? Math.min(raw, METHOD.lowConfidenceOpportunityCap) : raw)

export function verdictOf(demand: number, competition: number, supply: number): Verdict {
  const { demand: d, competition: c, supply: s } = METHOD
  if (demand < d.noDemandBelow) return 'sin_demanda'
  if (demand >= d.opportunityFrom && competition <= c.opportunityMax && supply <= s.opportunityMax) return 'oportunidad'
  if (demand >= d.opportunityFrom && (competition > c.saturatedAbove || supply > s.saturatedAbove)) return 'saturado'
  return 'mixto'
}

// ---------- Concentration: who owns the views ----------
export type Concentration = { channels: number; /** Herfindahl–Hirschman index of the view shares, 0–10 000. */ hhi: number | null; top1: number; top3: number; level: 'baja' | 'media' | 'alta' | 'sin datos' }

export function concentration(videos: Array<{ channelId: string; views: number | null }>): Concentration {
  const by = new Map<string, number>()
  for (const v of videos) if (v.channelId && typeof v.views === 'number' && v.views > 0) by.set(v.channelId, (by.get(v.channelId) ?? 0) + v.views)
  const total = [...by.values()].reduce((t, x) => t + x, 0)
  if (by.size < 3 || !total) return { channels: by.size, hhi: null, top1: 0, top3: 0, level: 'sin datos' }
  const shares = [...by.values()].map(x => x / total).sort((a, b) => b - a)
  const hhi = Math.round(shares.reduce((t, s) => t + s * s, 0) * 10_000)
  const top3 = shares.slice(0, 3).reduce((t, s) => t + s, 0)
  // 1 500 / 2 500 are the usual HHI bands; the top-3 share guards against many tiny channels hiding three giants.
  const level = hhi >= 2500 || top3 >= 0.75 ? 'alta' : hhi >= 1500 || top3 >= 0.55 ? 'media' : 'baja'
  return { channels: by.size, hhi, top1: Math.round(shares[0] * 100) / 100, top3: Math.round(top3 * 100) / 100, level }
}

// ---------- Small channels that do well: the strongest evidence that a newcomer can get views ----------
export type SmallWins = { known: number; small: number; wins: number; /** Share of the small channels' videos that out-viewed the channel's own subscribers. */ share: number | null }

const MAX_PLAUSIBLE_RATIO = 500

export function smallChannelWins(videos: Array<{ subs: number | null; views: number | null }>, smallBelow = 20_000): SmallWins {
  // A ratio above 500 views per subscriber is almost always misleading channel data (hidden or stale subscriber count, reposted viral clip),
  // so such rows are left out instead of being celebrated as a small channel that «wins».
  const known = videos.filter(v => typeof v.subs === 'number' && v.subs > 0 && typeof v.views === 'number' && v.views / v.subs <= MAX_PLAUSIBLE_RATIO)
  const small = known.filter(v => (v.subs as number) < smallBelow)
  const wins = small.filter(v => (v.views as number) >= (v.subs as number)).length
  return { known: known.length, small: small.length, wins, share: small.length >= 3 ? wins / small.length : null }
}

// ---------- Demand: how representative the sample is ----------
export type DemandReliability = {
  level: 'media' | 'baja' | 'insuficiente'
  /** Why it is not «media» (empty when it is). */
  reasons: string[]
  /** What multiplies the raw demand score (1 when the sample is representative). */
  factor: number
  /** The demand score before the factor. */
  raw: number
  figures: { relevantTop: number; channels: number; top1VideoShare: number; top3VideoShare: number; shortsViewShare: number; outliers: number }
}

/**
 * Isolated hits (a viral Short, one channel's smash) can make a topic look in demand. This never says «alta»: a single search is one source and a
 * sample, so the best a demand figure can be is «media». It is lowered by a small sample, few channels, views concentrated in one or three videos,
 * or a demand carried by Shorts, whose views are not long-form demand.
 */
export function demandReliability(i: { raw: number; views: number[]; channelIds: string[]; shortViews: number; outliers: number }): DemandReliability {
  const R = METHOD.demandReliability, n = i.views.length, total = i.views.reduce((t, x) => t + x, 0)
  const sorted = [...i.views].sort((a, b) => b - a)
  const top1 = total ? (sorted[0] ?? 0) / total : 0, top3 = total ? sorted.slice(0, 3).reduce((t, x) => t + x, 0) / total : 0
  const shortsShare = total ? i.shortViews / total : 0
  const channels = new Set(i.channelIds.filter(Boolean)).size
  const pct = (x: number) => `${Math.round(x * 100)} %`
  const reasons: string[] = []
  let insufficient = false
  if (n < 8) { insufficient = true; reasons.push(`solo ${n} vídeos relevantes entre los más vistos (se piden al menos ${R.minRelevantTop} para que la mediana represente al tema)`) }
  else if (n < R.minRelevantTop) reasons.push(`muestra pequeña: ${n} vídeos relevantes entre los más vistos (se piden al menos ${R.minRelevantTop})`)
  if (n >= 5 && channels < R.lowBelowChannels) reasons.push(`solo ${channels} canales distintos detrás de esos vídeos (se piden al menos ${R.lowBelowChannels})`)
  if (n >= 5 && top1 > R.topVideoShareMax) reasons.push(`un solo vídeo reúne el ${pct(top1)} de las vistas`)
  else if (n >= 5 && top3 > R.top3VideoShareMax) reasons.push(`tres vídeos reúnen el ${pct(top3)} de las vistas`)
  if (n >= 5 && shortsShare > R.shortsViewShareMax) reasons.push(`el ${pct(shortsShare)} de las vistas son de Shorts: su alcance no equivale a demanda de vídeo largo`)
  if (i.outliers >= Math.max(2, n * 0.25)) reasons.push(`${i.outliers} vídeos virales atípicos en una muestra de ${n}`)
  const level: DemandReliability['level'] = insufficient ? 'insuficiente' : reasons.length ? 'baja' : 'media'
  return { level, reasons, factor: R.factor[level], raw: i.raw, figures: { relevantTop: n, channels, top1VideoShare: Math.round(top1 * 100) / 100, top3VideoShare: Math.round(top3 * 100) / 100, shortsViewShare: Math.round(shortsShare * 100) / 100, outliers: i.outliers } }
}

// ---------- Demand: one hit vs sustained interest ----------
export type DemandProfile = { kind: 'sostenida' | 'puntual' | 'insuficiente'; note: string }

export function demandProfile(i: { topVpd: number | null; recentVpd: number | null; oneVideoShare: number; outliers: number; relevantTop: number; relevantRecent: number }): DemandProfile {
  if (i.relevantTop < 8 || i.relevantRecent < 5 || i.topVpd === null) return { kind: 'insuficiente', note: 'Hay pocos vídeos relevantes para distinguir un interés sostenido de un éxito aislado.' }
  const keeps = i.recentVpd !== null && i.recentVpd >= 0.3 * i.topVpd
  const oneHit = i.oneVideoShare > 0.5 || i.outliers >= Math.max(2, i.relevantTop * 0.25)
  if (oneHit) return { kind: 'puntual', note: `Las vistas dependen de pocos vídeos (${i.oneVideoShare > 0.5 ? `uno reúne el ${Math.round(i.oneVideoShare * 100)} %` : `${i.outliers} virales atípicos`}): puede ser un éxito aislado, no demanda del tema.` }
  if (!keeps) return { kind: 'puntual', note: 'Lo más visto del año gana mucho más que lo publicado hace poco: el interés pudo concentrarse en un momento pasado.' }
  return { kind: 'sostenida', note: 'Tanto lo más visto del año como lo reciente reúnen vistas diarias comparables, repartidas entre varios vídeos.' }
}

// ---------- Entry difficulty ----------
export type Entry = { level: 'baja' | 'media' | 'alta' | 'sin datos'; saturated: boolean; note: string }

export function entryDifficulty(i: { competition: number; supply: number; concentration: Concentration; smallWins: SmallWins }): Entry {
  const { competition, supply, concentration: c, smallWins: s } = i
  const saturated = supply > METHOD.supply.saturatedAbove && competition > METHOD.competition.opportunityMax
  if (c.level === 'sin datos' && s.share === null) return { level: 'sin datos', saturated, note: 'No hay suficientes canales con suscriptores conocidos para valorar la dificultad de entrada.' }
  let points = 0
  if (competition > METHOD.competition.saturatedAbove) points += 2; else if (competition > METHOD.competition.opportunityMax) points += 1
  if (c.level === 'alta') points += 2; else if (c.level === 'media') points += 1
  if (supply > METHOD.supply.saturatedAbove) points += 1
  if (s.share !== null && s.share >= 0.4) points -= 2; else if (s.share !== null && s.share >= 0.2) points -= 1
  const level = points >= 4 ? 'alta' : points >= 2 ? 'media' : 'baja'
  const parts = [`competencia ${competition}/100`, `reparto de vistas ${c.level}`, ...(s.share !== null ? [`${s.wins} de ${s.small} vídeos de canales pequeños superan sus suscriptores`] : ['sin datos suficientes de canales pequeños'])]
  return { level, saturated, note: `${parts.join('; ')}.` }
}

// ---------- Confidence interval of a median (order statistics, no distribution assumed) ----------
export function medianInterval(xs: number[]): { lo: number; hi: number } | null {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b), n = s.length
  if (n < 8) return null
  // ~95 % interval for the median: ranks n/2 ± 0.98·√n (normal approximation of the binomial).
  const d = Math.round(0.98 * Math.sqrt(n)), lo = clamp(Math.floor(n / 2) - d, 0, n - 1), hi = clamp(Math.ceil(n / 2) + d - 1, 0, n - 1)
  return { lo: s[lo], hi: s[hi] }
}

// ---------- Sensitivity: does the conclusion survive reasonable changes? ----------
export type Sensitivity = { baseline: { opportunity: number; verdict: Verdict }; min: number; max: number; stable: boolean; cases: Array<{ label: string; opportunity: number; verdict: Verdict }>; note: string }

export function sensitivity(i: { demand: number; competition: number; supply: number; growth: number | null }): Sensitivity {
  const base = { opportunity: opportunityOf(i.demand, i.competition, i.supply, i.growth), verdict: verdictOf(i.demand, i.competition, i.supply) }
  const eq = { demand: 0.34, openCompetition: 0.33, openSupply: 0.33, growth: 0 }
  const shift = (label: string, d: number, c: number, s: number) => {
    const demand = clamp(i.demand + d), competition = clamp(i.competition + c), supply = clamp(i.supply + s)
    return { label, opportunity: opportunityOf(demand, competition, supply, i.growth), verdict: verdictOf(demand, competition, supply) }
  }
  const cases = [
    shift('Demanda 15 puntos más baja', -15, 0, 0), shift('Demanda 15 puntos más alta', 15, 0, 0),
    shift('Competencia 15 puntos más alta', 0, 15, 0), shift('Competencia 15 puntos más baja', 0, -15, 0),
    shift('Oferta 15 puntos más alta', 0, 0, 15),
    { label: 'Pesos iguales para demanda, competencia y oferta', opportunity: opportunityOf(i.demand, i.competition, i.supply, null, eq), verdict: base.verdict },
  ]
  const values = [base.opportunity, ...cases.map(c => c.opportunity)]
  const min = Math.min(...values), max = Math.max(...values)
  const changed = cases.filter(c => c.verdict !== base.verdict)
  const stable = changed.length === 0 && max - min <= 20
  return { baseline: base, min, max, stable, cases, note: stable ? `La conclusión aguanta cambios razonables: la puntuación se mueve entre ${min} y ${max} y el veredicto no cambia.` : `La conclusión es sensible: la puntuación oscila entre ${min} y ${max}${changed.length ? ` y el veredicto cambia con «${changed[0].label.toLowerCase()}»` : ''}. Trátala como orientativa.` }
}

/** Plain-language lines describing how each score is built, generated from METHOD so screen and code stay in sync. */
export function methodLines(): string[] {
  const m = METHOD, w = m.opportunityWeights, pct = (x: number) => `${Math.round(x * 100)} %`
  return [
    `Demanda (0–100): vistas por día de los vídeos relevantes (mediana, sin anuncios ni virales atípicos), ${pct(m.demand.topSampleWeight)} lo más visto del último año y ${pct(m.demand.recentSampleWeight)} lo reciente; escala logarítmica, 100 = ${m.demand.viewsPerDayForFullScore.toLocaleString('es-ES')} vistas/día. Por debajo de ${m.demand.noDemandBelow} se considera sin demanda.`,
    `Competencia (0–100): ${pct(m.competition.weights.authority)} tamaño del canal mediano, ${pct(m.competition.weights.dominance)} canales de ≥ ${m.competition.bigChannelSubscribers.toLocaleString('es-ES')} suscriptores en el top 10, ${pct(m.competition.weights.topChannelShare)} cuota de vistas del canal dominante.`,
    `Oferta (0–100): ${pct(m.supply.weights.uploadsPerWeek)} vídeos nuevos por semana y ${pct(m.supply.weights.distinctChannels)} número de canales distintos.`,
    `Oportunidad (0–100): ${pct(w.demand)} demanda + ${pct(w.openCompetition)} competencia abierta + ${pct(w.openSupply)} oferta abierta + ${pct(w.growth)} crecimiento. Si el crecimiento no es calculable, los otros pesos se reescalan al 100 %: no se inventa un valor neutro.`,
    `«Oportunidad»: demanda ≥ ${m.demand.opportunityFrom}, competencia ≤ ${m.competition.opportunityMax} y oferta ≤ ${m.supply.opportunityMax}, con confianza suficiente. «Saturado»: demanda ≥ ${m.demand.opportunityFrom} y competencia > ${m.competition.saturatedAbove} u oferta > ${m.supply.saturatedAbove}.`,
    'Límites: son muestras de 25 vídeos por consulta, no un censo; las puntuaciones comparan temas entre sí, no predicen vistas ni ingresos.',
  ]
}

export type StatConfidence = { level: Confidence; reasons: string[] }
