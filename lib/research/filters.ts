import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { contentTypesOf, inferFormat, nichesOf } from './taxonomy'
import { formatAdjusted, nicheRpm, passesRpmFilter, type RpmFilter } from './monetization'
import { formatCovered, type TopicAnalysis } from './topic-analysis'

/**
 * Combinable multi-select filters for Investigación. Selecting values never runs a query by itself: queries are planned
 * (planFetch) and the user confirms the cost first.
 */

export type Logic = 'any' | 'all'
export type GroupId = 'countries' | 'languages' | 'niches' | 'formats' | 'contentTypes'

/** Performance, channel, duration, text and money filters. Every field null/empty = not applied. */
export type MetricFilters = {
  minViews: number | null; maxViews: number | null; minViewsPerDay: number | null; minLikes: number | null; minComments: number | null
  /** (likes + comments) ÷ views, in percent. */
  minEngagement: number | null
  minSubscribers: number | null; maxSubscribers: number | null
  /** views ÷ subscribers of the channel. */
  minRatio: number | null
  minDurationMin: number | null; maxDurationMin: number | null
  /** Estimated income of the video (views ÷ 1000 × the niche's ESTIMATED RPM), in USD. */
  minEstRevenue: number | null; maxEstRevenue: number | null
  /** Words the title/tags must contain / must not contain (comma separated). */
  include: string; exclude: string
  /** YouTube category ids. */
  categories: string[]
}
export const NO_METRICS: MetricFilters = { minViews: null, maxViews: null, minViewsPerDay: null, minLikes: null, minComments: null, minEngagement: null, minSubscribers: null, maxSubscribers: null, minRatio: null, minDurationMin: null, maxDurationMin: null, minEstRevenue: null, maxEstRevenue: null, include: '', exclude: '', categories: [] }

/** YouTube's fixed list of assignable video categories (ids are stable). */
export const YT_CATEGORIES: Array<[string, string]> = [['1', 'Cine y animación'], ['2', 'Coches y vehículos'], ['10', 'Música'], ['15', 'Mascotas y animales'], ['17', 'Deportes'], ['19', 'Viajes y eventos'], ['20', 'Videojuegos'], ['22', 'Gente y blogs'], ['23', 'Comedia'], ['24', 'Entretenimiento'], ['25', 'Noticias y política'], ['26', 'Cómo hacer y estilo'], ['27', 'Educación'], ['28', 'Ciencia y tecnología'], ['29', 'ONG y activismo']]

/** Filters on the RESULT of an analysis (0–100 indices from the sample), not on single videos. Null/empty = not applied. */
export type AnalysisFilters = { minDemand: number | null; maxSupply: number | null; maxCompetition: number | null; minGrowth: number | null; minOpportunity: number | null; verdicts: string[]; minConfidence: 'baja' | 'media' | null }
export const NO_ANALYSIS: AnalysisFilters = { minDemand: null, maxSupply: null, maxCompetition: null, minGrowth: null, minOpportunity: null, verdicts: [], minConfidence: null }
export const VERDICT_OPTIONS: Array<[string, string]> = [['oportunidad', 'Nicho desatendido con demanda'], ['mixto', 'Señales mixtas / emergente'], ['saturado', 'Popular y saturado'], ['sin_demanda', 'Poca oferta pero poca demanda']]

export type ResearchFilters = {
  countries: string[]; languages: string[]; niches: string[]; formats: string[]; contentTypes: string[]
  /** YouTube reports a language for only a minority of videos. true (default): a video with no declared language is kept by the language filter; false: only videos that declare a chosen language. */
  includeUndeclaredLanguage: boolean
  analysis: AnalysisFilters
  metrics: MetricFilters
  /** Only content published in the last N days (null = no limit). */
  periodDays: number | null
  rpm: RpmFilter
  logic: Record<GroupId, Logic>
}

export const EMPTY_FILTERS: ResearchFilters = {
  countries: [], languages: [], niches: [], formats: [], contentTypes: [], includeUndeclaredLanguage: true, analysis: NO_ANALYSIS, metrics: NO_METRICS, periodDays: null,
  rpm: { min: null, max: null, includeUnknown: false },
  logic: { countries: 'any', languages: 'any', niches: 'any', formats: 'any', contentTypes: 'any' },
}

