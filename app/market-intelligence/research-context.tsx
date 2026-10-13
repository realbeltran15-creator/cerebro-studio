'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EMPTY_FILTERS, durationParam, loadPresets, planTopicBatch, savePresets, addPreset, sanitizeFilters, sameFilters, validateFilters, type ActiveChip, type Plan, type Preset, type ResearchFilters } from '@/lib/research/filters'
import { analysisKey, marketsFromFilters, recentDaysFrom, type Market } from '@/lib/research/markets'
import { jobKey, type Job } from '@/lib/research/guided'
import type { Queries, SearchPlan } from '@/lib/research/search-plan'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

type Usage = { usedToday: number; cap: number; remaining: number; persistent: boolean } | null
type Progress = { done: number; total: number; current: string } | null

export type RunSummary = { at: string; ok: number; failed: string[]; total: number; units: number }
export type GuidedPlan = { jobs: Job[]; perMarket: number; createdAt: string; recentDays: number }
export type SearchState = { videos: Array<{ region: string; videos: YouTubeVideoResult[] }>; ranFor: { q: string; labels: string[] } | null; busy: boolean; error: string; done: string }

type Ctx = {
  /** APPLIED filters: what every result on screen was computed with. */
  filters: ResearchFilters
  /** DRAFT filters: what the panel shows. They only become `filters` when the user presses Apply. */
  draft: ResearchFilters; setDraft: (f: ResearchFilters) => void
  apply: () => void; reset: () => void; dirty: boolean; errors: string[]
  /** Removes one active filter from both draft and applied at once (the chip's ✕). */
  removeChip: (chip: ActiveChip) => void
  recentDays: number
  lastRun: RunSummary | null
  /** What the user typed in each section: shared with the panel so the apply button knows what to search. */
  queries: Queries; setQueries: (q: Partial<Queries>) => void
  /** Runs one analysis per (topic, market) job. `maxJobs` stops early (e.g. at today's budget); jobs already analysed are skipped. */
  runJobs: (jobs: Job[], opts: { recentDays: number; maxJobs?: number }) => Promise<{ ok: number; failed: string[] }>
  /** Executes what a SearchPlan says (charts, analyses, search) and remembers it so a failed run can be retried. */
  runPlan: (p: SearchPlan) => Promise<void>; lastPlan: SearchPlan | null
  guided: GuidedPlan | null; setGuided: (g: GuidedPlan | null) => void
  search: SearchState; runSearch: (q: string, order: string, markets: Market[], f: ResearchFilters) => Promise<void>
  markets: Market[]
  analyses: Record<string, TopicAnalysis>; list: TopicAnalysis[]
  usage: Usage; refreshUsage: () => Promise<void>
  plan: (topics: string[], markets?: Market[]) => Plan
  run: (topics: string[], markets?: Market[], opts?: { refresh?: boolean }) => Promise<{ ok: number; failed: string[] }>
  progress: Progress; error: string; cancel: () => void; clearAnalyses: () => void
  /** Official most-popular charts already fetched (2 quota units each), by country. */
  charts: Record<string, YouTubeVideoResult[]>; loadCharts: (regions: string[]) => Promise<void>; chartsBusy: boolean; chartsError: string
  presets: Preset[]; savePreset: (name: string) => void; applyPreset: (id: string) => void; deletePreset: (id: string) => void
}

const C = createContext<Ctx | null>(null)
export const useResearch = () => { const c = useContext(C); if (!c) throw new Error('ResearchProvider missing'); return c }

const SESSION = 'cerebro.research.session'
const DATA = 'cerebro.research.data'
const store = () => { try { return window.localStorage } catch { return null } }
const session = () => { try { return window.sessionStorage } catch { return null } }

/**
 * Holds the filters and the analyses already paid for, so switching sections never loses them. Filters and results live in
 * sessionStorage (this tab); saved combinations live in localStorage (this browser).
 */
