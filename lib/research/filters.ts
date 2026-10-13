import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { contentTypesOf, inferFormat, nichesOf } from './taxonomy'
import { formatAdjusted, nicheRpm, passesRpmFilter, type RpmFilter } from './monetization'

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

export type ResearchFilters = {
  countries: string[]; languages: string[]; niches: string[]; formats: string[]; contentTypes: string[]
  metrics: MetricFilters
  /** Only content published in the last N days (null = no limit). */
  periodDays: number | null
  rpm: RpmFilter
  logic: Record<GroupId, Logic>
}

export const EMPTY_FILTERS: ResearchFilters = {
  countries: [], languages: [], niches: [], formats: [], contentTypes: [], metrics: NO_METRICS, periodDays: null,
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
  if (f.languages.length && !(v.declaredLanguage && f.languages.includes(v.declaredLanguage))) return false
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
  return metricsActive + f.countries.length + f.languages.length + f.niches.length + f.formats.length + f.contentTypes.length + (f.periodDays !== null ? 1 : 0) + (f.rpm.min !== null || f.rpm.max !== null ? 1 : 0)
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
    countries: strs(r.countries), languages: strs(r.languages), niches: strs(r.niches), formats: strs(r.formats), contentTypes: strs(r.contentTypes), metrics: sanitizeMetrics(r.metrics),
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