/** What "All (AND)" can mean for each group. Single-valued attributes cannot be combined with AND on one video. */
export const GROUP_SEMANTICS: Record<GroupId, { label: string; allMeaning: 'video' | 'topic'; explanation: string }> = {
  countries: { label: 'Países', allMeaning: 'topic', explanation: 'Todos: el mismo vídeo o tema debe aparecer a la vez en las listas de todos los países elegidos. Cualquiera: aparece al menos en uno. El país es donde YouTube lo muestra en tendencias, no de dónde son los espectadores.' },
  languages: { label: 'Idiomas', allMeaning: 'topic', explanation: 'Un vídeo tiene un solo idioma declarado, así que «Todos» no puede aplicarse a un vídeo suelto: significa que el tema o la palabra clave debe aparecer en todos los idiomas elegidos (comparador). En listas de vídeos se usa «Cualquiera».' },
  niches: { label: 'Nichos', allMeaning: 'video', explanation: 'Un vídeo puede pertenecer a varios nichos a la vez (p. ej. tecnología e inteligencia artificial). Todos: debe encajar en todos los elegidos. Cualquiera: en alguno.' },
  formats: { label: 'Formatos', allMeaning: 'topic', explanation: 'Un vídeo tiene un solo formato. «Todos» solo tiene sentido para temas: que el tema tenga presencia en todos los formatos elegidos. En listas de vídeos se usa «Cualquiera».' },
  contentTypes: { label: 'Tipos de contenido', allMeaning: 'video', explanation: 'Un vídeo puede ser a la vez tutorial y educativo, por ejemplo. Todos: debe cumplir todos los tipos elegidos. Cualquiera: alguno.' },
}

/** The logic actually applied to a single video, and whether it had to be softened (shown in the UI). */
export function effectiveLogic(group: GroupId, requested: Logic, target: 'video' | 'topic'): { logic: Logic; softened: boolean } {
  if (requested === 'any') return { logic: 'any', softened: false }
  const needsTopic = GROUP_SEMANTICS[group].allMeaning === 'topic'
  return needsTopic && target === 'video' && group !== 'countries' ? { logic: 'any', softened: true } : { logic: 'all', softened: false }
}

export type RevenueEstimate = { status: 'estimado'; low: number; mid: number; high: number; niche: string } | { status: 'desconocido' }

/**
 * ESTIMATED income of one video: views ÷ 1000 × the ESTIMATED RPM of its first niche that has reference data. It is arithmetic over a
 * third-party range, not what the channel earned.
 */
export function estimateRevenue(v: YouTubeVideoResult): RevenueEstimate {
  const views = v.observed.views
  if (views === null) return { status: 'desconocido' }
  const fmt = inferFormat(v).format === 'short' ? 'short' : 'long'
  for (const n of nichesOf(v)) {
    const r = formatAdjusted(nicheRpm(n.niche), fmt)
    if (r.status === 'estimado') { const k = views / 1000; return { status: 'estimado', low: Math.round(k * r.low * 100) / 100, mid: Math.round(k * r.mid * 100) / 100, high: Math.round(k * r.high * 100) / 100, niche: n.niche } }
  }
  return { status: 'desconocido' }
}

const words = (s: string) => s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 10)
const inRange = (n: number | null, min: number | null, max: number | null) => (min === null && max === null) || (n !== null && (min === null || n >= min) && (max === null || n <= max))

