import type { ChannelAnalysis, YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { COUNTRY_RPM, SHORTS_FACTOR, formatAdjusted, nicheRpm, type RpmConfidence, type RpmSource } from './monetization'
import { inferFormat, nichesOf } from './taxonomy'
import type { TopicAnalysis } from './topic-analysis'

/**
 * Practical income estimator. It answers ONE question: «what advertising income could videos with this many public views plausibly earn?»
 *
 *   income = views ÷ 1 000 × RPM        (RPM = what a creator earns per 1 000 views, ads only)
 *
 * What is OBSERVED (public, from the YouTube Data API): views, publication dates, subscribers, the channel's total views.
 * What is ESTIMATED: the RPM range (sector studies by niche, adjusted by format and, optionally, by the market's relative ad prices).
 * What is UNKNOWN and never invented: the real RPM of any channel, the audience's countries, how many views are monetised, sponsorships,
 * affiliate sales, memberships, merchandise and anything else a channel earns outside ads. The result is therefore an ADVERTISING range
 * with a stated confidence — never «what the channel earns».
 */
export type Range = { low: number; mid: number; high: number }
export type RevenueKind = 'ingresos publicitarios estimados'

export type RevenueEstimate =
  | {
      status: 'estimado'; kind: RevenueKind
      views: number
      range: Range
      /** The RPM range used, after the format and market adjustments. */
      rpm: Range
      niche: string; format: 'long' | 'short'
      /** Relative ad prices of the requested market (1 = reference average of the table), or null when no adjustment was applied. */
      marketFactor: number | null
      confidence: RpmConfidence
      /** The formula with this case's numbers filled in. */
      formula: string
      assumptions: string[]
      sources: RpmSource[]
    }
  | { status: 'desconocido'; reason: string }

const round = (n: number) => Math.round(n * 100) / 100
const order: RpmConfidence[] = ['media', 'baja', 'muy baja']
const worse = (c: RpmConfidence): RpmConfidence => order[Math.min(order.indexOf(c) + 1, order.length - 1)]
const usd = (n: number) => `$${n.toLocaleString('es-ES', { maximumFractionDigits: n < 100 ? 2 : 0 })}`
const num = (n: number) => n.toLocaleString('es-ES')

/** Mean of the relative ad prices in the reference table: the point where a market has no adjustment. */
const MEAN_INDEX = COUNTRY_RPM.reduce((t, c) => t + c.index, 0) / COUNTRY_RPM.length
/** Relative ad price of a market against the table's mean, bounded so one noisy source cannot swing the range wildly. */
export const marketFactor = (region: string | null): number | null => {
  const c = region ? COUNTRY_RPM.find(x => x.code === region) : null
  return c ? round(Math.min(Math.max(c.index / MEAN_INDEX, 0.4), 2)) : null
}

export type EstimateInput = {
  views: number | null; niches: string[]; format: 'long' | 'short'
  /** The market the research was ORIENTED to. It is NOT the audience: it only adjusts the ad-price assumption, and the result says so. */
  region?: string | null
  /** The person's own RPM (e.g. read from their YouTube Studio): replaces the sector range. */
  ownRpm?: Range | null
}

export function estimateRevenue(input: EstimateInput): RevenueEstimate {
  const { views, format, region = null } = input
  if (views === null || !Number.isFinite(views) || views < 0) return { status: 'desconocido', reason: 'No hay una cifra pública de visualizaciones.' }
  let base: { range: Range; confidence: RpmConfidence; niche: string; sources: RpmSource[]; note: string } | null = null
  if (input.ownRpm) base = { range: input.ownRpm, confidence: 'media', niche: 'RPM propio', sources: [], note: 'RPM indicado por ti.' }
  else for (const n of input.niches) {
    const r = formatAdjusted(nicheRpm(n), format)
    if (r.status === 'estimado') { base = { range: { low: r.low, mid: r.mid, high: r.high }, confidence: r.confidence, niche: n, sources: r.sources, note: r.note }; break }
  }
  if (!base) return { status: 'desconocido', reason: 'No hay estudios fiables de RPM para el nicho de este contenido. Escribe tu propio RPM para calcular escenarios.' }
  const mf = input.ownRpm ? null : marketFactor(region)
  const rpm: Range = mf ? { low: round(base.range.low * mf), mid: round(base.range.mid * mf), high: round(base.range.high * mf) } : base.range
  const k = views / 1000
  const range: Range = { low: round(k * rpm.low), mid: round(k * rpm.mid), high: round(k * rpm.high) }
  const assumptions = [
    input.ownRpm ? `RPM propio: ${usd(rpm.low)}–${usd(rpm.high)} por 1000 visitas (dato tuyo, no verificado por esta aplicación).` : `RPM del nicho «${base.niche}»: ${usd(base.range.low)}–${usd(base.range.high)} por 1000 visitas (${base.note})`,
    ...(format === 'short' && !input.ownRpm ? [`Es un Short: se aplica ${Math.round(SHORTS_FACTOR.low * 100)}–${Math.round(SHORTS_FACTOR.high * 100)} % del RPM de un vídeo largo (estudio de terceros).`] : []),
    ...(mf ? [`Ajuste por mercado: ${region} paga ${mf > 1 ? 'más' : 'menos'} publicidad que la media de la tabla de países (×${mf}). Se aplica porque la investigación está orientada a ese mercado; el público real no se conoce.`] : input.ownRpm ? [] : ['Sin ajuste por país: el RPM de los estudios es de audiencia mixta o de EE. UU. según el nicho.']),
    'Solo publicidad. No incluye patrocinios, afiliados, membresías, mercancía ni otros ingresos privados del canal.',
    'No todas las visualizaciones se monetizan igual (anunciantes, edad del público, contenido); el RPM de los estudios ya es un promedio por 1000 visualizaciones totales.',
  ]
  const confidence = mf && !input.ownRpm ? worse(base.confidence) : base.confidence
  return { status: 'estimado', kind: 'ingresos publicitarios estimados', views, range, rpm, niche: base.niche, format, marketFactor: mf, confidence,
    formula: `${num(views)} visualizaciones ÷ 1 000 × RPM (${usd(rpm.low)} – ${usd(rpm.mid)} – ${usd(rpm.high)}) = ${usd(range.low)} – ${usd(range.mid)} – ${usd(range.high)}`, assumptions, sources: base.sources }
}

// ---------- A single video ----------
export function videoRevenue(v: YouTubeVideoResult, region: string | null = null): RevenueEstimate {
  const fmt = inferFormat(v).format === 'short' ? 'short' : 'long'
  return estimateRevenue({ views: v.observed.views, niches: nichesOf(v).map(n => n.niche), format: fmt, region })
}

// ---------- A niche (from an analysis) ----------
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
export type NicheRevenue = {
  /** A typical recent video: median views of the relevant videos published 7–60 days ago. */
  typical: { videos: number; views: number; estimate: RevenueEstimate } | null
  /** A video that works well: median views of the relevant most-viewed videos of the year. */
  strong: { videos: number; views: number; estimate: RevenueEstimate } | null
  /** Videos per month × typical views: what a channel could earn IF each video got what is typical today (a new channel usually gets less). */
  monthly: Array<{ videosPerMonth: number; estimate: RevenueEstimate }>
  notes: string[]
}

export function nicheRevenue(a: TopicAnalysis, now = Date.now()): NicheRevenue {
  const ok = (a.sample ?? []).filter(v => v.status === 'aceptado' && v.views !== null)
  const age = (iso: string) => (now - Date.parse(iso)) / 86400000
  const recent = ok.filter(v => v.inRecent && age(v.publishedAt) >= 7 && age(v.publishedAt) <= 60).map(v => v.views as number)
  const top = ok.filter(v => v.inTop).map(v => v.views as number)
  const long = a.niches.length ? a.niches : []
  const share = (xs: typeof ok) => (xs.length ? xs.filter(v => v.format === 'short').length / xs.length : 0)
  const fmt: 'long' | 'short' = share(ok) > 0.5 ? 'short' : 'long'
  const est = (views: number | null) => estimateRevenue({ views, niches: long, format: fmt, region: a.region })
  const tv = median(recent), sv = median(top)
  const typical = tv === null || recent.length < 3 ? null : { videos: recent.length, views: Math.round(tv), estimate: est(Math.round(tv)) }
  const strong = sv === null || top.length < 5 ? null : { videos: top.length, views: Math.round(sv), estimate: est(Math.round(sv)) }
  const monthly = typical && typical.estimate.status === 'estimado' ? [4, 8, 12].map(n => ({ videosPerMonth: n, estimate: est(typical.views * n) })) : []
  const notes = [
    typical ? `Vídeo típico: mediana de ${typical.videos} vídeos relevantes de hace 7–60 días (sus vistas siguen creciendo).` : 'No hay suficientes vídeos recientes relevantes (mínimo 3) para estimar un vídeo típico.',
    strong ? `Vídeo que funciona: mediana de ${strong.videos} de los más vistos del último año.` : 'No hay suficientes vídeos relevantes del último año (mínimo 5).',
    'Un canal nuevo suele conseguir menos que lo típico del nicho; un canal con audiencia, más. Las cifras mensuales suponen que cada vídeo consigue lo típico.',
    ...(fmt === 'short' ? ['La mayoría de los vídeos de la muestra son Shorts: se usa el RPM reducido de Shorts.'] : []),
  ]
  return { typical, strong, monthly, notes }
}

// ---------- A channel ----------
export type ChannelRevenue = {
  /** Lifetime ads income implied by the channel's public total views. */
  lifetime: RevenueEstimate
  /** Ads income implied by the views of the videos published in the last 30 days (their views so far). */
  last30: { videos: number; views: number; estimate: RevenueEstimate } | null
  notes: string[]
}

export function channelRevenue(c: ChannelAnalysis, now = Date.now()): ChannelRevenue {
  const niches = [...new Set(c.videos.flatMap(v => nichesOf(v).map(n => n.niche)))]
  const shorts = c.videos.length ? c.videos.filter(v => inferFormat(v).format === 'short').length / c.videos.length : 0
  const fmt: 'long' | 'short' = shorts > 0.5 ? 'short' : 'long'
  // The channel's own declared country is NOT its audience: no market adjustment is applied to a channel.
  const lifetime = estimateRevenue({ views: c.observed.totalViews, niches, format: fmt, region: null })
  const recent = c.videos.filter(v => (now - Date.parse(v.publishedAt)) / 86400000 <= 30 && v.observed.views !== null)
  const views = recent.reduce((t, v) => t + (v.observed.views ?? 0), 0)
  const last30 = recent.length ? { videos: recent.length, views, estimate: estimateRevenue({ views, niches, format: fmt, region: null }) } : null
  return { lifetime, last30, notes: [
    'La cifra de vida usa las visualizaciones totales públicas del canal con un RPM de sector: el canal real pudo cobrar más o menos, y parte de esas vistas pudo no estar monetizada.',
    'Lo de los últimos 30 días suma las visualizaciones acumuladas hasta hoy de los vídeos publicados en esa ventana; no incluye lo que ganan hoy los vídeos antiguos (YouTube no da visualizaciones por periodo de canales ajenos).',
    `El nicho se deduce de los títulos y etiquetas de los últimos vídeos${niches.length ? ` (${niches.slice(0, 3).join(', ')})` : ' (no se pudo deducir)'}.`,
  ] }
}
