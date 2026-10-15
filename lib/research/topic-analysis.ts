import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { stopwords } from '@/lib/radar'
import { inferFormat, nichesOf, type Confidence } from './taxonomy'
import { assessVideo, expectedLanguages, queryProfile, viralOutliers, type ExclusionReason, type SampleQuality } from './relevance'
export type { SampleQuality } from './relevance'

/**
 * Demand / supply / competition model for ONE topic in ONE market, built from two small samples of the official search:
 *   top    = the most-viewed videos about the topic published in the last 365 days (what people watched)
 *   recent = the newest videos about the topic (what creators are publishing now)
 * It is a SAMPLE (25 videos each), not a census: search.list cannot count videos or creators. Every index is CALCULATED from observed
 * values and the screen says so, with the evidence next to each number. Nothing here predicts virality or income.
 */

export type Sample = { videos: YouTubeVideoResult[]; approxTotal: number | null }
export type TopicSamples = { topic: string; region: string | null; language: string | null; top: Sample; recent: Sample; /** Window of the "recent" sample, in days. */ recentDays?: number; fetchedAt: string; units: number }

export type Verdict = 'oportunidad' | 'saturado' | 'sin_demanda' | 'mixto'
export type Evidence = { label: string; value: string; kind: 'observado' | 'calculado' | 'inferido' }

export type FormatStats = { count: number; recentCount: number; medianViewsPerDay: number | null }

/**
 * Growth is only calculable from two ADJACENT windows of the same length, sampled the same way and judged by the same relevance rules.
 * The default analysis has one window (the recent one), so it says «No calculable»; «Medir crecimiento» adds the previous window (~102 units).
 */
export type GrowthResult = {
  state: 'calculable' | 'no_calculable'
  reason: string
  windowDays: number
  /** The recent window: relevant, non-promotional, non-outlier videos aged ≥ 3 days. */
  recent: { n: number; medianVpd: number | null }
  previous?: { n: number; medianVpd: number | null }
  ratio?: number | null
  label?: 'al alza (posible)' | 'estable o no concluyente' | 'a la baja'
}