function metricsMatch(v: SeenVideo, m: MetricFilters, includeUnknownMoney: boolean): boolean {
  const o = v.observed, c = v.calculated
  if (!inRange(o.views, m.minViews, m.maxViews)) return false
  if (m.minViewsPerDay !== null && (c.viewsPerDay ?? -1) < m.minViewsPerDay) return false
  if (m.minLikes !== null && (o.likes ?? -1) < m.minLikes) return false
  if (m.minComments !== null && (o.comments ?? -1) < m.minComments) return false
  if (m.minEngagement !== null && (c.engagementRate ?? -1) < m.minEngagement) return false
  if (!inRange(o.channelSubscribers, m.minSubscribers, m.maxSubscribers)) return false
  if (m.minRatio !== null && (c.viewsToSubscribers ?? -1) < m.minRatio) return false
  const minutes = o.durationSeconds === null ? null : o.durationSeconds / 60
  if (!inRange(minutes, m.minDurationMin, m.maxDurationMin)) return false
  if (m.categories.length && !(v.categoryId && m.categories.includes(v.categoryId))) return false
  const text = `${v.title} ${(v.tags ?? []).join(' ')}`.toLowerCase()
  const inc = words(m.include), exc = words(m.exclude)
  if (inc.length && !inc.every(w => text.includes(w))) return false
  if (exc.some(w => text.includes(w))) return false
  if (m.minEstRevenue !== null || m.maxEstRevenue !== null) {
    const e = estimateRevenue(v)
    if (e.status === 'desconocido') return includeUnknownMoney
    if ((m.minEstRevenue !== null && e.mid < m.minEstRevenue) || (m.maxEstRevenue !== null && e.mid > m.maxEstRevenue)) return false
  }
  return true
}

const hit = (selected: string[], values: string[], logic: Logic) => selected.length === 0 || (logic === 'all' ? selected.every(s => values.includes(s)) : selected.some(s => values.includes(s)))

/** A video plus every country chart it was seen in. Merging the same video across countries is what makes "all countries" meaningful. */
export type SeenVideo = YouTubeVideoResult & { regions: string[] }

export function mergeRegions(charts: Array<{ region: string; videos: YouTubeVideoResult[] }>): SeenVideo[] {
  const map = new Map<string, SeenVideo>()
  for (const c of charts) for (const v of c.videos) { const e = map.get(v.videoId); if (e) { if (!e.regions.includes(c.region)) e.regions.push(c.region) } else map.set(v.videoId, { ...v, regions: [c.region] }) }
  return [...map.values()]
}

export function videoMatches(v: SeenVideo, f: ResearchFilters, now = Date.now()): boolean {
  const L = (g: GroupId) => effectiveLogic(g, f.logic[g], 'video').logic
  if (!hit(f.countries, v.regions, L('countries'))) return false
  if (f.languages.length && !(v.declaredLanguage ? f.languages.includes(v.declaredLanguage) : f.includeUndeclaredLanguage)) return false
  if (f.formats.length && !f.formats.includes(inferFormat(v).format)) return false
  const niches = nichesOf(v).map(n => n.niche)
  if (!hit(f.niches, niches, L('niches'))) return false
  const types = contentTypesOf(v).map(t => t.id)
  if (!hit(f.contentTypes, types, L('contentTypes'))) return false
  if (!metricsMatch(v, f.metrics, f.rpm.includeUnknown)) return false
  if (f.periodDays !== null) { const t = Date.parse(v.publishedAt); if (!Number.isFinite(t) || now - t > f.periodDays * 86400000) return false }
  if (f.rpm.min !== null || f.rpm.max !== null) {
    const fmt = inferFormat(v).format === 'short' ? 'short' : 'long'
    const ok = niches.length === 0 ? f.rpm.includeUnknown : (f.logic.niches === 'all' ? niches.every(n => passesRpmFilter(n, f.rpm, fmt)) : niches.some(n => passesRpmFilter(n, f.rpm, fmt)))
    if (!ok) return false
  }
  return true
}

export const filterVideos = (videos: SeenVideo[], f: ResearchFilters, now = Date.now()) => videos.filter(v => videoMatches(v, f, now))

export function activeCount(f: ResearchFilters) {
  const m = f.metrics
  const metricsActive = [m.minViews, m.maxViews, m.minViewsPerDay, m.minLikes, m.minComments, m.minEngagement, m.minSubscribers, m.maxSubscribers, m.minRatio, m.minDurationMin, m.maxDurationMin, m.minEstRevenue, m.maxEstRevenue].filter(x => x !== null).length + (m.include.trim() ? 1 : 0) + (m.exclude.trim() ? 1 : 0) + (m.categories.length ? 1 : 0)
  return analysisActive(f.analysis) + metricsActive + f.countries.length + f.languages.length + f.niches.length + f.formats.length + f.contentTypes.length + (f.periodDays !== null ? 1 : 0) + (f.rpm.min !== null || f.rpm.max !== null ? 1 : 0)
}