export function ResearchProvider({ children }: { children: ReactNode }) {
  const [filters, setApplied] = useState<ResearchFilters>(EMPTY_FILTERS)
  const [draft, setDraft] = useState<ResearchFilters>(EMPTY_FILTERS)
  const [lastRun, setLastRun] = useState<RunSummary | null>(null)
  const [analyses, setAnalyses] = useState<Record<string, TopicAnalysis>>({})
  const [charts, setCharts] = useState<Record<string, YouTubeVideoResult[]>>({})
  const [chartsBusy, setChartsBusy] = useState(false)
  const [chartsError, setChartsError] = useState('')
  const [usage, setUsage] = useState<Usage>(null)
  const [progress, setProgress] = useState<Progress>(null)
  const [error, setError] = useState('')
  const [presets, setPresets] = useState<Preset[]>([])
  const [queries, setQueriesState] = useState<Queries>({ niches: '', keywords: '', competition: '', international: '', perMarket: 3, order: 'relevance' })
  const [guided, setGuided] = useState<GuidedPlan | null>(null)
  const [lastPlan, setLastPlan] = useState<SearchPlan | null>(null)
  const [search, setSearch] = useState<SearchState>({ videos: [], ranFor: null, busy: false, error: '', done: '' })
  const [hydrated, setHydrated] = useState(false)
  const stop = useRef(false)

  useEffect(() => {
    try {
      const raw = session()?.getItem(SESSION)
      if (raw) { const s = JSON.parse(raw) as { filters?: unknown; draft?: unknown; queries?: Partial<Queries> }; setApplied(sanitizeFilters(s.filters)); setDraft(sanitizeFilters(s.draft ?? s.filters)); if (s.queries) setQueriesState(q => ({ ...q, ...s.queries })) }
    } catch { /* corrupt session data is ignored */ }
    // Analyses are paid for, so they live in this browser (localStorage) and survive closing the tab: a multi-day research can resume.
    try {
      const raw = store()?.getItem(DATA)
      if (raw) { const d = JSON.parse(raw) as { analyses?: Record<string, TopicAnalysis>; charts?: Record<string, YouTubeVideoResult[]>; guided?: GuidedPlan | null }; if (d.analyses && typeof d.analyses === 'object') setAnalyses(d.analyses); if (d.charts && typeof d.charts === 'object') setCharts(d.charts); if (d.guided && Array.isArray(d.guided.jobs)) setGuided(d.guided) }
    } catch { /* ignore */ }
    setPresets(loadPresets(store())); setHydrated(true)
  }, [])
  useEffect(() => { if (hydrated) { try { session()?.setItem(SESSION, JSON.stringify({ filters, draft, queries })) } catch { /* quota */ } } }, [filters, draft, queries, hydrated])
  useEffect(() => {
    if (!hydrated) return
    const write = (a: Record<string, TopicAnalysis>) => store()?.setItem(DATA, JSON.stringify({ analyses: a, charts, guided }))
    try { write(analyses) } catch {
      // Quota: keep the analyses but drop their sample videos, which are the bulk of the size.
      try { write(Object.fromEntries(Object.entries(analyses).map(([k, v]) => [k, { ...v, topVideos: [] }]))) } catch { /* keep in memory only */ }
    }
  }, [analyses, charts, guided, hydrated])

  const refreshUsage = useCallback(async () => {
    try { const r = await fetch('/api/research/usage', { cache: 'no-store' }); if (r.ok) setUsage(await r.json() as Usage) } catch { /* offline */ }
  }, [])
  useEffect(() => { void refreshUsage() }, [refreshUsage])

  const markets = useMemo(() => marketsFromFilters(filters), [filters])
  const recentDays = recentDaysFrom(filters.periodDays)
  const plan = useCallback((topics: string[], ms: Market[] = markets) => {
    const cached = topics.flatMap(t => ms.map(m => analysisKey(t, m.region, m.language, recentDays))).filter(k => analyses[k]).length
    return planTopicBatch({ topics: topics.length, regions: ms.length, cachedCombos: cached, remainingToday: usage?.remaining ?? 6000 })
  }, [analyses, markets, usage, recentDays])

  const runJobs = useCallback(async (all: Job[], opts: { recentDays: number; maxJobs?: number; refresh?: boolean }) => {
    stop.current = false; setError('')
    const todo = all.filter(j => opts.refresh || !analyses[jobKey(j, opts.recentDays)])
    const jobs = opts.maxJobs === undefined ? todo : todo.slice(0, Math.max(opts.maxJobs, 0))
    const failed: string[] = []; let ok = 0, units = 0
    for (let i = 0; i < jobs.length; i++) {
      if (stop.current) break
      const { topic, market: m } = jobs[i]
      setProgress({ done: i, total: jobs.length, current: `${topic} · ${m.label}` })
      try {
        const p = new URLSearchParams({ q: topic, days: String(opts.recentDays) }); if (m.region) p.set('region', m.region); if (m.language) p.set('lang', m.language); if (opts.refresh) p.set('refresh', '1')
        const r = await fetch(`/api/research/topic?${p}`, { cache: 'no-store' })
        const j = await r.json() as { analysis?: TopicAnalysis; cached?: boolean; error?: string; usage?: { usedToday: number; cap: number; persistent: boolean } }
        if (!r.ok || !j.analysis) { failed.push(`${topic} · ${m.label}: ${j.error ?? 'error'}`); if (r.status === 429 || r.status === 503) { setError(j.error ?? 'No se pudo consultar YouTube.'); break } continue }
        setAnalyses(a => ({ ...a, [jobKey(jobs[i], opts.recentDays)]: j.analysis! })); ok++; if (!j.cached) units += j.analysis!.units
        if (j.usage) setUsage({ usedToday: j.usage.usedToday, cap: j.usage.cap, remaining: Math.max(j.usage.cap - j.usage.usedToday, 0), persistent: j.usage.persistent })
      } catch (e) { failed.push(`${topic} · ${m.label}: ${e instanceof Error ? e.message : 'error'}`) }
    }
    setProgress(null)
    if (failed.length) setError(e => e || failed.slice(0, 3).join(' · '))
    setLastRun({ at: new Date().toISOString(), ok, failed, total: jobs.length, units })
    return { ok, failed }
  }, [analyses])

  const run = useCallback((topics: string[], ms: Market[] = markets, opts: { refresh?: boolean } = {}) =>
    runJobs(topics.flatMap(topic => ms.map(market => ({ topic, market }))), { recentDays, refresh: opts.refresh }), [runJobs, markets, recentDays])

  const runSearch = useCallback(async (q: string, order: string, ms: Market[], f: ResearchFilters) => {
    setSearch(s => ({ ...s, busy: true, error: '', done: '' }))
    const out: Array<{ region: string; videos: YouTubeVideoResult[] }> = [], failed: string[] = []
    for (const m of ms) {
      try {
        const params = new URLSearchParams({ q, order, max: '25' })
        if (m.region) params.set('region', m.region); if (m.language) params.set('lang', m.language); if (f.periodDays) params.set('days', String(f.periodDays))
        const d = durationParam(f.formats); if (d) params.set('duration', d)
        const response = await fetch(`/api/research/youtube?${params}`, { cache: 'no-store' })
        const json = await response.json() as { results?: YouTubeVideoResult[]; error?: string }
        if (!response.ok) { failed.push(`${m.label}: ${json.error ?? 'error'}`); if (response.status === 503 || response.status === 429) break; continue }
        out.push({ region: m.region ?? m.label, videos: json.results ?? [] })
      } catch (e) { failed.push(`${m.label}: ${e instanceof Error ? e.message : 'error'}`) }
    }
    setSearch({ videos: out, ranFor: { q, labels: ms.map(m => m.label) }, busy: false,
      error: failed.length ? `falló en ${failed.length} mercado${failed.length === 1 ? '' : 's'} — ${failed.slice(0, 2).join(' · ')}` : '',
      done: failed.length ? '' : `Resultados actualizados: ${out.reduce((t, c) => t + c.videos.length, 0)} vídeos de ${out.length} mercado${out.length === 1 ? '' : 's'}.` })
    void refreshUsage()
  }, [refreshUsage])

  const loadCharts = useCallback(async (regions: string[]) => {
    setChartsBusy(true); setChartsError('')
    try {
      for (const r of regions) {
        if (charts[r]) continue
        const res = await fetch(`/api/research/trending?region=${r}&snapshot=0`, { cache: 'no-store' })
        const j = await res.json() as { results?: YouTubeVideoResult[]; error?: string }
        if (!res.ok) { setChartsError(j.error ?? 'No se pudo consultar YouTube.'); if (res.status === 503) break; continue }
        setCharts(c => ({ ...c, [r]: j.results ?? [] }))
      }
    } catch (e) { setChartsError(e instanceof Error ? e.message : 'No se pudo consultar YouTube.') } finally { setChartsBusy(false) }
  }, [charts])

  const runPlan = useCallback(async (p: SearchPlan) => {
    setLastPlan(p)
    if (p.chartRegions.length) await loadCharts(p.chartRegions)
    if (p.jobs.length) await runJobs(p.jobs, { recentDays: p.recentDays })
    if (p.query) await runSearch(p.query, queries.order, p.markets, p.filters)
  }, [loadCharts, runJobs, runSearch, queries.order])

  const errors = useMemo(() => validateFilters(draft), [draft])
  const dirty = useMemo(() => !sameFilters(draft, filters), [draft, filters])
  const apply = useCallback(() => { if (validateFilters(draft).length === 0) { setApplied(sanitizeFilters(draft)); setError(''); setLastRun(null) } }, [draft])
  const reset = useCallback(() => { setApplied(EMPTY_FILTERS); setDraft(EMPTY_FILTERS); setError(''); setLastRun(null) }, [])
  const removeChip = useCallback((chip: ActiveChip) => { setApplied(f => chip.remove(f)); setDraft(f => chip.remove(f)); setLastRun(null) }, [])
  const persistPresets = (list: Preset[]) => { setPresets(list); savePresets(store(), list) }
  const value: Ctx = {
    filters, draft, setDraft, apply, reset, dirty, errors, removeChip, recentDays, lastRun, queries, setQueries: q => setQueriesState(prev => ({ ...prev, ...q })), runJobs, runPlan, lastPlan, guided, setGuided, search, runSearch, markets, analyses, charts, loadCharts, chartsBusy, chartsError, list: Object.values(analyses), usage, refreshUsage, plan, run, progress, error, cancel: () => { stop.current = true }, clearAnalyses: () => { setAnalyses({}); setGuided(null) },
    presets, savePreset: name => persistPresets(addPreset(presets, name, draft)), applyPreset: id => { const p = presets.find(x => x.id === id); if (p) { const f = sanitizeFilters(p.filters); setDraft(f); setApplied(f); setLastRun(null) } }, deletePreset: id => persistPresets(presets.filter(p => p.id !== id)),
  }
  return <C.Provider value={value}>{children}</C.Provider>
}