export type TopicAnalysis = {
  topic: string; region: string | null; language: string | null; fetchedAt: string; units: number; recentDays: number
  /** growth is null when it cannot be calculated: it never defaults to a neutral number. */
  indices: { demand: number; supply: number; competition: number; growth: number | null; opportunity: number }
  growth: GrowthResult
  /** Percentage change between two adjacent windows; null unless growth is calculable. */
  growthPct: number | null
  verdict: Verdict; headline: string; reasons: string[]
  confidence: Confidence; confidenceNote: string
  evidence: Evidence[]
  /** What the relevance, language and outlier rules did to the raw search results. */
  quality: SampleQuality
  byFormat: { short: FormatStats; long: FormatStats }
  /** How sure the Shorts count is: confirmed by #shorts vs only ≤ 60 s, and short clips that are not Shorts. */
  formatQuality: { shortConfirmed: number; shortProbable: number; clipsNotShort: number }
  niches: string[]
  terms: Term[]; emerging: Term[]; questions: Array<{ text: string; videoId: string; views: number | null }>
  sampleSizes: { top: number; recent: number }
  approxTotals: { top: number | null; recent: number | null }
  topVideos: YouTubeVideoResult[]
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
/** 0–100 on a log scale, so 10 → 100 views/day matters as much as 1,000 → 10,000. */
export const logScore = (value: number | null, max: number) => value === null || value <= 0 ? 0 : clamp((100 * Math.log10(1 + value)) / Math.log10(1 + max))
const ageDays = (v: YouTubeVideoResult, now: number) => { const t = Date.parse(v.publishedAt); return Number.isFinite(t) ? Math.max((now - t) / 86400000, 0) : null }
const num = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

// ---------- Terms and questions ----------
export type Term = { term: string; videos: number; views: number; share: number }

const tokens = (text: string) => text.toLowerCase().normalize('NFKC').replace(/https?:\/\/\S+/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** 1–3-word phrases found in titles and tags, counted once per video. A calculated signal of what the topic is about, not a search volume. */
export function extractTerms(videos: YouTubeVideoResult[], minVideos = 2, limit = 25): Term[] {
  const count = new Map<string, { videos: number; views: number }>()
  for (const v of videos) {
    const seen = new Set<string>()
    for (const source of [v.title, v.tags?.join(' ') ?? '']) {
      const t = tokens(source)
      for (let i = 0; i < t.length; i++) {
        for (let n = 1; n <= 3 && i + n <= t.length; n++) {
          const gram = t.slice(i, i + n)
          if (stopwords.has(gram[0]) || stopwords.has(gram[n - 1]) || gram.some(w => /^\d+$/.test(w)) || gram.join('').length < 4) continue
          seen.add(gram.join(' '))
        }
      }
    }
    for (const g of seen) { const c = count.get(g) ?? { videos: 0, views: 0 }; c.videos += 1; c.views += v.observed.views ?? 0; count.set(g, c) }
  }
  const out = [...count.entries()].filter(([, c]) => c.videos >= minVideos).map(([term, c]) => ({ term, videos: c.videos, views: c.views, share: Math.round((c.videos / Math.max(videos.length, 1)) * 100) / 100 }))
  // Prefer longer phrases over their own sub-phrases when both appear in the same videos.
  const pruned = out.filter(a => !out.some(b => b !== a && b.term.includes(a.term) && b.videos >= a.videos && b.term.split(' ').length > a.term.split(' ').length))
  return pruned.sort((a, b) => b.videos - a.videos || b.views - a.views || a.term.localeCompare(b.term)).slice(0, limit)
}

const QUESTION_START = /^(¿|c[oó]mo|por qu[eé]|qu[eé]|cu[aá]l|cu[aá]ndo|d[oó]nde|cu[aá]nto|how|why|what|which|when|where|is |are |can |should |wie |warum|was |wann|pourquoi|comment|como|por que)/i

/** Titles phrased as questions: a hint at what people ask. Taken from video titles, not from search logs. */
export function extractQuestions(videos: YouTubeVideoResult[], limit = 8) {
  const seen = new Set<string>()
  return videos.filter(v => { const t = v.title.trim(); return t.includes('?') || QUESTION_START.test(t) })
    .sort((a, b) => (b.observed.views ?? 0) - (a.observed.views ?? 0))
    .filter(v => { const k = v.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, limit).map(v => ({ text: v.title.trim(), videoId: v.videoId, views: v.observed.views }))
}

/** Terms that weigh more among the newest videos than among the year's most-viewed ones. */
export function emergingTerms(top: YouTubeVideoResult[], recent: YouTubeVideoResult[], limit = 10): Term[] {
  const base = new Map(extractTerms(top, 1, 400).map(t => [t.term, t.share]))
  return extractTerms(recent, 2, 200).filter(t => t.share - (base.get(t.term) ?? 0) >= 0.15).sort((a, b) => (b.share - (base.get(b.term) ?? 0)) - (a.share - (base.get(a.term) ?? 0))).slice(0, limit)
}

// ---------- Indices ----------
function stats(videos: YouTubeVideoResult[], recent: YouTubeVideoResult[], pick: (v: YouTubeVideoResult) => boolean): FormatStats {
  const mine = videos.filter(pick)
  const vpd = mine.map(v => v.calculated.viewsPerDay).filter(num)
  return { count: mine.length, recentCount: recent.filter(pick).length, medianViewsPerDay: median(vpd) === null ? null : Math.round(median(vpd)!) }
}

const isShort = (v: YouTubeVideoResult) => inferFormat(v).format === 'short'
const isLong = (v: YouTubeVideoResult) => ['brief', 'medium', 'long'].includes(inferFormat(v).format)
const k = (n: number) => new Intl.NumberFormat('es-ES', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)

/** Thresholds that decide what counts as enough evidence. Exported so the screen and the tests state the same numbers. */
export const EVIDENCE = { minTop: 10, minRecent: 5, minCohort: 8, minKeptShare: 0.4, topVideoShare: 0.5, growthUp: 2, growthDown: 0.75 } as const

/** Judges every video of both samples (topic, niche, language, live, promo) and keeps the ones that may influence the indices. */
function clean(s: TopicSamples): { top: YouTubeVideoResult[]; recent: YouTubeVideoResult[]; promoTop: Set<string>; quality: SampleQuality } {
  const q = queryProfile(s.topic), expected = expectedLanguages(s.region, s.language)
  const excluded: Record<ExclusionReason, number> = { tema: 0, nicho: 0, idioma: 0, directo: 0 }
  const examples: SampleQuality['examples'] = [], verdicts = new Map<string, ReturnType<typeof assessVideo>>()
  let examined = 0, promo = 0, unverified = 0, inMarket = 0, known = 0
  const judge = (v: YouTubeVideoResult) => {
    let a = verdicts.get(v.videoId)
    if (!a) {
      a = assessVideo(v, q, expected); verdicts.set(v.videoId, a); examined++
      if (!a.relevant && a.reason) { excluded[a.reason]++; if (examples.length < 5) examples.push({ title: v.title.slice(0, 90), reason: a.reason, detail: a.detail }) }
      else { if (a.promo) promo++; if (a.language.verdict === 'sin_verificar') unverified++; if (v.channelCountry) { known++; if (s.region && v.channelCountry === s.region) inMarket++ } }
    }
    return a
  }
  const uniqueRelevant = (vs: YouTubeVideoResult[]) => { const u = new Set<string>(); return vs.filter(v => { if (u.has(v.videoId)) return false; u.add(v.videoId); return judge(v).relevant }) }
  const top = uniqueRelevant(s.top.videos), recent = uniqueRelevant(s.recent.videos)
  const promoTop = new Set([...top, ...recent].filter(v => verdicts.get(v.videoId)?.promo).map(v => v.videoId))
  return { top, recent, promoTop, quality: { examined, kept: new Set([...top, ...recent].map(v => v.videoId)).size, excluded, examples, promo, outliers: 0, languageUnverified: unverified, channelInMarket: inMarket, channelCountryKnown: known } }
}

/** Median views/day of a cohort after dropping promotions and viral outliers, plus how many videos stand behind it. Only videos aged ≥ 3 days. */
function cohort(vs: YouTubeVideoResult[], promo: Set<string>, now: number) {
  const aged = vs.filter(v => !promo.has(v.videoId) && (ageDays(v, now) ?? 0) >= 3)
  const vpd = aged.map(v => v.calculated.viewsPerDay).filter(num)
  const out = viralOutliers(vpd), kept = vpd.filter((_, i) => !out.has(i))
  return { n: kept.length, medianVpd: median(kept), outliers: out.size }
}

export function growthFrom(recent: { n: number; medianVpd: number | null }, previous: { n: number; medianVpd: number | null } | null, windowDays: number): GrowthResult {
  const base = { windowDays, recent: { n: recent.n, medianVpd: recent.medianVpd } }
  if (!previous) return { ...base, state: 'no_calculable', reason: `Hace falta comparar dos ventanas seguidas de ${windowDays} días con al menos ${EVIDENCE.minCohort} vídeos relevantes cada una. Esta consulta solo tiene la reciente: usa «Medir crecimiento» (≈ 102 unidades).` }
  if (recent.n < EVIDENCE.minCohort || previous.n < EVIDENCE.minCohort || !recent.medianVpd || !previous.medianVpd) {
    return { ...base, previous, state: 'no_calculable', reason: `Pocas pruebas: ${recent.n} vídeos relevantes en los últimos ${windowDays} días y ${previous.n} en los ${windowDays} anteriores (mínimo ${EVIDENCE.minCohort} en cada ventana).` }
  }
  const ratio = recent.medianVpd / previous.medianVpd
  // The older window had more time to collect views, which flatters neither side evenly: only a clear gap is called a trend.
  const label = ratio >= EVIDENCE.growthUp ? 'al alza (posible)' : ratio <= EVIDENCE.growthDown ? 'a la baja' : 'estable o no concluyente'
  return { ...base, previous, state: 'calculable', ratio, label, reason: `Vistas por día (mediana): ${Math.round(recent.medianVpd)} en los últimos ${windowDays} días frente a ${Math.round(previous.medianVpd)} en los ${windowDays} anteriores (×${ratio.toFixed(2)}). Los vídeos más antiguos tuvieron más tiempo para acumular vistas, por eso solo se habla de alza con ×${EVIDENCE.growthUp} o más y de baja con ×${EVIDENCE.growthDown} o menos.` }
}
const growthIndex = (g: GrowthResult) => (g.state === 'calculable' && g.ratio ? Math.round(clamp(50 + 40 * Math.log2(Math.max(g.ratio, 0.05) / 1.5))) : null)
const opportunityOf = (demand: number, competition: number, supply: number, growth: number | null) => {
  const raw = growth === null ? (0.45 * demand + 0.25 * (100 - competition) + 0.2 * (100 - supply)) / 0.9 : 0.45 * demand + 0.25 * (100 - competition) + 0.2 * (100 - supply) + 0.1 * growth
  return Math.round(demand < 25 ? Math.min(raw, 20) : raw)
}

export function analyzeTopic(s: TopicSamples, now = Date.now()): TopicAnalysis {
  // Relevance first: the raw search is fuzzy. What survives is unique, on-topic, in the market's language and not on air.
  const c = clean(s)
  const top = c.top, recent = c.recent, promo = c.promoTop
  const both = (() => { const u = new Set<string>(); return [...top, ...recent].filter(v => !u.has(v.videoId) && !!u.add(v.videoId)) })()
  const rawRecentLen = new Set(s.recent.videos.map(v => v.videoId)).size

  // Demand: views/day of the on-topic most-viewed videos. Promotions and viral outliers are shown but never set the number.
  const topVpdAll = top.filter(v => !promo.has(v.videoId)).map(v => v.calculated.viewsPerDay).filter(num)
  const topOut = viralOutliers(topVpdAll), topVpd = median(topVpdAll.filter((_, i) => !topOut.has(i)))
  const recentCohort = cohort(recent, promo, now)
  const demand = Math.round(0.6 * logScore(topVpd, 20000) + 0.4 * logScore(recentCohort.medianVpd ?? (topVpd ?? 0) * 0.5, 20000))
  const topViews = top.map(v => v.observed.views ?? 0), topTotal = topViews.reduce((t, x) => t + x, 0)
  const oneVideoShare = topTotal ? Math.max(0, ...topViews) / topTotal : 0
  const quality: SampleQuality = { ...c.quality, outliers: topOut.size + recentCohort.outliers }

  // Supply: how much is being published and by how many different channels (on-topic videos only).
  const WINDOW = s.recentDays ?? 30
  const ages = recent.map(v => ageDays(v, now)).filter(num)
  const oldest = ages.length ? Math.max(...ages) : null
  const full = rawRecentLen >= 25
  const spanDays = oldest === null ? WINDOW : full ? Math.max(oldest, 1) : WINDOW
  const uploadsPerWeek = recent.length ? Math.round((recent.filter(v => (ageDays(v, now) ?? 99) <= WINDOW).length / (Math.min(spanDays, WINDOW) / 7)) * 10) / 10 : 0
  const recentChannels = new Set(recent.map(v => v.channelId).filter(Boolean)).size
  const supply = Math.round(0.6 * logScore(uploadsPerWeek, 100) + 0.4 * clamp((recentChannels / 25) * 100))

  // Competition: how big and how concentrated the channels behind the most-viewed videos are.
  const subs = top.map(v => v.observed.channelSubscribers)
  const subsKnown = subs.filter(num)
  const medianSubs = median(subsKnown)
  const authority = logScore(medianSubs, 5_000_000)
  const top10 = top.slice(0, 10)
  const big = top10.filter(v => (v.observed.channelSubscribers ?? 0) >= 100_000).length
  const dominance = top10.length ? (big / top10.length) * 100 : 0
  const byChannel = new Map<string, number>()
  for (const v of top) byChannel.set(v.channelId, (byChannel.get(v.channelId) ?? 0) + (v.observed.views ?? 0))
  const totalViews = [...byChannel.values()].reduce((t, x) => t + x, 0)
  const topShare = totalViews ? Math.max(...byChannel.values()) / totalViews : 0
  const competition = Math.round(0.4 * authority + 0.35 * dominance + 0.25 * topShare * 100)

  // Growth: «No calculable» until two comparable windows exist (see growthFrom / applyGrowth).
  const growth = growthFrom(recentCohort, null, WINDOW)
  const growthIdx = growthIndex(growth)
  const growthPct = null

  const enough = top.length >= 20 && recent.length >= 10 && subsKnown.length / Math.max(top.length, 1) >= 0.7
  const keptShare = quality.examined ? quality.kept / quality.examined : 0
  const lowReasons: string[] = []
  if (top.length < EVIDENCE.minTop || recent.length < EVIDENCE.minRecent) lowReasons.push(`solo ${top.length} vídeos relevantes entre los más vistos y ${recent.length} entre los recientes`)
  if (quality.examined >= 10 && keptShare < EVIDENCE.minKeptShare) lowReasons.push(`más de la mitad de los resultados de YouTube (${quality.examined - quality.kept} de ${quality.examined}) no eran del tema o del mercado`)
  if (oneVideoShare > EVIDENCE.topVideoShare && top.length >= 5) lowReasons.push(`un solo vídeo reúne el ${Math.round(oneVideoShare * 100)} % de las vistas de la muestra`)
  const confidence: Confidence = lowReasons.length ? 'baja' : enough ? 'media' : 'baja'

  const verdictRaw: Verdict = demand < 25 ? 'sin_demanda'
    : demand >= 50 && competition <= 55 && supply <= 60 ? 'oportunidad'
    : demand >= 50 && (competition > 70 || supply > 75) ? 'saturado' : 'mixto'
  // Thin or contaminated evidence never earns the label «oportunidad».
  const verdict: Verdict = confidence === 'baja' && verdictRaw === 'oportunidad' ? 'mixto' : verdictRaw
  const opportunity = opportunityOf(demand, competition, supply, growthIdx)

  const confidenceNote = `Muestra de ${top.length} vídeos relevantes entre los más vistos y ${recent.length} entre los recientes (de ${quality.examined} resultados de YouTube; ${quality.kept} sirven; YouTube no permite contar todos los vídeos ni creadores).${lowReasons.length ? ` Confianza baja: ${lowReasons.join('; ')}.` : ''} ${subsKnown.length}/${top.length} canales con suscriptores visibles. Con una sola fuente la confianza nunca pasa de «media».`

  const fq = (() => { const all = both.map(v => inferFormat(v)); return { shortConfirmed: all.filter(f => f.format === 'short' && f.confidence === 'alta').length, shortProbable: all.filter(f => f.format === 'short' && f.confidence !== 'alta').length, clipsNotShort: all.filter(f => f.format === 'brief' && f.confidence === 'baja').length } })()
  const ex = quality.excluded
  const evidence: Evidence[] = [
    { label: 'Resultados de YouTube examinados / que sirven', value: `${quality.examined} / ${quality.kept}`, kind: 'observado' },
    ...(quality.examined - quality.kept ? [{ label: 'Descartados por tema, nicho, idioma o directo', value: `${ex.tema + ex.nicho} tema/nicho · ${ex.idioma} idioma · ${ex.directo} directos`, kind: 'calculado' as const }] : []),
    ...(quality.promo ? [{ label: 'Posibles anuncios o promociones (fuera de la demanda)', value: String(quality.promo), kind: 'inferido' as const }] : []),
    ...(quality.outliers ? [{ label: 'Vídeos virales atípicos (fuera de la demanda)', value: String(quality.outliers), kind: 'calculado' as const }] : []),
    { label: 'Idioma sin verificar entre los que sirven', value: `${quality.languageUnverified} de ${quality.kept}`, kind: 'inferido' },
    ...(s.region ? [{ label: `Canales que declaran ${s.region} como país`, value: quality.channelCountryKnown ? `${quality.channelInMarket} de ${quality.channelCountryKnown} que declaran país` : 'ninguno declara país', kind: 'observado' as const }] : []),
    { label: 'Vistas por día (mediana, vídeos relevantes más vistos del último año)', value: topVpd === null ? 'sin datos' : k(Math.round(topVpd)), kind: 'calculado' },
    { label: `Vistas por día (mediana, vídeos relevantes de los últimos ${WINDOW} días con ≥ 3 días)`, value: recentCohort.medianVpd === null ? 'sin datos' : k(Math.round(recentCohort.medianVpd)), kind: 'calculado' },
    { label: `Subidas por semana en los últimos ${WINDOW} días (muestra)`, value: String(uploadsPerWeek), kind: 'calculado' },
    { label: 'Canales distintos entre los vídeos recientes', value: `${recentChannels} de ${recent.length}`, kind: 'observado' },
    { label: 'Suscriptores del canal mediano de los más vistos', value: medianSubs === null ? 'sin datos' : k(Math.round(medianSubs)), kind: 'observado' },
    { label: 'Canales de ≥ 100 000 suscriptores en el top 10', value: `${big} de ${top10.length}`, kind: 'observado' },
    { label: 'Cuota de vistas del canal dominante (muestra)', value: `${Math.round(topShare * 100)} %`, kind: 'calculado' },
    { label: 'Shorts: confirmados con #shorts / probables solo por duración / clips cortos que no son Shorts', value: `${fq.shortConfirmed} / ${fq.shortProbable} / ${fq.clipsNotShort}`, kind: 'inferido' },
    { label: 'Crecimiento (ventanas comparables)', value: growth.state === 'calculable' ? growth.label! : 'No calculable', kind: 'calculado' },
    { label: 'Resultados que YouTube dice tener (aprox., no es un censo)', value: s.top.approxTotal === null ? 'sin dato' : k(s.top.approxTotal), kind: 'observado' },
  ]

  const reasons: string[] = []
  if (demand < 25) reasons.push(`Hay poca demanda observable: los vídeos del tema ganan ${topVpd === null ? 'pocas' : k(Math.round(topVpd))} vistas/día. Que haya pocos vídeos no lo convierte en oportunidad.`)
  else reasons.push(`Demanda ${demand}/100: los vídeos relevantes más vistos del año ganan ${topVpd === null ? '—' : k(Math.round(topVpd))} vistas/día (mediana, sin anuncios ni virales atípicos).`)
  reasons.push(`Oferta ${supply}/100: ${uploadsPerWeek} vídeos nuevos por semana en la muestra y ${recentChannels} canales distintos entre ${recent.length} recientes.`)
  reasons.push(`Competencia ${competition}/100: canal mediano con ${medianSubs === null ? '—' : k(Math.round(medianSubs))} suscriptores y ${big} de ${top10.length} del top 10 con ≥ 100 000.`)
  reasons.push(`Crecimiento: ${growth.state === 'calculable' ? growth.label : 'No calculable'}. ${growth.reason}`)

  const headline = confidence === 'baja' && verdictRaw === 'oportunidad' ? 'Parece prometedor, pero la muestra relevante es insuficiente para llamarlo oportunidad'
    : verdict === 'oportunidad' ? 'Demanda clara con oferta y competencia manejables'
    : verdict === 'saturado' ? 'Hay demanda, pero la oferta o los canales dominantes lo hacen difícil'
    : verdict === 'sin_demanda' ? 'Poca oferta, pero también poca demanda observable: no es una oportunidad'
    : 'Señales mixtas: investígalo con otro ángulo antes de apostar'

  const niches = [...new Set(both.flatMap(v => nichesOf(v).map(n => n.niche)))]
  const isShortProper = (v: YouTubeVideoResult) => { const f = inferFormat(v); return f.format === 'short' }
  return {
    topic: s.topic, region: s.region, language: s.language, fetchedAt: s.fetchedAt, units: s.units, recentDays: WINDOW,
    indices: { demand, supply, competition, growth: growthIdx, opportunity }, growth, growthPct, verdict, headline, reasons, confidence, confidenceNote, evidence, quality,
    byFormat: { short: stats(top, recent, isShortProper), long: stats(top, recent, isLong) }, formatQuality: fq,
    niches, terms: extractTerms(both), emerging: emergingTerms(top, recent), questions: extractQuestions(both),
    sampleSizes: { top: top.length, recent: recent.length }, approxTotals: { top: s.top.approxTotal, recent: s.recent.approxTotal },
    topVideos: top.filter(v => !promo.has(v.videoId)).slice(0, 9),
  }
}

/**
 * Adds the previous window (same length, adjacent, same search and the same relevance rules) to an analysis and calculates growth.
 * Pure: the caller pays for the search and stores the result.
 */
export function applyGrowth(a: TopicAnalysis, previous: Sample, now = Date.now()): TopicAnalysis {
  const q = queryProfile(a.topic), expected = expectedLanguages(a.region, a.language)
  const seen = new Set<string>()
  const relevant = previous.videos.filter(v => { if (seen.has(v.videoId)) return false; seen.add(v.videoId); return assessVideo(v, q, expected).relevant })
  const promo = new Set(relevant.filter(v => assessVideo(v, q, expected).promo).map(v => v.videoId))
  const prev = cohort(relevant, promo, now)
  const growth = growthFrom(a.growth.recent, { n: prev.n, medianVpd: prev.medianVpd }, a.recentDays)
  const growthIdx = growthIndex(growth)
  const pct = growth.state === 'calculable' && growth.ratio ? Math.round((growth.ratio - 1) * 100) : null
  const reasons = a.reasons.map(r => (r.startsWith('Crecimiento:') ? `Crecimiento: ${growth.state === 'calculable' ? growth.label : 'No calculable'}. ${growth.reason}` : r))
  const evidence = a.evidence.map(e => (e.label.startsWith('Crecimiento') ? { ...e, value: growth.state === 'calculable' ? `${growth.label} (×${growth.ratio!.toFixed(2)})` : 'No calculable' } : e))
  return { ...a, growth, growthPct: pct, indices: { ...a.indices, growth: growthIdx, opportunity: opportunityOf(a.indices.demand, a.indices.competition, a.indices.supply, growthIdx) }, reasons, evidence }
}

/** Where the topic is popular but little is published in a format: H "oportunidades por formato". */
const shortNote = (a: TopicAnalysis) => `Shorts: ${a.formatQuality.shortConfirmed} confirmados con #shorts y ${a.formatQuality.shortProbable} probables solo por duración; la API no permite confirmar un Short`
export function formatOpportunity(a: TopicAnalysis): { recommended: 'short' | 'long' | null; reason: string } {
  const { short, long } = a.byFormat
  const total = (x: FormatStats) => x.count + x.recentCount
  if (total(short) + total(long) < 8) return { recommended: null, reason: 'Muestra demasiado pequeña para comparar formatos.' }
  const sv = short.medianViewsPerDay, lv = long.medianViewsPerDay
  const shortShare = total(short) / Math.max(total(short) + total(long), 1)
  if (lv !== null && lv >= 200 && shortShare < 0.2) return { recommended: 'short', reason: `Los vídeos largos ganan ${k(lv)} vistas/día pero solo el ${Math.round(shortShare * 100)} % de la muestra son Shorts (inferidos): hueco para Shorts (${shortNote(a)}).` }
  if (sv !== null && sv >= 500 && total(long) > 0 && total(long) / Math.max(total(short) + total(long), 1) < 0.2) return { recommended: 'long', reason: `Los Shorts ganan ${k(sv)} vistas/día y casi no hay vídeos largos en la muestra: hueco para vídeos largos (${shortNote(a)}).` }
  return { recommended: null, reason: 'Ambos formatos están cubiertos en la muestra.' }
}

/** Does the analysis have any sample of the chosen formats? ("brief", "medium" and "long" all live in the long-form bucket.) */
export function formatCovered(a: TopicAnalysis, formats: string[]): boolean {
  if (formats.length === 0) return true
  const has = (x: FormatStats) => x.count + x.recentCount > 0
  return formats.some(f => f === 'short' ? has(a.byFormat.short) : f === 'live' ? true : has(a.byFormat.long))
}