// ---------- Cost planning ----------
export const UNITS = { trending: 2, categories: 1, topic: 204, search: 102, channel: 4 } as const
/** Above this many units in one go the user must confirm. */
export const CONFIRM_ABOVE = 400
/** Hard stop for one batch, whatever the user confirms. */
export const MAX_BATCH_UNITS = 3000
/** Default daily budget for Investigación (YouTube gives 10,000 units a day to the whole project). */
export const DEFAULT_DAILY_CAP = 6000

export type Plan = { units: number; fresh: number; cached: number; level: 'free' | 'ok' | 'confirm' | 'blocked'; message: string }

export function planTopicBatch(opts: { topics: number; regions: number; cachedCombos: number; remainingToday: number }): Plan {
  const combos = Math.max(opts.topics, 0) * Math.max(opts.regions, 1)
  const cached = Math.min(opts.cachedCombos, combos), fresh = combos - cached
  const units = fresh * UNITS.topic
  if (fresh === 0) return { units: 0, fresh, cached, level: 'free', message: combos === 0 ? 'Elige al menos un tema.' : 'Todo está en caché: no gasta cuota.' }
  const base = `${fresh} consulta${fresh === 1 ? '' : 's'} nueva${fresh === 1 ? '' : 's'} × ${UNITS.topic} = ${units} unidades${cached ? ` (${cached} en caché, gratis)` : ''}.`
  if (units > MAX_BATCH_UNITS) return { units, fresh, cached, level: 'blocked', message: `${base} Es demasiado para una sola vez (máximo ${MAX_BATCH_UNITS}). Reduce países o temas.` }
  if (units > opts.remainingToday) return { units, fresh, cached, level: 'blocked', message: `${base} Te quedan ${Math.max(opts.remainingToday, 0)} unidades del presupuesto de hoy.` }
  if (units > CONFIRM_ABOVE) return { units, fresh, cached, level: 'confirm', message: `${base} Es bastante cuota: confirma para continuar.` }
  return { units, fresh, cached, level: 'ok', message: base }
}

// ---------- Saved combinations ----------
export type Preset = { id: string; name: string; filters: ResearchFilters; savedAt: string }
const KEY = 'cerebro.research.presets'
const strs = (v: unknown, max = 40) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(0, max) : []
const optNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
const lg = (v: unknown): Logic => (v === 'all' ? 'all' : 'any')

const index100 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null)
export function sanitizeAnalysis(raw: unknown): AnalysisFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const allowed = new Set(VERDICT_OPTIONS.map(([k]) => k))
  return { minDemand: index100(r.minDemand), maxSupply: index100(r.maxSupply), maxCompetition: index100(r.maxCompetition), minGrowth: index100(r.minGrowth), minOpportunity: index100(r.minOpportunity),
    verdicts: strs(r.verdicts).filter(v => allowed.has(v)), minConfidence: r.minConfidence === 'baja' || r.minConfidence === 'media' ? r.minConfidence : null }
}
export const analysisActive = (a: AnalysisFilters) => [a.minDemand, a.maxSupply, a.maxCompetition, a.minGrowth, a.minOpportunity, a.minConfidence].filter(x => x !== null).length + (a.verdicts.length ? 1 : 0)

export function sanitizeMetrics(raw: unknown): MetricFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const txt = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '')
  return {
    minViews: optNum(r.minViews), maxViews: optNum(r.maxViews), minViewsPerDay: optNum(r.minViewsPerDay), minLikes: optNum(r.minLikes), minComments: optNum(r.minComments), minEngagement: optNum(r.minEngagement),
    minSubscribers: optNum(r.minSubscribers), maxSubscribers: optNum(r.maxSubscribers), minRatio: optNum(r.minRatio), minDurationMin: optNum(r.minDurationMin), maxDurationMin: optNum(r.maxDurationMin),
    minEstRevenue: optNum(r.minEstRevenue), maxEstRevenue: optNum(r.maxEstRevenue), include: txt(r.include), exclude: txt(r.exclude), categories: strs(r.categories),
  }
}

