import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { stopwords } from '@/lib/radar'
import { GEO_LEVEL_LABEL, shortCountry, summarizeGeo, type GeoSummary } from './geo'
import { resolveDoubtful } from './semantic'
import { concentration, demandProfile, entryDifficulty, medianInterval, opportunityOf, sensitivity, smallChannelWins, verdictOf, type Concentration, type DemandProfile, type Entry, type SmallWins, type Sensitivity, type Verdict } from './statistics'
import { inferFormat, nichesOf, type Confidence } from './taxonomy'
import { assessVideo, expectedLanguages, queryProfile, viralOutliers, type Assessment, type ExclusionReason, type SampleQuality, type VideoStatus } from './relevance'
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

export type { Verdict } from './statistics'
export type Evidence = { label: string; value: string; kind: 'observado' | 'calculado' | 'inferido' }

/** One video of the raw search, with the verdict it got and why: nothing the engine looked at is hidden from the user. */
export type SampleVideo = {
  videoId: string; url: string; title: string; channelTitle: string
  views: number | null; publishedAt: string; durationSeconds: number | null
  inTop: boolean; inRecent: boolean
  status: VideoStatus; reason: ExclusionReason | null; detail: string
  language: string | null; languageVerdict: 'coincide' | 'no_coincide' | 'sin_verificar'
  promo: boolean; /** Why it counts as an ad or a sponsored video. */ promoWhy?: string | null; outlier: boolean; format: string; live: string | null
}

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
  /** When the previous window was measured (absent = never measured). */
  measuredAt?: string
}

/** Growth state for the screen: never measured, measured and valid, or measured but not calculable. A measurement stays valid as long as the analysis does (7 days). */
export function growthStatus(a: Pick<TopicAnalysis, 'growth' | 'fetchedAt'>, now = Date.now()): { kind: 'sin_medir' | 'vigente' | 'medido_no_calculable' | 'caducado'; measuredAt: string | null } {
  const g = a.growth, measured = !!g.previous || !!g.measuredAt
  if (!measured) return { kind: 'sin_medir', measuredAt: null }
  const at = g.measuredAt ?? a.fetchedAt, t = Date.parse(at)
  if (!Number.isFinite(t) || now - t >= 7 * 86400000) return { kind: 'caducado', measuredAt: at }
  return { kind: g.state === 'calculable' ? 'vigente' : 'medido_no_calculable', measuredAt: at }
}

/**
 * Version of the engine that produced an analysis. Raised whenever a change alters what an analysis means (relevance rules, formulas, window
 * handling). An analysis from an older engine is kept and shown, but never mixed into recommendations, opportunities or comparisons, and it
 * is never served from the cache: it is re-analysed instead.
 */
export const ENGINE_VERSION = 4
export const isCurrentEngine = (a: { engineVersion?: number }) => a.engineVersion === ENGINE_VERSION

