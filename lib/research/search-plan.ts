import { planTopicBatch, planSearchBatch, UNITS, type Plan, type ResearchFilters, type TabId } from './filters'
import { jobKey, planGuided, type Job } from './guided'
import { isFresh, marketsFromFilters, recentDaysFrom, type Market } from './markets'
import type { TopicAnalysis } from './topic-analysis'

export type Queries = { niches: string; keywords: string; competition: string; international: string; perMarket: number; order: string }

export const parseTopics = (text: string, max = 6) => [...new Set(text.split(/[\n,;]+/).map(t => t.trim().replace(/\s+/g, ' ')).filter(t => t.length >= 2 && t.length <= 120))].slice(0, max)

/**
 * What the single "Aplicar" button of a section will do, computed from the DRAFT filters and what the user typed:
 *  - analysis: one analysis (~204 units) per (topic, market); with no typed topics, ideas from the chosen niches in each market's language
 *  - search:   the typed text searched in every market (~102 units each)
 *  - charts:   the cheap official charts (2 units per country) not loaded yet
 *  - none:     nothing to fetch; the button only applies the filters
 * Pure, so the button's label, its cost and the confirmation rule are all testable without a browser.
 */
export type SearchPlan = {
  kind: 'analysis' | 'search' | 'charts' | 'multi' | 'none'
  jobs: Job[]; query: string | null; chartRegions: string[]; markets: Market[]; recentDays: number
  /** The draft filters this plan was made with (the search uses their period and formats). */
  filters: ResearchFilters
  fresh: number; cached: number; units: number; level: Plan['level']; message: string; auto: boolean; summary: string
}

type Ctx = { analyses: Record<string, TopicAnalysis>; charts: Record<string, unknown>; remainingToday: number }

const none = (markets: Market[], recentDays: number, filters: ResearchFilters): SearchPlan => ({ kind: 'none', jobs: [], query: null, chartRegions: [], markets, recentDays, filters, fresh: 0, cached: 0, units: 0, level: 'free', message: '', auto: false, summary: '' })

function analysisPart(jobs: Job[], c: Ctx, recentDays: number) {
  const cached = jobs.filter(j => { const a = c.analyses[jobKey(j, recentDays)]; return !!a && isFresh(a) }).length
  return { cached, fresh: jobs.length - cached, units: (jobs.length - cached) * UNITS.topic }
}

export function searchPlanFor(tab: TabId, draft: ResearchFilters, q: Queries, c: Ctx): SearchPlan {
  const markets = marketsFromFilters(draft), recentDays = recentDaysFrom(draft.periodDays)
  const base = none(markets, recentDays, draft)
  const regionsPending = draft.countries.filter(r => !c.charts[r])
  const summaryOf = (jobs: Job[], auto: boolean) => { const topics = [...new Set(jobs.map(j => j.topic))]; return auto ? `${jobs.length} análisis (${Math.round(jobs.length / Math.max(markets.length, 1))} por mercado) en ${markets.map(m => m.label).join(', ')}` : `${topics.length} tema${topics.length === 1 ? '' : 's'} × ${markets.length} mercado${markets.length === 1 ? '' : 's'} (${markets.map(m => m.label).join(', ')})` }
  if (tab === 'niches' || tab === 'keywords' || tab === 'international') {
    const typed = parseTopics(tab === 'niches' ? q.niches : tab === 'keywords' ? q.keywords : q.international, tab === 'keywords' ? 3 : tab === 'international' ? 1 : 6)
    let jobs: Job[] = [], auto = false
    if (typed.length) jobs = typed.flatMap(topic => markets.map(market => ({ topic, market })))
    else if (tab === 'niches') { auto = true; jobs = planGuided({ markets, nicheIds: draft.niches, perMarket: Math.min(Math.max(q.perMarket, 1), 20) }).jobs }
    const a = analysisPart(jobs, c, recentDays)
    const chartUnits = tab === 'international' ? regionsPending.length * UNITS.trending : 0
    const units = a.units + chartUnits
    if (jobs.length === 0 && chartUnits === 0) return base
    const level = jobs.length || chartUnits ? planTopicBatch({ topics: Math.ceil(units / UNITS.topic) || 0, regions: 1, cachedCombos: 0, remainingToday: c.remainingToday }).level : 'free'
    const lvl: Plan['level'] = units === 0 ? 'free' : level === 'free' ? 'ok' : level
    const parts = [jobs.length ? `${a.fresh} análisis nuevo${a.fresh === 1 ? '' : 's'} × ${UNITS.topic} = ${a.fresh * UNITS.topic} unidades${a.cached ? ` (${a.cached} ya guardado${a.cached === 1 ? '' : 's'}, gratis)` : ''}` : '', chartUnits ? `${regionsPending.length} lista${regionsPending.length === 1 ? '' : 's'} de tendencias × ${UNITS.trending} = ${chartUnits} unidades` : ''].filter(Boolean)
    const msg = lvl === 'free' ? 'Todo está ya guardado de búsquedas anteriores: no gasta cuota.' : `${parts.join(' + ')}. Total ${units} unidades.${lvl === 'confirm' ? ' Es bastante cuota: confirma para continuar.' : lvl === 'blocked' ? (units > c.remainingToday ? ` Te quedan ${Math.max(c.remainingToday, 0)} unidades del presupuesto de hoy.` : ' Es demasiado para una sola vez: reduce temas o países.') : ''}`
    return { ...base, kind: chartUnits && jobs.length ? 'multi' : chartUnits ? 'charts' : 'analysis', jobs, chartRegions: tab === 'international' ? regionsPending : [], fresh: a.fresh, cached: a.cached, units, level: lvl, message: msg, auto, summary: jobs.length ? summaryOf(jobs, auto) : `listas oficiales de ${regionsPending.length} país(es)` }
  }
  if (tab === 'competition') {
    const query = q.competition.trim()
    if (!query) return base
    const p = planSearchBatch({ markets: markets.length, remainingToday: c.remainingToday })
    return { ...base, kind: 'search', query, fresh: markets.length, units: p.units, level: p.level, message: p.message, summary: `«${query}» en ${markets.map(m => m.label).join(', ')}` }
  }
  if (tab === 'discover') {
    if (regionsPending.length === 0) return base
    const units = regionsPending.length * UNITS.trending
    return { ...base, kind: 'charts', chartRegions: regionsPending, fresh: regionsPending.length, units, level: 'ok', message: `${regionsPending.length} lista${regionsPending.length === 1 ? '' : 's'} × ${UNITS.trending} = ${units} unidades.`, summary: `listas oficiales de ${regionsPending.length} país(es)` }
  }
  return base
}

export const planLabel = (p: SearchPlan) =>
  p.kind === 'none' ? 'Aplicar filtros'
  : p.kind === 'charts' ? `Aplicar y cargar tendencias de ${p.chartRegions.length} país${p.chartRegions.length === 1 ? '' : 'es'} (${p.units} unidades)`
  : p.units === 0 ? 'Aplicar y mostrar (ya guardado, gratis)'
  : `Aplicar y buscar (${p.units.toLocaleString('es-ES', { useGrouping: true })} unidades)`
