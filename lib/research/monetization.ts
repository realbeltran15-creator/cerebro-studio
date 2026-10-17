/**
 * Monetisation reference data. YouTube does NOT publish RPM for other people's channels through any API, so nothing here is a
 * measurement of a competitor. Three kinds of value exist and the UI labels each one:
 *   VERIFICADO  – RPM read from the user's OWN channel through YouTube Analytics with their authorisation (not wired yet: see `VERIFIED_RPM_STATUS`).
 *   ESTIMADO    – a range taken from identified third-party studies, with date, method and a confidence level.
 *   DESCONOCIDO – no evidence: the screen says so and lets the user type their own RPM.
 */

export type RpmStatus = 'verificado' | 'estimado' | 'desconocido'
export type RpmConfidence = 'media' | 'baja' | 'muy baja'

export type RpmSource = { name: string; url: string; accessed: string; method: string }

export const SOURCES = {
  airNiche: { name: 'AIR Media-Tech · RPM por nicho 2026', url: 'https://air.io/en/air-data-findings/which-youtube-niche-makes-the-most-money-in-2026-ranked-by-real-rpm-and-cpm', accessed: '2026-10-13', method: 'Medianas de RPM de 300 canales reales (YouTube Analytics, mayo 2025–mayo 2026). Audiencia mundial mezclada. Citado a través de páginas secundarias: no se pudo abrir el original desde el servidor.' },
  airShorts: { name: 'AIR Media-Tech · Shorts frente a vídeo largo (274 canales)', url: 'https://air.io/en/air-data-findings/youtube-shorts-rpm-vs-long-form-how-much-do-shorts-earn-in-2026', accessed: '2026-10-13', method: 'Datos de YouTube Analytics API de 274 canales; el RPM de Shorts es aproximadamente el 3–14 % del de vídeo largo según el nicho. Citado a través de resúmenes de búsqueda.' },
  blogsFinance: { name: 'Guías de terceros (varias) sobre RPM de finanzas y tecnología', url: 'https://www.youtuberpmcalculator.com/rpm-by-niche', accessed: '2026-10-13', method: 'Rangos orientativos de blogs comerciales, normalmente para audiencia de EE. UU.; sin metodología verificable y con cifras que se contradicen entre sí.' },
  blogsCountry: { name: 'Tablas de terceros de RPM por país (varias)', url: 'https://fluxnote.io/guides/youtube-rpm-by-country', accessed: '2026-10-13', method: 'Rangos de 2–4 páginas comerciales por país. Se usa el punto medio mediano de sus rangos; discrepan mucho entre fuentes.' },
} satisfies Record<string, RpmSource>

export type NicheRpm = { low: number; high: number; /** Median reported by the study, when it reports one. */ median: number | null; confidence: RpmConfidence; sources: RpmSource[]; note: string; inheritedFrom?: string }

/** USD per 1,000 views, long-form, MIXED worldwide audience unless the note says otherwise. */
const NICHE_RPM_BASE: Record<string, NicheRpm> = {
  educacion: { low: 10.22, high: 10.22, median: 10.22, confidence: 'media', sources: [SOURCES.airNiche], note: 'Mediana de «Educación y ciencia» en AIR. El estudio no da rango intercuartílico para este nicho.' },
  entretenimiento: { low: 0.88, high: 5.02, median: 2.43, confidence: 'media', sources: [SOURCES.airNiche], note: 'Mediana y rango P25–P75 de AIR.' },
  musica: { low: 1.35, high: 4.16, median: 2.28, confidence: 'media', sources: [SOURCES.airNiche], note: 'Mediana y rango P25–P75 de AIR.' },
  noticias: { low: 1.79, high: 3.62, median: 2.6, confidence: 'media', sources: [SOURCES.airNiche], note: 'Mediana y rango P25–P75 de AIR.' },
  gaming: { low: 2.05, high: 2.05, median: 2.05, confidence: 'media', sources: [SOURCES.airNiche], note: 'Mediana de AIR; sin rango publicado.' },
  desarrollo: { low: 2.98, high: 2.98, median: 2.98, confidence: 'muy baja', sources: [SOURCES.airNiche], inheritedFrom: 'estilo de vida (AIR)', note: 'Asimilado por nosotros a «Lifestyle» de AIR (2,98). No es una cifra de ese nicho.' },
  finanzas: { low: 2.01, high: 26, median: null, confidence: 'baja', sources: [SOURCES.airNiche, SOURCES.blogsFinance], note: 'AIR da una mediana de 2,01 con muestra pequeña («direccional»); guías de terceros hablan de 15–26 USD con audiencia de EE. UU. La diferencia se explica sobre todo por la audiencia: sin datos propios no hay forma de acotarla.' },
  negocios: { low: 2.01, high: 26, median: null, confidence: 'muy baja', sources: [SOURCES.airNiche, SOURCES.blogsFinance], inheritedFrom: 'negocios y finanzas', note: 'Asimilado a «Business & Finance»: rango muy amplio.' },
  tecnologia: { low: 4, high: 25, median: null, confidence: 'baja', sources: [SOURCES.blogsFinance], note: 'Guías de terceros: 4–12 USD en general y 15–25 USD con audiencia de EE. UU. Sin estudio con metodología abierta.' },
  ia: { low: 4, high: 25, median: null, confidence: 'muy baja', sources: [SOURCES.blogsFinance], inheritedFrom: 'tecnología', note: 'No hay datos propios de IA: se asimila a tecnología.' },
  historia: { low: 10.22, high: 10.22, median: null, confidence: 'muy baja', sources: [SOURCES.airNiche], inheritedFrom: 'educación y ciencia (AIR)', note: 'Asimilado por nosotros a «Educación y ciencia». Los documentales y la historia pueden pagar menos o más: tómalo como techo orientativo.' },
}
// Lifestyle-like niches share AIR's Lifestyle median; it is our mapping, not the study's.
for (const id of ['cocina', 'viajes', 'belleza', 'hogar', 'animales', 'salud', 'fitness']) {
  NICHE_RPM_BASE[id] = { low: 2.98, high: 2.98, median: 2.98, confidence: 'muy baja', sources: [SOURCES.airNiche], inheritedFrom: 'estilo de vida (AIR)', note: 'Asimilado por nosotros a «Lifestyle» de AIR (2,98). No es una cifra medida de este nicho.' }
}
export const NICHE_RPM = NICHE_RPM_BASE

