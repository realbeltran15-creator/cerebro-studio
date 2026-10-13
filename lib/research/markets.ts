import { COUNTRIES, LANGUAGES } from './discovery'
import type { ResearchFilters } from './filters'
import type { TopicAnalysis } from './topic-analysis'

/** A market is where a topic is looked at: a country (YouTube regionCode) and/or a language (relevanceLanguage). */
export type Market = { region: string | null; language: string | null; label: string }

export const countryName = (code: string) => COUNTRIES.find(c => c.code === code)?.name ?? code
const languageName = (l: string) => (LANGUAGES.find(([c]) => c === l)?.[1] ?? l).toLowerCase()
export const marketLabel = (region: string | null, language: string | null) => region ? `${countryName(region)}${language ? ` (${languageName(language)})` : ''}` : language ? `Idioma ${languageName(language)}` : 'Mundial'

/**
 * Markets implied by the filters. Countries win (each with the single chosen language, or its main language); with no country the chosen
 * languages are the markets; with neither it is the worldwide default. Choosing markets never runs a query by itself.
 */
export function marketsFromFilters(f: Pick<ResearchFilters, 'countries' | 'languages'>): Market[] {
  if (f.countries.length) {
    return f.countries.map(code => {
      const language = f.languages.length === 1 ? f.languages[0] : COUNTRIES.find(c => c.code === code)?.language ?? null
      return { region: code, language, label: marketLabel(code, language) }
    })
  }
  if (f.languages.length) return f.languages.map(l => ({ region: null, language: l, label: marketLabel(null, l) }))
  return [{ region: null, language: null, label: marketLabel(null, null) }]
}

/** Same topic, market and recent-window = same analysis (and the same cache entry). */
export const analysisKey = (topic: string, region: string | null, language: string | null, recentDays = 30) => [topic.trim().toLowerCase().replace(/\s+/g, ' '), region ?? '', language ?? '', String(recentDays)].join('|')
export const keyOf = (a: Pick<TopicAnalysis, 'topic' | 'region' | 'language'> & { recentDays?: number }) => analysisKey(a.topic, a.region, a.language, a.recentDays ?? 30)
/** The "recent" window implied by the Period filter. */
export const recentDaysFrom = (periodDays: number | null) => (periodDays === null ? 30 : Math.min(Math.max(periodDays, 7), 365))