export type TopicAnalysis = {
  /** Engine version that made this analysis (absent on analyses saved before versions existed). */
  engineVersion?: number
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
  /** Every video the search returned (both samples), accepted or not, with its verdict and reason. */
  sample: SampleVideo[]
  byFormat: { short: FormatStats; long: FormatStats }
  /** How sure the Shorts count is: confirmed by #shorts vs only ≤ 60 s, and short clips that are not Shorts. */
  formatQuality: { shortConfirmed: number; shortProbable: number; clipsNotShort: number }
  niches: string[]
  terms: Term[]; emerging: Term[]; questions: Array<{ text: string; videoId: string; views: number | null }>
  /** Where the results point geographically, in four separate senses (requested / channel / content / audience). Optional on older analyses. */
  geo?: GeoSummary
  /** Statistical reading of the sample. Optional: analyses saved before it existed do not have it. */
  stats?: { concentration: Concentration; smallWins: SmallWins; demandProfile: DemandProfile; entry: Entry; sensitivity: Sensitivity; demandInterval: { lo: number; hi: number } | null }
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

/** Judges every video of both samples (topic, meaning, niche, language, live, promo) and keeps the ones that may influence the indices. */
function clean(s: TopicSamples): { top: YouTubeVideoResult[]; recent: YouTubeVideoResult[]; promoTop: Set<string>; quality: SampleQuality; verdicts: Map<string, Assessment>; inTop: Set<string>; inRecent: Set<string> } {
  const q = queryProfile(s.topic), expected = expectedLanguages(s.region, s.language)
  const all = (() => { const u = new Set<string>(); return [...s.top.videos, ...s.recent.videos].filter(v => !u.has(v.videoId) && !!u.add(v.videoId)) })()
  // Pass 1: is the SAMPLE itself ambiguous? (a share of the results that passed the topic words point to other domains or meanings)
  const first = new Map(all.map(v => [v.videoId, assessVideo(v, q, expected, { region: s.region })]))
  const onTopic = all.filter(v => { const a = first.get(v.videoId)!; return a.reason !== 'idioma' && a.reason !== 'directo' && a.reason !== 'tema' })
  const wrongMeaning = onTopic.filter(v => ['nicho', 'sentido'].includes(first.get(v.videoId)!.reason ?? '')).length
  const ambiguousSample = !!q.niches.length && onTopic.length >= 8 && wrongMeaning / onTopic.length >= 0.2
  // Pass 2: when ambiguous, every video must positively confirm the intended meaning.
  const judged = ambiguousSample ? new Map(all.map(v => [v.videoId, assessVideo(v, q, expected, { strict: true, region: s.region })])) : first
  // Videos the word rules could not decide are compared, locally and for free, with the ones whose meaning was confirmed.
  const verdicts = resolveDoubtful(all, judged, q.terms)
  const excluded: Record<ExclusionReason, number> = { tema: 0, nicho: 0, idioma: 0, directo: 0, sentido: 0, contexto: 0 }
  let uncertain = 0, promo = 0, unverified = 0, inMarket = 0, known = 0
  for (const v of all) {
    const a = verdicts.get(v.videoId)!
    if (a.status === 'descartado' && a.reason) excluded[a.reason]++
    else if (a.status === 'dudoso') uncertain++
    else { if (a.promo) promo++; if (a.language.verdict === 'sin_verificar') unverified++; if (v.channelCountry) { known++; if (s.region && v.channelCountry === s.region) inMarket++ } }
  }
  const keepOf = (vs: YouTubeVideoResult[]) => { const u = new Set<string>(); return vs.filter(v => { if (u.has(v.videoId)) return false; u.add(v.videoId); return verdicts.get(v.videoId)!.relevant }) }
  const top = keepOf(s.top.videos), recent = keepOf(s.recent.videos)
  const promoTop = new Set([...top, ...recent].filter(v => verdicts.get(v.videoId)?.promo).map(v => v.videoId))
  const kept = new Set([...top, ...recent].map(v => v.videoId)).size
  return { top, recent, promoTop, verdicts, inTop: new Set(s.top.videos.map(v => v.videoId)), inRecent: new Set(s.recent.videos.map(v => v.videoId)),
    quality: { examined: all.length, kept, excluded, uncertain, ambiguousSample, promo, outliers: 0, languageUnverified: unverified, channelInMarket: inMarket, channelCountryKnown: known } }
}

/** Median views/day of a cohort after dropping promotions and viral outliers, plus how many videos stand behind it. Only videos aged ≥ 3 days. */
function cohort(vs: YouTubeVideoResult[], promo: Set<string>, now: number) {
  const aged = vs.filter(v => !promo.has(v.videoId) && (ageDays(v, now) ?? 0) >= 3)
  const vpd = aged.map(v => v.calculated.viewsPerDay).filter(num)
  const out = viralOutliers(vpd), kept = vpd.filter((_, i) => !out.has(i))
  const withVpd = aged.filter(v => typeof v.calculated.viewsPerDay === 'number' && Number.isFinite(v.calculated.viewsPerDay))
  return { n: kept.length, medianVpd: median(kept), outliers: out.size, outlierIds: new Set(withVpd.filter((_, i) => out.has(i)).map(v => v.videoId)) }
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
export function analyzeTopic(s: TopicSamples, now = Date.now()): TopicAnalysis {
  // Relevance first: the raw search is fuzzy. What survives is unique, on-topic, in the market's language and not on air.
  const c = clean(s)
  const top = c.top, recent = c.recent, promo = c.promoTop
  const both = (() => { const u = new Set<string>(); return [...top, ...recent].filter(v => !u.has(v.videoId) && !!u.add(v.videoId)) })()
  const geo = summarizeGeo(both, s.region, [...c.verdicts.values()].filter(a => a.status === 'dudoso' && a.detail.startsWith('habla de')).length, shortCountry)

  // Demand: views/day of the on-topic most-viewed videos. Promotions and viral outliers are shown but never set the number.
  const topCand = top.filter(v => !promo.has(v.videoId) && num(v.calculated.viewsPerDay))
  const topVpdAll = topCand.map(v => v.calculated.viewsPerDay as number)
  const topOut = viralOutliers(topVpdAll), topVpd = median(topVpdAll.filter((_, i) => !topOut.has(i)))
  const outlierIds = new Set(topCand.filter((_, i) => topOut.has(i)).map(v => v.videoId))
  const recentCohort = cohort(recent, promo, now)
  const demand = Math.round(0.6 * logScore(topVpd, 20000) + 0.4 * logScore(recentCohort.medianVpd ?? (topVpd ?? 0) * 0.5, 20000))
  const topViews = top.map(v => v.observed.views ?? 0), topTotal = topViews.reduce((t, x) => t + x, 0)
  const oneVideoShare = topTotal ? Math.max(0, ...topViews) / topTotal : 0
  recentCohort.outlierIds.forEach(id => outlierIds.add(id))
  const quality: SampleQuality = { ...c.quality, outliers: topOut.size + recentCohort.outliers }
  const sample: SampleVideo[] = (() => { const u = new Set<string>(); return [...s.top.videos, ...s.recent.videos].filter(v => !u.has(v.videoId) && !!u.add(v.videoId)).map(v => { const a = c.verdicts.get(v.videoId)!; return { videoId: v.videoId, url: v.url, title: v.title.slice(0, 140), channelTitle: v.channelTitle.slice(0, 60), views: v.observed.views, publishedAt: v.publishedAt, durationSeconds: v.observed.durationSeconds, inTop: c.inTop.has(v.videoId), inRecent: c.inRecent.has(v.videoId), status: a.status, reason: a.reason, detail: a.detail.slice(0, 200), language: a.language.language, languageVerdict: a.language.verdict, promo: a.promo, promoWhy: a.promoWhy, outlier: outlierIds.has(v.videoId), format: inferFormat(v).format, live: v.live ?? null } }) })()

  // Supply: how much is being published and by how many different channels (on-topic videos only).
  // The rate is measured over ONE consistent window: the span of the RAW newest-first sample (what the search returned, relevant or not),
  // never the age of the oldest video that happened to survive the relevance filter, and a stray old result cannot stretch it.
  const WINDOW = s.recentDays ?? 30
  const rawIds = new Set<string>(), rawAges: number[] = []
  for (const v of s.recent.videos) if (!rawIds.has(v.videoId)) { rawIds.add(v.videoId); const a = ageDays(v, now); if (a !== null) rawAges.push(a) }
  rawAges.sort((x, y) => x - y)
  const strayAges = viralOutliers(rawAges)                                   // e.g. a month-old result among videos from the last 3 days
  const denseAges = rawAges.filter((_, i) => !strayAges.has(i))
  const rawRecentLen = rawIds.size
  const full = rawRecentLen >= 25
  const spanDays = full && denseAges.length ? Math.min(Math.max(denseAges[denseAges.length - 1], 1), WINDOW) : WINDOW
  const inSpan = recent.filter(v => (ageDays(v, now) ?? 99) <= spanDays)
  const uploadsPerWeek = inSpan.length ? Math.round((inSpan.length / (spanDays / 7)) * 10) / 10 : 0
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
  if (geo.level === 'contradictoria') lowReasons.push(`la mayoría de las pistas geográficas apuntan a otros países (${geo.content.others.concat(geo.channel.others).slice(0, 2).map(o => shortCountry(o.country)).join(' y ')}), no al mercado pedido`)
  if (top.length < EVIDENCE.minTop || recent.length < EVIDENCE.minRecent) lowReasons.push(`solo ${top.length} vídeos relevantes entre los más vistos y ${recent.length} entre los recientes`)
  if (quality.examined >= 10 && keptShare < EVIDENCE.minKeptShare) lowReasons.push(`más de la mitad de los resultados de YouTube (${quality.examined - quality.kept} de ${quality.examined}) no eran del tema o del mercado`)
  if (quality.examined >= 10 && quality.uncertain / quality.examined >= 0.3) lowReasons.push(`${quality.uncertain} de ${quality.examined} resultados son dudosos: nada confirma que traten del significado buscado`)
  if (oneVideoShare > EVIDENCE.topVideoShare && top.length >= 5) lowReasons.push(`un solo vídeo reúne el ${Math.round(oneVideoShare * 100)} % de las vistas de la muestra`)
  const confidence: Confidence = lowReasons.length ? 'baja' : enough ? 'media' : 'baja'

  const verdictRaw: Verdict = verdictOf(demand, competition, supply)
  // Thin or contaminated evidence never earns the label «oportunidad».
  const verdict: Verdict = confidence === 'baja' && verdictRaw === 'oportunidad' ? 'mixto' : verdictRaw
  const opportunity = opportunityOf(demand, competition, supply, growthIdx)
  const conc = concentration(top.map(v => ({ channelId: v.channelId, views: v.observed.views })))
  const small = smallChannelWins(top.map(v => ({ subs: v.observed.channelSubscribers, views: v.observed.views })))
  const profile = demandProfile({ topVpd, recentVpd: recentCohort.medianVpd, oneVideoShare, outliers: quality.outliers, relevantTop: top.length, relevantRecent: recent.length })
  const entry = entryDifficulty({ competition, supply, concentration: conc, smallWins: small })
  const sens = sensitivity({ demand, competition, supply, growth: growthIdx })
  const statistical = { concentration: conc, smallWins: small, demandProfile: profile, entry, sensitivity: sens, demandInterval: medianInterval(topVpdAll) }

  const confidenceNote = `Muestra de ${top.length} vídeos relevantes entre los más vistos y ${recent.length} entre los recientes (de ${quality.examined} resultados de YouTube; ${quality.kept} sirven; YouTube no permite contar todos los vídeos ni creadores).${lowReasons.length ? ` Confianza baja: ${lowReasons.join('; ')}.` : ''} ${subsKnown.length}/${top.length} canales con suscriptores visibles. Con una sola fuente la confianza nunca pasa de «media».`

  const fq = (() => { const all = both.map(v => inferFormat(v)); return { shortConfirmed: all.filter(f => f.format === 'short' && f.confidence === 'alta').length, shortProbable: all.filter(f => f.format === 'short' && f.confidence !== 'alta').length, clipsNotShort: all.filter(f => f.format === 'brief' && f.confidence === 'baja').length } })()
  const ex = quality.excluded, wrong = ex.tema + ex.nicho + ex.sentido
  const evidence: Evidence[] = [
    { label: 'Resultados de YouTube examinados / que sirven', value: `${quality.examined} / ${quality.kept}`, kind: 'observado' },
    ...(quality.examined - quality.kept ? [{ label: 'Fuera de las métricas (inspecciónalos en «Muestra»)', value: `${wrong} de otro tema o significado · ${ex.idioma} de otro idioma · ${ex.directo} directos · ${quality.uncertain} dudosos sin confirmar`, kind: 'calculado' as const }] : []),
    ...(quality.ambiguousSample ? [{ label: 'La consulta tiene varios significados', value: 'solo cuentan los vídeos que confirman el sentido buscado', kind: 'inferido' as const }] : []),
    ...(quality.promo ? [{ label: 'Posibles anuncios o promociones (fuera de la demanda)', value: String(quality.promo), kind: 'inferido' as const }] : []),
    ...(quality.outliers ? [{ label: 'Vídeos virales atípicos (fuera de la demanda)', value: String(quality.outliers), kind: 'calculado' as const }] : []),
    { label: 'Idioma sin verificar entre los que sirven', value: `${quality.languageUnverified} de ${quality.kept}`, kind: 'inferido' },
    ...(s.region ? [{ label: `Canales que declaran ${s.region} como país`, value: quality.channelCountryKnown ? `${quality.channelInMarket} de ${quality.channelCountryKnown} que declaran país` : 'ninguno declara país', kind: 'observado' as const }] : []),
    ...(s.region ? [{ label: 'Confianza geográfica (contenido del vídeo y país declarado del canal; la audiencia no se puede medir)', value: `${GEO_LEVEL_LABEL[geo.level]}${geo.inMarketShare === null ? '' : ` · ${Math.round(geo.inMarketShare * 100)} % de las pistas apuntan a ${shortCountry(s.region)}`}${geo.setAside ? ` · ${geo.setAside} vídeo${geo.setAside === 1 ? '' : 's'} apartado${geo.setAside === 1 ? '' : 's'} por hablar de otro país` : ''}`, kind: 'inferido' as const }] : []),
    { label: 'Vistas por día (mediana, vídeos relevantes más vistos del último año)', value: topVpd === null ? 'sin datos' : k(Math.round(topVpd)), kind: 'calculado' },
    { label: `Vistas por día (mediana, vídeos relevantes de los últimos ${WINDOW} días con ≥ 3 días)`, value: recentCohort.medianVpd === null ? 'sin datos' : k(Math.round(recentCohort.medianVpd)), kind: 'calculado' },
    { label: `Subidas por semana (${inSpan.length} vídeos relevantes en una ventana de ${Math.round(spanDays)} días${strayAges.size ? `; ${strayAges.size} resultado${strayAges.size === 1 ? '' : 's'} antiguo${strayAges.size === 1 ? '' : 's'} fuera de la ventana` : ''})`, value: String(uploadsPerWeek), kind: 'calculado' },
    { label: 'Canales distintos entre los vídeos recientes', value: `${recentChannels} de ${recent.length}`, kind: 'observado' },
    { label: 'Suscriptores del canal mediano de los más vistos', value: medianSubs === null ? 'sin datos' : k(Math.round(medianSubs)), kind: 'observado' },
    { label: 'Canales de ≥ 100 000 suscriptores en el top 10', value: `${big} de ${top10.length}`, kind: 'observado' },
    { label: 'Reparto de vistas entre canales (HHI 0–10 000 / los 3 mayores)', value: conc.hhi === null ? 'sin datos suficientes' : `${conc.hhi} (${conc.level}) / ${Math.round(conc.top3 * 100)} %`, kind: 'calculado' },
    { label: 'Vídeos de canales pequeños (< 20 000 suscriptores) que superan sus suscriptores', value: small.share === null ? 'pocos canales pequeños en la muestra' : `${small.wins} de ${small.small}`, kind: 'calculado' },
    { label: 'Tipo de demanda', value: profile.kind === 'insuficiente' ? 'sin datos suficientes' : profile.kind, kind: 'inferido' },
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
  reasons.push(`Mercado: ${geo.statement}`)
  reasons.push(`Crecimiento: ${growth.state === 'calculable' ? growth.label : 'No calculable'}. ${growth.reason}`)

  const headline = confidence === 'baja' && verdictRaw === 'oportunidad' ? 'Parece prometedor, pero la muestra relevante es insuficiente para llamarlo oportunidad'
    : verdict === 'oportunidad' ? 'Demanda clara con oferta y competencia manejables'
    : verdict === 'saturado' ? 'Hay demanda, pero la oferta o los canales dominantes lo hacen difícil'
    : verdict === 'sin_demanda' ? 'Poca oferta, pero también poca demanda observable: no es una oportunidad'
    : 'Señales mixtas: investígalo con otro ángulo antes de apostar'

  const niches = [...new Set(both.flatMap(v => nichesOf(v).map(n => n.niche)))]
  const isShortProper = (v: YouTubeVideoResult) => { const f = inferFormat(v); return f.format === 'short' }
  return {
    engineVersion: ENGINE_VERSION,
    topic: s.topic, region: s.region, language: s.language, fetchedAt: s.fetchedAt, units: s.units, recentDays: WINDOW,
    indices: { demand, supply, competition, growth: growthIdx, opportunity }, geo, stats: statistical, growth, growthPct, verdict, headline, reasons, confidence, confidenceNote, evidence, quality,
    byFormat: { short: stats(top, recent, isShortProper), long: stats(top, recent, isLong) }, formatQuality: fq,
    niches, terms: extractTerms(both), emerging: emergingTerms(top, recent), questions: extractQuestions(both),
    sampleSizes: { top: top.length, recent: recent.length }, approxTotals: { top: s.top.approxTotal, recent: s.recent.approxTotal },
    topVideos: top.filter(v => !promo.has(v.videoId)).slice(0, 9), sample,
  }
}

/**
 * Adds the previous window (same length, adjacent, same search and the same relevance rules) to an analysis and calculates growth.
 * Pure: the caller pays for the search and stores the result.
 */
export function applyGrowth(a: TopicAnalysis, previous: Sample, now = Date.now()): TopicAnalysis {
  const q = queryProfile(a.topic), expected = expectedLanguages(a.region, a.language)
  const seen = new Set<string>()
  const strict = !!a.quality?.ambiguousSample
  const relevant = previous.videos.filter(v => { if (seen.has(v.videoId)) return false; seen.add(v.videoId); return assessVideo(v, q, expected, { strict, region: a.region }).relevant })
  const promo = new Set(relevant.filter(v => assessVideo(v, q, expected, { strict, region: a.region }).promo).map(v => v.videoId))
  const prev = cohort(relevant, promo, now)
  const growth = { ...growthFrom(a.growth.recent, { n: prev.n, medianVpd: prev.medianVpd }, a.recentDays), measuredAt: new Date(now).toISOString() }
  const growthIdx = growthIndex(growth)
  const pct = growth.state === 'calculable' && growth.ratio ? Math.round((growth.ratio - 1) * 100) : null
  const reasons = a.reasons.map(r => (r.startsWith('Crecimiento:') ? `Crecimiento: ${growth.state === 'calculable' ? growth.label : 'No calculable'}. ${growth.reason}` : r))
  const evidence = a.evidence.map(e => (e.label.startsWith('Crecimiento') ? { ...e, value: growth.state === 'calculable' ? `${growth.label} (×${growth.ratio!.toFixed(2)})` : 'No calculable' } : e))
  return { ...a, growth, growthPct: pct, ...(a.stats ? { stats: { ...a.stats, sensitivity: sensitivity({ demand: a.indices.demand, competition: a.indices.competition, supply: a.indices.supply, growth: growthIdx }) } } : {}), indices: { ...a.indices, growth: growthIdx, opportunity: opportunityOf(a.indices.demand, a.indices.competition, a.indices.supply, growthIdx) }, reasons, evidence }
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
