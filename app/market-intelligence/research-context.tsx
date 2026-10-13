'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EMPTY_FILTERS, loadPresets, planTopicBatch, savePresets, addPreset, sanitizeFilters, sameFilters, validateFilters, type ActiveChip, type Plan, type Preset, type ResearchFilters } from '@/lib/research/filters'
import { analysisKey, marketsFromFilters, recentDaysFrom, type Market } from '@/lib/research/markets'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

type Usage = { usedToday: number; cap: number; remaining: number; persistent: boolean } | null
type Progress = { done: number; total: number; current: string } | null

export type RunSummary = { at: string; ok: number; failed: string[]; total: number; units: number }

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
  const [hydrated, setHydrated] = useState(false)
  const stop = useRef(false)

  useEffect(() => {
    try {
      const raw = session()?.getItem(SESSION)
      if (raw) { const s = JSON.parse(raw) as { filters?: unknown; draft?: unknown; analyses?: Record<string, TopicAnalysis>; charts?: Record<string, YouTubeVideoResult[]> }; setApplied(sanitizeFilters(s.filters)); setDraft(sanitizeFilters(s.draft ?? s.filters)); setAnalyses(s.analyses && typeof s.analyses === 'object' ? s.analyses : {}); setCharts(s.charts && typeof s.charts === 'object' ? s.charts : {}) }
    } catch { /* corrupt session data is ignored */ }
    setPresets(loadPresets(store())); setHydrated(true)
  }, [])
  useEffect(() => { if (hydrated) { try { session()?.setItem(SESSION, JSON.stringify({ filters, draft, analyses, charts })) } catch { /* quota */ } } }, [filters, draft, analyses, charts, hydrated])

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

  const run = useCallback(async (topics: string[], ms: Market[] = markets, opts: { refresh?: boolean } = {}) => {
    stop.current = false; setError('')
    const jobs = topics.flatMap(topic => ms.map(m => ({ topic, m }))).filter(j => opts.refresh || !analyses[analysisKey(j.topic, j.m.region, j.m.language, recentDays)])
    const failed: string[] = []; let ok = 0, units = 0
    for (let i = 0; i < jobs.length; i++) {
      if (stop.current) break
      const { topic, m } = jobs[i]
      setProgress({ done: i, total: jobs.length, current: `${topic} · ${m.label}` })
      try {
        const p = new URLSearchParams({ q: topic, days: String(recentDays) }); if (m.region) p.set('region', m.region); if (m.language) p.set('lang', m.language); if (opts.refresh) p.set('refresh', '1')
        const r = await fetch(`/api/research/topic?${p}`, { cache: 'no-store' })
        const j = await r.json() as { analysis?: TopicAnalysis; cached?: boolean; error?: string; usage?: { usedToday: number; cap: number; persistent: boolean } }
        if (!r.ok || !j.analysis) { failed.push(`${topic} · ${m.label}: ${j.error ?? 'error'}`); if (r.status === 429 || r.status === 503) { setError(j.error ?? 'No se pudo consultar YouTube.'); break } continue }
        setAnalyses(a => ({ ...a, [analysisKey(topic, m.region, m.language, recentDays)]: j.analysis! })); ok++; if (!j.cached) units += j.analysis!.units
        if (j.usage) setUsage({ usedToday: j.usage.usedToday, cap: j.usage.cap, remaining: Math.max(j.usage.cap - j.usage.usedToday, 0), persistent: j.usage.persistent })
      } catch (e) { failed.push(`${topic} · ${m.label}: ${e instanceof Error ? e.message : 'error'}`) }
    }
    setProgress(null)
    if (failed.length && !error) setError(failed.slice(0, 3).join(' · '))
    setLastRun({ at: new Date().toISOString(), ok, failed, total: jobs.length, units })
    return { ok, failed }
  }, [analyses, markets, error, recentDays])

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

  const errors = useMemo(() => validateFilters(draft), [draft])
  const dirty = useMemo(() => !sameFilters(draft, filters), [draft, filters])
  const apply = useCallback(() => { if (validateFilters(draft).length === 0) { setApplied(sanitizeFilters(draft)); setError(''); setLastRun(null) } }, [draft])
  const reset = useCallback(() => { setApplied(EMPTY_FILTERS); setDraft(EMPTY_FILTERS); setError(''); setLastRun(null) }, [])
  const removeChip = useCallback((chip: ActiveChip) => { setApplied(f => chip.remove(f)); setDraft(f => chip.remove(f)); setLastRun(null) }, [])
  const persistPresets = (list: Preset[]) => { setPresets(list); savePresets(store(), list) }
  const value: Ctx = {
    filters, draft, setDraft, apply, reset, dirty, errors, removeChip, recentDays, lastRun, markets, analyses, charts, loadCharts, chartsBusy, chartsError, list: Object.values(analyses), usage, refreshUsage, plan, run, progress, error, cancel: () => { stop.current = true }, clearAnalyses: () => setAnalyses({}),
    presets, savePreset: name => persistPresets(addPreset(presets, name, draft)), applyPreset: id => { const p = presets.find(x => x.id === id); if (p) { const f = sanitizeFilters(p.filters); setDraft(f); setApplied(f); setLastRun(null) } }, deletePreset: id => persistPresets(presets.filter(p => p.id !== id)),
  }
  return <C.Provider value={value}>{children}</C.Provider>
}