/** Niches with no evidence at all: the reference table says DESCONOCIDO. */
export const UNKNOWN_RPM_NICHES = ['motor', 'misterio', 'idiomas']

export type RpmReading =
  | { status: 'estimado'; low: number; mid: number; high: number; confidence: RpmConfidence; sources: RpmSource[]; note: string; midIsMedian: boolean }
  | { status: 'desconocido'; reason: string }

export function nicheRpm(nicheId: string): RpmReading {
  const r = NICHE_RPM[nicheId]
  if (!r) return { status: 'desconocido', reason: 'No hay datos fiables de RPM para este nicho. Escribe tu propio RPM para comparar escenarios.' }
  const mid = r.median ?? Math.round(((r.low + r.high) / 2) * 100) / 100
  return { status: 'estimado', low: r.low, mid, high: r.high, confidence: r.confidence, sources: r.sources, note: r.note, midIsMedian: r.median !== null }
}

/** Share of the long-form RPM that Shorts earn: AIR reports roughly 3–14 %. */
export const SHORTS_FACTOR = { low: 0.03, high: 0.14, source: SOURCES.airShorts } as const

export function formatAdjusted(r: RpmReading, format: 'long' | 'short'): RpmReading {
  if (r.status !== 'estimado' || format === 'long') return r
  return { ...r, low: round(r.low * SHORTS_FACTOR.low), mid: round(r.mid * ((SHORTS_FACTOR.low + SHORTS_FACTOR.high) / 2)), high: round(r.high * SHORTS_FACTOR.high), confidence: 'muy baja', sources: [...r.sources, SHORTS_FACTOR.source], midIsMedian: false, note: `${r.note} Ajuste de Shorts: ${Math.round(SHORTS_FACTOR.low * 100)}–${Math.round(SHORTS_FACTOR.high * 100)} % del RPM de vídeo largo (AIR).` }
}

const round = (n: number) => Math.round(n * 100) / 100

export type CountryRpm = { code: string; low: number; high: number; mid: number; index: number; sources: RpmSource[] }

/** General-content RPM ranges per country from third-party tables (USD per 1,000 views). `index` = mid ÷ US mid. */
const COUNTRY_RAW: Array<[string, number, number, number]> = [
  ['US', 3, 20, 9.4], ['GB', 3, 16, 7], ['CA', 3, 14, 7.25], ['AU', 4, 13.5, 8.6], ['DE', 2, 10.5, 5.9],
  ['ES', 2.5, 5.5, 3.4], ['JP', 1.1, 6, 3.5], ['BR', 0.8, 2.5, 1.6], ['MX', 0.7, 2, 1.2], ['IN', 0.13, 3, 1.25],
]
export const COUNTRY_RPM: CountryRpm[] = COUNTRY_RAW.map(([code, low, high, mid]) => ({ code, low, high, mid, index: round(mid / 9.4), sources: [SOURCES.blogsCountry] }))
export const countryRpm = (code: string) => COUNTRY_RPM.find(c => c.code === code) ?? null

export type Scenario = { views: number; low: number; mid: number; high: number }
export const SCENARIO_VIEWS = [100_000, 500_000, 1_000_000] as const

/** Income = views ÷ 1,000 × RPM. Pure arithmetic over an RPM range; it says nothing about how many views a channel will get. */
export function revenueScenarios(rpm: { low: number; mid: number; high: number }, views: readonly number[] = SCENARIO_VIEWS): Scenario[] {
  return views.map(v => ({ views: v, low: round((v / 1000) * rpm.low), mid: round((v / 1000) * rpm.mid), high: round((v / 1000) * rpm.high) }))
}

export type RpmFilter = { min: number | null; max: number | null; includeUnknown: boolean }

/** A niche passes when its estimated range OVERLAPS [min, max]. Unknown niches pass only when the user asks for them. */
export function passesRpmFilter(nicheId: string, f: RpmFilter, format: 'long' | 'short' = 'long') {
  if (f.min === null && f.max === null) return true
  const r = formatAdjusted(nicheRpm(nicheId), format)
  if (r.status === 'desconocido') return f.includeUnknown
  return (f.min === null || r.high >= f.min) && (f.max === null || r.low <= f.max)
}

/** Verified RPM would come from YouTube Analytics (estimatedRevenue ÷ views × 1000) with the monetary scope on the user's own channel. */
export const VERIFIED_RPM_STATUS = { available: false, reason: 'Falta la autorización de YouTube Analytics con permiso monetario (yt-analytics-monetary.readonly). Hasta entonces ninguna cifra de esta pantalla es verificada.' } as const

export const RPM_LABEL: Record<RpmStatus, string> = { verificado: 'VERIFICADO', estimado: 'ESTIMADO', desconocido: 'DESCONOCIDO' }
