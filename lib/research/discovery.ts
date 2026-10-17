import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { recurringTerms } from '@/lib/radar'

/**
 * Discovery helpers for the Investigación screen. Everything here is CALCULATED from what the YouTube Data API
 * returned; none of it predicts virality. Pure functions so they can be tested without the network.
 */

export type VideoFormat = 'short' | 'brief' | 'medium' | 'long'

export function formatOf(seconds: number | null): VideoFormat | null {
  if (seconds === null) return null
  if (seconds <= 60) return 'short'
  if (seconds <= 240) return 'brief'
  if (seconds <= 1200) return 'medium'
  return 'long'
}

export type Continent = 'europe' | 'america-n' | 'america-s' | 'asia' | 'africa' | 'oceania'

export const CONTINENTS: Array<[Continent, string]> = [['europe', 'Europa'], ['america-n', 'Norteamérica'], ['america-s', 'Latinoamérica'], ['asia', 'Asia'], ['africa', 'África'], ['oceania', 'Oceanía']]

/** Country → name, continent and its main language (for the "tendencias en otros países" view). */
export const COUNTRIES: Array<{ code: string; name: string; continent: Continent; language: string }> = [
  { code: 'ES', name: 'España', continent: 'europe', language: 'es' }, { code: 'GB', name: 'Reino Unido', continent: 'europe', language: 'en' },
  { code: 'DE', name: 'Alemania', continent: 'europe', language: 'de' }, { code: 'FR', name: 'Francia', continent: 'europe', language: 'fr' },
  { code: 'IT', name: 'Italia', continent: 'europe', language: 'it' }, { code: 'PT', name: 'Portugal', continent: 'europe', language: 'pt' },
  { code: 'NL', name: 'Países Bajos', continent: 'europe', language: 'nl' }, { code: 'PL', name: 'Polonia', continent: 'europe', language: 'pl' },
  { code: 'CH', name: 'Suiza', continent: 'europe', language: 'de' },
  { code: 'US', name: 'Estados Unidos', continent: 'america-n', language: 'en' }, { code: 'CA', name: 'Canadá', continent: 'america-n', language: 'en' },
  { code: 'MX', name: 'México', continent: 'america-s', language: 'es' }, { code: 'AR', name: 'Argentina', continent: 'america-s', language: 'es' },
  { code: 'CO', name: 'Colombia', continent: 'america-s', language: 'es' }, { code: 'CL', name: 'Chile', continent: 'america-s', language: 'es' },
  { code: 'PE', name: 'Perú', continent: 'america-s', language: 'es' }, { code: 'BR', name: 'Brasil', continent: 'america-s', language: 'pt' },
  { code: 'JP', name: 'Japón', continent: 'asia', language: 'ja' }, { code: 'KR', name: 'Corea del Sur', continent: 'asia', language: 'ko' },
  { code: 'IN', name: 'India', continent: 'asia', language: 'hi' }, { code: 'ID', name: 'Indonesia', continent: 'asia', language: 'id' },
  { code: 'TR', name: 'Turquía', continent: 'asia', language: 'tr' },
  { code: 'ZA', name: 'Sudáfrica', continent: 'africa', language: 'en' }, { code: 'NG', name: 'Nigeria', continent: 'africa', language: 'en' }, { code: 'EG', name: 'Egipto', continent: 'africa', language: 'ar' },
  { code: 'AU', name: 'Australia', continent: 'oceania', language: 'en' }, { code: 'NZ', name: 'Nueva Zelanda', continent: 'oceania', language: 'en' },
]