/** Accepts anything read from storage and returns valid filters, so a corrupt entry can never break the screen. */
export function sanitizeFilters(raw: unknown): ResearchFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rpm = (r.rpm && typeof r.rpm === 'object' ? r.rpm : {}) as Record<string, unknown>
  const logic = (r.logic && typeof r.logic === 'object' ? r.logic : {}) as Record<string, unknown>
  return {
    countries: strs(r.countries), languages: strs(r.languages), niches: strs(r.niches), formats: strs(r.formats), contentTypes: strs(r.contentTypes), includeUndeclaredLanguage: r.includeUndeclaredLanguage !== false, metrics: sanitizeMetrics(r.metrics), analysis: sanitizeAnalysis(r.analysis),
    periodDays: optNum(r.periodDays), rpm: { min: optNum(rpm.min), max: optNum(rpm.max), includeUnknown: rpm.includeUnknown === true },
    logic: { countries: lg(logic.countries), languages: lg(logic.languages), niches: lg(logic.niches), formats: lg(logic.formats), contentTypes: lg(logic.contentTypes) },
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem'>
export function loadPresets(store: Store | null): Preset[] {
  try {
    const raw = store?.getItem(KEY); if (!raw) return []
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? list.flatMap(p => p && typeof p.id === 'string' && typeof p.name === 'string' ? [{ id: p.id, name: p.name.slice(0, 60), filters: sanitizeFilters(p.filters), savedAt: String(p.savedAt ?? '') }] : []).slice(0, 30) : []
  } catch { return [] }
}
export function savePresets(store: Store | null, list: Preset[]) { try { store?.setItem(KEY, JSON.stringify(list.slice(0, 30))) } catch { /* private mode */ } }
export function addPreset(list: Preset[], name: string, filters: ResearchFilters, now = new Date(), id = `p${now.getTime()}`): Preset[] {
  const clean = name.trim().slice(0, 60); if (!clean) return list
  return [{ id, name: clean, filters: sanitizeFilters(filters), savedAt: now.toISOString() }, ...list.filter(p => p.name !== clean)].slice(0, 30)
}

// ---------- Which filters each section uses ----------
export type FilterPart = 'countries' | 'languages' | 'niches' | 'formats' | 'contentTypes' | 'period' | 'rpm' | 'advanced' | 'analysis'
export type TabId = 'discover' | 'niches' | 'keywords' | 'international' | 'competition' | 'money' | 'saved'

/** Filters that actually change the results of each section. Hiding the rest avoids controls that look useful but do nothing. */
export const TAB_FILTERS: Record<TabId, FilterPart[]> = {
  discover: ['countries', 'languages', 'niches', 'formats', 'contentTypes', 'period', 'rpm', 'advanced', 'analysis'],
  niches: ['countries', 'languages', 'niches', 'formats', 'period', 'rpm', 'analysis'],
  keywords: ['countries', 'languages', 'niches', 'period', 'analysis'],
  international: ['countries', 'languages', 'niches', 'formats', 'contentTypes', 'period', 'rpm', 'advanced'],
  competition: ['countries', 'languages', 'formats', 'period'],
  money: ['countries', 'niches', 'formats', 'rpm'],
  saved: [],
}

/** What each section does with the filters, in one sentence, shown above the results. */
export const TAB_SCOPE: Record<TabId, string> = {
  discover: 'Las recomendaciones se construyen con las listas de populares de los países elegidos y con los análisis que ya hayas hecho; los filtros se aplican a ambos.',
  niches: 'Los países e idiomas definen en qué mercados se analiza cada tema (cada mercado cuesta una consulta). Nichos, RPM y los umbrales de demanda, oferta, competencia y crecimiento filtran los análisis ya hechos; el formato destaca la evidencia de ese formato y oculta los análisis sin muestra de él; el periodo fija la ventana de «recientes». Aquí mismo se comparan en tarjetas, tabla o gráfico.',
  keywords: 'Los países e idiomas definen los mercados; el periodo fija la ventana de «recientes». Las frases salen de los vídeos de la muestra.',
  international: 'Compara las listas oficiales de populares de los países elegidos (2 unidades por país) y analiza un mismo tema en cada mercado.',
  competition: 'La búsqueda se hace en cada mercado elegido (102 unidades por mercado); formato y periodo se aplican a la consulta.',
  money: 'Filtra la tabla de referencia por nicho, formato y RPM estimado. Los países sirven para consultar el rango de referencia de cada uno.',
  saved: 'Aquí no se aplican filtros: son tus combinaciones y oportunidades guardadas.',
}

// ---------- Validation ----------
const PAIRS: Array<[keyof MetricFilters, keyof MetricFilters, string]> = [
  ['minViews', 'maxViews', 'visualizaciones'], ['minSubscribers', 'maxSubscribers', 'suscriptores'], ['minDurationMin', 'maxDurationMin', 'duración'], ['minEstRevenue', 'maxEstRevenue', 'ingreso estimado'],
]

/** Problems that make a combination impossible, in plain words. Apply is blocked while any exist. */
export function validateFilters(f: ResearchFilters): string[] {
  const out: string[] = []
  if (f.rpm.min !== null && f.rpm.max !== null && f.rpm.min > f.rpm.max) out.push(`RPM: el mínimo (${f.rpm.min}) es mayor que el máximo (${f.rpm.max}).`)
  for (const [a, b, name] of PAIRS) { const x = f.metrics[a], y = f.metrics[b]; if (typeof x === 'number' && typeof y === 'number' && x > y) out.push(`${name[0].toUpperCase()}${name.slice(1)}: el mínimo (${x}) es mayor que el máximo (${y}).`) }
  if (f.countries.length > MAX_COUNTRIES) out.push(`Países: el máximo son ${MAX_COUNTRIES} a la vez.`)
  for (const [k, name] of [['minDemand', 'Demanda'], ['maxSupply', 'Oferta'], ['maxCompetition', 'Competencia'], ['minGrowth', 'Crecimiento'], ['minOpportunity', 'Oportunidad']] as const) { const v = f.analysis[k]; if (typeof v === 'number' && (v < 0 || v > 100)) out.push(`${name}: el valor tiene que estar entre 0 y 100 (es una escala de 0 a 100).`) }
  return out
}
export const MAX_COUNTRIES = 8

export const sameFilters = (a: ResearchFilters, b: ResearchFilters) => JSON.stringify(sanitizeFilters(a)) === JSON.stringify(sanitizeFilters(b))

// ---------- Active filters as removable chips ----------
export type ActiveChip = { id: string; group: string; label: string; remove: (f: ResearchFilters) => ResearchFilters }

export function describeActive(f: ResearchFilters, names: { country: (c: string) => string; niche: (n: string) => string; language: (l: string) => string; format: (x: string) => string; contentType: (x: string) => string; category: (x: string) => string }): ActiveChip[] {
  const chips: ActiveChip[] = []
  const list = (key: 'countries' | 'languages' | 'niches' | 'formats' | 'contentTypes', group: string, name: (v: string) => string) => {
    for (const v of f[key]) chips.push({ id: `${key}:${v}`, group, label: name(v), remove: g => ({ ...g, [key]: g[key].filter(x => x !== v) }) })
  }
  list('countries', 'País', names.country); list('languages', 'Idioma', names.language); list('niches', 'Nicho', names.niche); list('formats', 'Formato', names.format); list('contentTypes', 'Tipo', names.contentType)
  if (f.languages.length && !f.includeUndeclaredLanguage) chips.push({ id: 'lang-strict', group: 'Idioma', label: 'solo vídeos que lo declaran', remove: g => ({ ...g, includeUndeclaredLanguage: true }) })
  if (f.periodDays !== null) chips.push({ id: 'period', group: 'Periodo', label: `últimos ${f.periodDays} días`, remove: g => ({ ...g, periodDays: null }) })
  if (f.rpm.min !== null || f.rpm.max !== null) chips.push({ id: 'rpm', group: 'RPM estimado', label: `${f.rpm.min ?? '0'}–${f.rpm.max ?? '∞'} USD`, remove: g => ({ ...g, rpm: { ...g.rpm, min: null, max: null } }) })
  for (const v of f.metrics.categories) chips.push({ id: `cat:${v}`, group: 'Categoría', label: names.category(v), remove: g => ({ ...g, metrics: { ...g.metrics, categories: g.metrics.categories.filter(x => x !== v) } }) })
  const an = f.analysis
  const aNum = (id: string, group: string, key: keyof AnalysisFilters, label: (v: number) => string) => { const v = an[key] as number | null; if (v !== null) chips.push({ id, group, label: label(v), remove: g => ({ ...g, analysis: { ...g.analysis, [key]: null } }) }) }
  aNum('a-dem', 'Demanda', 'minDemand', v => `≥ ${v}`); aNum('a-sup', 'Oferta', 'maxSupply', v => `≤ ${v}`); aNum('a-comp', 'Competencia', 'maxCompetition', v => `≤ ${v}`); aNum('a-gro', 'Crecimiento', 'minGrowth', v => `≥ ${v}`); aNum('a-opp', 'Oportunidad', 'minOpportunity', v => `≥ ${v}`)
  if (an.minConfidence) chips.push({ id: 'a-conf', group: 'Confianza', label: `≥ ${an.minConfidence}`, remove: g => ({ ...g, analysis: { ...g.analysis, minConfidence: null } }) })
  for (const v of an.verdicts) chips.push({ id: `a-ver:${v}`, group: 'Clasificación', label: VERDICT_OPTIONS.find(([k]) => k === v)?.[1] ?? v, remove: g => ({ ...g, analysis: { ...g.analysis, verdicts: g.analysis.verdicts.filter(x => x !== v) } }) })
  const m = f.metrics
  const num = (id: string, group: string, a: keyof MetricFilters, b: keyof MetricFilters | null, unit = '') => {
    const x = m[a] as number | null, y = b ? m[b] as number | null : null
    if (x === null && y === null) return
    chips.push({ id, group, label: b ? `${x ?? '0'}–${y ?? '∞'}${unit}` : `≥ ${x}${unit}`, remove: g => ({ ...g, metrics: { ...g.metrics, [a]: null, ...(b ? { [b]: null } : {}) } }) })
  }
  num('views', 'Visualizaciones', 'minViews', 'maxViews'); num('vpd', 'Vistas/día', 'minViewsPerDay', null); num('likes', 'Me gusta', 'minLikes', null); num('comments', 'Comentarios', 'minComments', null); num('eng', 'Interacción', 'minEngagement', null, ' %')
  num('subs', 'Suscriptores', 'minSubscribers', 'maxSubscribers'); num('ratio', 'Vistas ÷ suscriptores', 'minRatio', null); num('dur', 'Duración', 'minDurationMin', 'maxDurationMin', ' min'); num('rev', 'Ingreso estimado', 'minEstRevenue', 'maxEstRevenue', ' USD')
  if (m.include.trim()) chips.push({ id: 'include', group: 'Contiene', label: m.include.trim(), remove: g => ({ ...g, metrics: { ...g.metrics, include: '' } }) })
  if (m.exclude.trim()) chips.push({ id: 'exclude', group: 'Excluye', label: m.exclude.trim(), remove: g => ({ ...g, metrics: { ...g.metrics, exclude: '' } }) })
  return chips
}

/**
 * Why a list is empty: for every active filter group, how many videos would appear if only that group were removed.
 * Only groups that would bring videos back are reported, best first. This makes "0 results" verifiable instead of mysterious.
 */
export function blockers(videos: SeenVideo[], f: ResearchFilters, now = Date.now()): Array<{ group: string; wouldShow: number }> {
  const without: Array<[string, ResearchFilters]> = [
    ['países', { ...f, countries: [] }], ['idiomas', { ...f, languages: [] }], ['nichos', { ...f, niches: [] }], ['formatos', { ...f, formats: [] }], ['tipos de contenido', { ...f, contentTypes: [] }],
    ['periodo', { ...f, periodDays: null }], ['RPM estimado', { ...f, rpm: { ...f.rpm, min: null, max: null } }], ['filtros avanzados', { ...f, metrics: NO_METRICS }],
  ]
  const current = filterVideos(videos, f, now).length
  return without.map(([group, g]) => ({ group, wouldShow: filterVideos(videos, g, now).length })).filter(x => x.wouldShow > current).sort((a, b) => b.wouldShow - a.wouldShow)
}

/** The filters as they apply in one section: parts the section does not use are cleared, so an invisible filter can never hide results. */
export function forTab(tab: TabId, f: ResearchFilters): ResearchFilters {
  const use = new Set<FilterPart>(TAB_FILTERS[tab])
  return {
    ...f,
    countries: use.has('countries') ? f.countries : [], languages: use.has('languages') ? f.languages : [], niches: use.has('niches') ? f.niches : [], formats: use.has('formats') ? f.formats : [], contentTypes: use.has('contentTypes') ? f.contentTypes : [],
    periodDays: use.has('period') ? f.periodDays : null, rpm: use.has('rpm') ? f.rpm : { ...f.rpm, min: null, max: null }, metrics: use.has('advanced') ? f.metrics : NO_METRICS, analysis: use.has('analysis') ? f.analysis : NO_ANALYSIS,
  }
}

/** Cost of searching the same text in several markets (search.list + videos.list + channels.list ≈ 102 units each). */
export function planSearchBatch(opts: { markets: number; remainingToday: number }): Plan {
  const units = Math.max(opts.markets, 0) * UNITS.search
  if (opts.markets === 0) return { units: 0, fresh: 0, cached: 0, level: 'free', message: 'Elige un tema.' }
  const base = `${opts.markets} mercado${opts.markets === 1 ? '' : 's'} × ${UNITS.search} = ${units} unidades.`
  if (units > MAX_BATCH_UNITS) return { units, fresh: opts.markets, cached: 0, level: 'blocked', message: `${base} Es demasiado para una sola vez (máximo ${MAX_BATCH_UNITS}).` }
  if (units > opts.remainingToday) return { units, fresh: opts.markets, cached: 0, level: 'blocked', message: `${base} Te quedan ${Math.max(opts.remainingToday, 0)} unidades del presupuesto de hoy.` }
  if (units > CONFIRM_ABOVE) return { units, fresh: opts.markets, cached: 0, level: 'confirm', message: `${base} Es bastante cuota: confirma para continuar.` }
  return { units, fresh: opts.markets, cached: 0, level: 'ok', message: base }
}

/** YouTube's own duration bucket implied by the chosen formats, or undefined when they span several. */
export function durationParam(formats: string[]): 'short' | 'medium' | 'long' | undefined {
  const f = formats.filter(x => x !== 'live')
  if (f.length === 0) return undefined
  if (f.every(x => x === 'short' || x === 'brief')) return 'short'
  if (f.every(x => x === 'medium')) return 'medium'
  if (f.every(x => x === 'long')) return 'long'
  return undefined
}

const CONF_RANK = { baja: 0, media: 1 } as const

/**
 * Why an ANALYSIS is left out by the applied filters (empty = it stays). One place for the rule so that the results list, the recommendations
 * and the hidden-results notice always agree.
 */
export function analysisExclusions(a: TopicAnalysis, f: ResearchFilters): string[] {
  const why: string[] = []
  if (f.niches.length && !(f.logic.niches === 'all' ? f.niches.every(n => a.niches.includes(n)) : f.niches.some(n => a.niches.includes(n)))) why.push('nichos')
  if (f.countries.length && (!a.region || !f.countries.includes(a.region))) why.push('países')
  if ((f.rpm.min !== null || f.rpm.max !== null) && !(a.niches.length ? a.niches.some(n => passesRpmFilter(n, f.rpm)) : f.rpm.includeUnknown)) why.push('RPM estimado')
  if (f.formats.length && !formatCovered(a, f.formats)) why.push('formatos')
  const A = f.analysis, i = a.indices
  if (A.minDemand !== null && i.demand < A.minDemand) why.push('demanda')
  if (A.maxSupply !== null && i.supply > A.maxSupply) why.push('oferta')
  if (A.maxCompetition !== null && i.competition > A.maxCompetition) why.push('competencia')
  if (A.minGrowth !== null && i.growth < A.minGrowth) why.push('crecimiento')
  if (A.minOpportunity !== null && i.opportunity < A.minOpportunity) why.push('oportunidad')
  if (A.verdicts.length && !A.verdicts.includes(a.verdict)) why.push('clasificación')
  if (A.minConfidence && CONF_RANK[a.confidence as keyof typeof CONF_RANK] < CONF_RANK[A.minConfidence]) why.push('confianza')
  return why
}