export const LANGUAGES: Array<[string, string]> = [['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['de', 'Alemán'], ['fr', 'Francés'], ['it', 'Italiano'], ['nl', 'Neerlandés'], ['pl', 'Polaco'], ['ja', 'Japonés'], ['ko', 'Coreano'], ['hi', 'Hindi'], ['id', 'Indonesio'], ['tr', 'Turco'], ['ar', 'Árabe']]

export type SortKey = 'api' | 'views' | 'viewsPerDay' | 'ratio' | 'engagement' | 'newest'

export const SORTS: Array<[SortKey, string]> = [['api', 'Orden de YouTube'], ['views', 'Más vistas'], ['viewsPerDay', 'Más vistas por día'], ['ratio', 'Vistas ≫ suscriptores (canal pequeño)'], ['engagement', 'Más interacción'], ['newest', 'Más recientes']]

/** Sorts a copy of the list by one metric (missing values last). Filtering lives in the main filter panel (filters.ts), never here. */
export function sortVideos(results: YouTubeVideoResult[], sort: SortKey): YouTubeVideoResult[] {
  const num = (n: number | null) => n ?? -Infinity
  const key: Partial<Record<SortKey, (v: YouTubeVideoResult) => number>> = {
    views: v => num(v.observed.views), viewsPerDay: v => num(v.calculated.viewsPerDay), ratio: v => num(v.calculated.viewsToSubscribers),
    engagement: v => num(v.calculated.engagementRate), newest: v => (Number.isFinite(Date.parse(v.publishedAt)) ? Date.parse(v.publishedAt) : -Infinity),
  }
  const by = key[sort]
  return by ? [...results].sort((a, b) => by(b) - by(a)) : results
}

/**
 * "Nicho descuidado": a video that did much better than its channel's size suggests, from a small channel.
 * That means people want the topic and the competition is thin. It is a lead to investigate, not a guarantee.
 */
export const NEGLECTED = { maxSubscribers: 20_000, minRatio: 3, minViews: 5_000 } as const

/**
 * Channels whose subscriber count says nothing about the audience behind a video: VEVO and auto-generated "- Topic" channels always;
 * label-like names (Records, Entertainment, Official…) only inside YouTube's Music category, so "Mystery Entertainment" is not excluded.
 */
const ALWAYS_LABEL = /vevo|\s-\s*topic$/i
const MUSIC_LABEL = /\brecords?\b|\brecordings\b|\bmusic group\b|\bentertainment\b|\blabel\b|\bofficial\b/i
export const isLabelChannel = (v: Pick<YouTubeVideoResult, 'channelTitle'> & { categoryId?: string | null }) => ALWAYS_LABEL.test(v.channelTitle) || (v.categoryId === '10' && MUSIC_LABEL.test(v.channelTitle))
/** More than this many views per subscriber means the subscriber figure does not describe the audience (label channel, reupload, external traffic). */
export const MAX_PLAUSIBLE_RATIO = 500

export function isNeglectedNiche(v: YouTubeVideoResult) {
  const subs = v.observed.channelSubscribers, views = v.observed.views, ratio = v.calculated.viewsToSubscribers
  if (v.live === 'live' || v.live === 'upcoming') return false
  if (isLabelChannel(v)) return false
  return subs !== null && views !== null && ratio !== null && subs <= NEGLECTED.maxSubscribers && views >= NEGLECTED.minViews && ratio >= NEGLECTED.minRatio && ratio <= MAX_PLAUSIBLE_RATIO
}

export function neglectedNiches(results: YouTubeVideoResult[]) {
  return results.filter(isNeglectedNiche).sort((a, b) => (b.calculated.viewsToSubscribers ?? 0) - (a.calculated.viewsToSubscribers ?? 0))
}

export type RegionChart = { region: string; videos: YouTubeVideoResult[] }

/** Terms that show up in the trending titles of at least `minRegions` different countries: a worldwide signal. */
export function crossRegionTerms(charts: RegionChart[], minRegions = 2, limit = 15) {
  const perRegion = charts.map(c => ({ region: c.region, terms: new Set(recurringTerms(c.videos.map(v => v.title), 1, 400).map(t => t.term)) }))
  const seen = new Map<string, string[]>()
  for (const r of perRegion) for (const t of r.terms) seen.set(t, [...(seen.get(t) ?? []), r.region])
  return [...seen.entries()].filter(([, regions]) => regions.length >= minRegions)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, limit)
    .map(([term, regions]) => ({ term, regions }))
}

/** Cost, in YouTube Data API quota units, of what each button does (shown before the user spends it). */
export const QUOTA = { trending: 2, search: 102 } as const
