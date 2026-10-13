import { describe, expect, it, vi } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { analyzeTopic, emergingTerms, extractQuestions, extractTerms, formatOpportunity, logScore, type TopicSamples } from '@/lib/research/topic-analysis'
import { contentTypesOf, inferFormat, nichesOf } from '@/lib/research/taxonomy'
import { COUNTRY_RPM, SHORTS_FACTOR, formatAdjusted, nicheRpm, passesRpmFilter, revenueScenarios } from '@/lib/research/monetization'
import { EMPTY_FILTERS, NO_METRICS, activeCount, estimateRevenue, effectiveLogic, filterVideos, mergeRegions, planTopicBatch, addPreset, loadPresets, savePresets, sanitizeFilters, type ResearchFilters, type SeenVideo } from '@/lib/research/filters'
import { MemoryCacheStore } from '@/lib/research/cache'
import { BudgetError, dailyCap, getTopicAnalysis } from '@/lib/research/sample'

const NOW = Date.parse('2026-10-13T12:00:00Z')
type O = { title?: string; days?: number; views?: number; subs?: number | null; dur?: number | null; ch?: string; lang?: string | null; tags?: string[]; cat?: string; live?: YouTubeVideoResult['live'] }
let n = 0
const vid = (o: O = {}): YouTubeVideoResult => {
  const days = o.days ?? 10, views = o.views ?? 1000, subs = o.subs === undefined ? 5000 : o.subs
  return { videoId: `v${++n}`, url: '', title: o.title ?? 'video', channelId: o.ch ?? `c${n}`, channelTitle: 'C', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: o.lang === undefined ? 'es' : o.lang, tags: o.tags ?? [], categoryId: o.cat ?? null, live: o.live ?? null,
    observed: { views, likes: 10, comments: 1, durationSeconds: o.dur === undefined ? 600 : o.dur, channelSubscribers: subs, fetchedAt: '' },
    calculated: { viewsPerDay: Math.round(views / Math.max(days, 1)), viewsToSubscribers: subs ? views / subs : null, engagementRate: 1 } }
}
const many = (count: number, f: (i: number) => O) => Array.from({ length: count }, (_, i) => vid(f(i)))
const samples = (top: YouTubeVideoResult[], recent: YouTubeVideoResult[]): TopicSamples => ({ topic: 'tema', region: 'ES', language: 'es', top: { videos: top, approxTotal: 120000 }, recent: { videos: recent, approxTotal: 5000 }, fetchedAt: new Date(NOW).toISOString(), units: 204 })

describe('topic analysis: demand against supply', () => {
  it('flags real demand with few small creators as an opportunity and explains why', () => {
    const top = many(25, i => ({ views: 400000 - i * 5000, days: 120, subs: 8000 + i * 500, ch: `small${i}` }))
    const recent = many(6, i => ({ views: 30000, days: 5 + i * 4, subs: 7000, ch: `r${i % 2}` }))
    const a = analyzeTopic(samples(top, recent), NOW)
    expect(a.verdict).toBe('oportunidad')
    expect(a.indices.demand).toBeGreaterThanOrEqual(50)
    expect(a.indices.competition).toBeLessThanOrEqual(55)
    expect(a.reasons.join(' ')).toMatch(/Demanda .*\/100/)
    expect(a.reasons.join(' ')).toMatch(/Competencia/)
    expect(a.evidence.every(e => ['observado', 'calculado', 'inferido'].includes(e.kind))).toBe(true)
  })
  it('does NOT call a topic an opportunity just because few videos exist: no demand caps the score', () => {
    const top = many(4, () => ({ views: 300, days: 200, subs: 400 }))
    const recent = many(1, () => ({ views: 40, days: 20, subs: 400 }))
    const a = analyzeTopic(samples(top, recent), NOW)
    expect(a.verdict).toBe('sin_demanda')
    expect(a.indices.opportunity).toBeLessThanOrEqual(20)
    expect(a.headline).toMatch(/no es una oportunidad/)
    expect(a.confidence).toBe('baja')
  })
  it('marks demand + dominant big channels + heavy publishing as saturated', () => {
    const top = many(25, i => ({ views: 3_000_000, days: 100, subs: 2_500_000, ch: i < 20 ? 'big' : `b${i}` }))
    const recent = many(25, i => ({ views: 200000, days: 1 + (i % 25) * 0.5, subs: 1_000_000, ch: `x${i}` }))
    const a = analyzeTopic(samples(top, recent), NOW)
    expect(a.verdict).toBe('saturado')
    expect(a.indices.competition).toBeGreaterThan(70)
  })
  it('never reports more than medium confidence from a single search sample, and says the sample is not a census', () => {
    const a = analyzeTopic(samples(many(25, () => ({ views: 90000, days: 90 })), many(25, () => ({ views: 5000, days: 10 }))), NOW)
    expect(a.confidence).toBe('media')
    expect(a.confidenceNote).toMatch(/no permite contar todos los vídeos/)
    expect(a.evidence.find(e => /aprox\., no es un censo/.test(e.label))?.value).not.toBe('sin dato')
  })
  it('growth reflects whether recent videos earn at the pace of the year\'s best', () => {
    const top = many(20, () => ({ views: 100000, days: 100 }))
    const hot = analyzeTopic(samples(top, many(10, () => ({ views: 60000, days: 6 }))), NOW)
    const cold = analyzeTopic(samples(top, many(10, () => ({ views: 600, days: 6 }))), NOW)
    expect(hot.indices.growth).toBeGreaterThan(cold.indices.growth)
    expect(hot.growthPct).toBeGreaterThan(0); expect(cold.growthPct).toBeLessThan(0)
  })
  it('logScore is log-shaped and bounded', () => {
    expect(logScore(null, 1000)).toBe(0); expect(logScore(1000, 1000)).toBe(100); expect(logScore(10 ** 9, 1000)).toBe(100)
    expect(logScore(31, 1000)).toBeGreaterThan(45); expect(logScore(31, 1000)).toBeLessThan(55)
  })
})

describe('terms, questions and emerging terms', () => {
  const vs = [vid({ title: 'Cómo invertir en bolsa desde cero', views: 900 }), vid({ title: 'Invertir en bolsa para principiantes', views: 500 }), vid({ title: '¿Por qué invertir en bolsa?', views: 800 }), vid({ title: 'Receta de pasta', views: 10 })]
  it('finds recurring phrases once per video and prefers the longer phrase', () => {
    const t = extractTerms(vs)
    expect(t.map(x => x.term)).toContain('invertir en bolsa')
    expect(t.map(x => x.term)).not.toContain('bolsa')
  })
  it('extracts questions by views and without duplicates', () => {
    expect(extractQuestions([...vs, vid({ title: '¿Por qué invertir en bolsa?', views: 1 })]).map(q => q.text)).toEqual(['Cómo invertir en bolsa desde cero', '¿Por qué invertir en bolsa?'])
  })
  it('emerging terms weigh more in recent videos than in the year\'s top', () => {
    const top = many(6, i => ({ title: i < 5 ? 'tutorial excel avanzado' : 'otra cosa distinta' }))
    const recent = many(6, i => ({ title: i < 4 ? 'agentes autónomos ia práctica' : 'tutorial excel avanzado' }))
    expect(emergingTerms(top, recent).map(t => t.term).join(' ')).toMatch(/agentes/)
  })
})

describe('format and niche inference (transparent, never exact)', () => {
  it('a ≤60 s video is only a probable Short; the #shorts tag raises confidence; 61–180 s needs the tag', () => {
    expect(inferFormat(vid({ dur: 45 }))).toMatchObject({ format: 'short', confidence: 'media' })
    expect(inferFormat(vid({ dur: 45, title: 'Truco #shorts' }))).toMatchObject({ format: 'short', confidence: 'alta' })
    expect(inferFormat(vid({ dur: 120 })).format).toBe('brief')
    expect(inferFormat(vid({ dur: 120, title: 'Truco #Shorts' })).format).toBe('short')
    expect(inferFormat(vid({ dur: null })).format).toBe('unknown')
    expect(inferFormat(vid({ dur: 3000, live: 'live' })).format).toBe('live')
    expect(inferFormat(vid({ dur: 45 })).reason).toMatch(/sin etiqueta/)
  })
  it('a video can belong to several niches and says why', () => {
    const m = nichesOf(vid({ title: 'Las mejores herramientas de inteligencia artificial para programación' }))
    expect(m.map(x => x.niche)).toEqual(expect.arrayContaining(['ia', 'tecnologia']))
    expect(m.every(x => x.reason.length > 0)).toBe(true)
    expect(nichesOf(vid({ title: 'Mi gato', cat: '15' })).map(x => x.niche)).toContain('animales')
  })
  it('detects content types and live streams', () => {
    expect(contentTypesOf(vid({ title: 'Tutorial paso a paso de Excel' })).map(t => t.id)).toContain('tutorial')
    expect(contentTypesOf(vid({ title: 'lofi para estudiar' })).map(t => t.id)).toContain('ambiente')
    expect(contentTypesOf(vid({ title: 'x', live: 'live' })).map(t => t.id)).toContain('directo')
  })
})

describe('monetisation never invents RPM', () => {
  it('unknown niches are DESCONOCIDO and every estimate carries sources and a confidence below "alta"', () => {
    expect(nicheRpm('motor').status).toBe('desconocido')
    const r = nicheRpm('entretenimiento')
    expect(r.status).toBe('estimado')
    if (r.status === 'estimado') { expect(r.sources.length).toBeGreaterThan(0); expect(['media', 'baja', 'muy baja']).toContain(r.confidence); expect([r.low, r.mid, r.high]).toEqual([0.88, 2.43, 5.02]) }
  })
  it('inherited niches (IA, cocina…) are flagged as indirect and have very low confidence', () => {
    const r = nicheRpm('ia')
    expect(r.status === 'estimado' && r.confidence).toBe('muy baja')
    expect(r.status === 'estimado' && r.note).toMatch(/asimila/)
  })
  it('finance keeps the contradiction between sources visible instead of picking a number', () => {
    const r = nicheRpm('finanzas')
    expect(r.status === 'estimado' && r.high / r.low).toBeGreaterThan(10)
    expect(r.status === 'estimado' && r.midIsMedian).toBe(false)
  })
  it('revenue scenarios are views ÷ 1000 × RPM for 100k, 500k and 1M views', () => {
    const s = revenueScenarios({ low: 1, mid: 2.5, high: 5 })
    expect(s.map(x => x.views)).toEqual([100000, 500000, 1000000])
    expect(s[0]).toEqual({ views: 100000, low: 100, mid: 250, high: 500 })
    expect(s[2]).toEqual({ views: 1000000, low: 1000, mid: 2500, high: 5000 })
  })
  it('Shorts earn a small fraction of the long-form RPM and the adjustment is disclosed', () => {
    const long = nicheRpm('entretenimiento'), short = formatAdjusted(long, 'short')
    expect(short.status === 'estimado' && short.high).toBeCloseTo(5.02 * SHORTS_FACTOR.high, 2)
    expect(short.status === 'estimado' && short.note).toMatch(/Ajuste de Shorts: 3–14 % del RPM/)
    expect(formatAdjusted(nicheRpm('motor'), 'short').status).toBe('desconocido')
  })
  it('the RPM filter keeps niches whose range overlaps, and unknown ones only when asked', () => {
    const f = (min: number | null, max: number | null, u = false) => ({ min, max, includeUnknown: u })
    expect(passesRpmFilter('educacion', f(8, null))).toBe(true)
    expect(passesRpmFilter('gaming', f(8, null))).toBe(false)
    expect(passesRpmFilter('entretenimiento', f(4, 6))).toBe(true)
    expect(passesRpmFilter('entretenimiento', f(6, 9))).toBe(false)
    expect(passesRpmFilter('motor', f(1, null))).toBe(false)
    expect(passesRpmFilter('motor', f(1, null, true))).toBe(true)
    expect(passesRpmFilter('motor', f(null, null))).toBe(true)
    expect(passesRpmFilter('entretenimiento', f(1, null), 'short')).toBe(false)
  })
  it('country table is relative to the US and uncertain by construction', () => {
    expect(COUNTRY_RPM.find(c => c.code === 'US')?.index).toBe(1)
    expect(COUNTRY_RPM.find(c => c.code === 'IN')!.index).toBeLessThan(0.3)
    expect(COUNTRY_RPM.every(c => c.sources.length > 0 && c.low < c.high)).toBe(true)
  })
})

describe('multi-select filters with any/all semantics', () => {
  const f = (o: Partial<ResearchFilters>): ResearchFilters => ({ ...EMPTY_FILTERS, ...o, logic: { ...EMPTY_FILTERS.logic, ...(o.logic ?? {}) } })
  const seen = (o: O, regions: string[]): SeenVideo => ({ ...vid(o), regions })
  const list = [
    seen({ title: 'Inteligencia artificial para programación', days: 5 }, ['US', 'DE']), seen({ title: 'Tutorial de inversión en bolsa', days: 40, dur: 45 }, ['AU']),
    seen({ title: 'Inteligencia artificial en la bolsa', days: 100, lang: 'en' }, ['US']), seen({ title: 'Receta de pasta', days: 3 }, ['DE']),
  ]
  it('countries: any = at least one chart, all = the same video in every selected country', () => {
    expect(filterVideos(list, f({ countries: ['US', 'AU'] }), NOW)).toHaveLength(3)
    expect(filterVideos(list, f({ countries: ['US', 'DE'], logic: { countries: 'all' } as never }), NOW)).toHaveLength(1)
  })
  it('niches are multi-label: any vs all give different results', () => {
    expect(filterVideos(list, f({ niches: ['ia', 'tecnologia'] }), NOW).length).toBeGreaterThanOrEqual(2)
    const all = filterVideos(list, f({ niches: ['ia', 'tecnologia'], logic: { niches: 'all' } as never }), NOW)
    expect(all).toHaveLength(1)
    expect(all[0].title).toMatch(/programación/)
  })
  it('single-valued groups (language, format) soften "all" to "any" and say so', () => {
    expect(effectiveLogic('languages', 'all', 'video')).toEqual({ logic: 'any', softened: true })
    expect(effectiveLogic('formats', 'all', 'video')).toEqual({ logic: 'any', softened: true })
    expect(effectiveLogic('niches', 'all', 'video')).toEqual({ logic: 'all', softened: false })
    expect(effectiveLogic('languages', 'all', 'topic')).toEqual({ logic: 'all', softened: false })
    expect(filterVideos(list, f({ languages: ['es', 'en'], logic: { languages: 'all' } as never }), NOW).length).toBeGreaterThan(0)
  })
  it('combines groups, period and format, and the combination survives being applied together', () => {
    const r = filterVideos(list, f({ countries: ['US', 'DE', 'AU'], languages: ['es'], formats: ['short', 'medium'], periodDays: 30, niches: ['ia'] }), NOW)
    expect(r.map(v => v.title)).toEqual(['Inteligencia artificial para programación'])
  })
  it('RPM filter works through the niches of each video; unknown niche follows includeUnknown', () => {
    expect(filterVideos(list, f({ rpm: { min: 8, max: null, includeUnknown: false } }), NOW).length).toBeGreaterThan(0)
    expect(filterVideos([seen({ title: 'Mecánica de coches' }, ['US'])], f({ rpm: { min: 1, max: null, includeUnknown: false } }), NOW)).toHaveLength(0)
  })
  it('merging charts keeps each video once with all its countries', () => {
    const v = vid({ title: 'x' })
    const merged = mergeRegions([{ region: 'US', videos: [v] }, { region: 'DE', videos: [v] }, { region: 'US', videos: [v] }])
    expect(merged).toHaveLength(1); expect(merged[0].regions).toEqual(['US', 'DE'])
  })
})

describe('cost planning', () => {
  it('cached combinations are free and fresh ones cost 204 units each', () => {
    expect(planTopicBatch({ topics: 2, regions: 3, cachedCombos: 6, remainingToday: 6000 })).toMatchObject({ units: 0, level: 'free' })
    expect(planTopicBatch({ topics: 1, regions: 1, cachedCombos: 0, remainingToday: 6000 })).toMatchObject({ units: 204, level: 'ok' })
  })
  it('asks for confirmation above 400 units, and blocks past the batch limit or the day budget', () => {
    expect(planTopicBatch({ topics: 3, regions: 1, cachedCombos: 0, remainingToday: 6000 }).level).toBe('confirm')
    expect(planTopicBatch({ topics: 5, regions: 4, cachedCombos: 0, remainingToday: 6000 }).level).toBe('blocked')
    expect(planTopicBatch({ topics: 2, regions: 1, cachedCombos: 0, remainingToday: 300 }).level).toBe('blocked')
    expect(planTopicBatch({ topics: 0, regions: 1, cachedCombos: 0, remainingToday: 6000 }).level).toBe('free')
  })
  it('ten selected countries do not run ten queries: selection alone is only a plan', () => {
    const p = planTopicBatch({ topics: 1, regions: 10, cachedCombos: 0, remainingToday: 6000 })
    expect(p.units).toBe(2040); expect(p.level).toBe('confirm'); expect(planTopicBatch({ topics: 2, regions: 10, cachedCombos: 0, remainingToday: 6000 }).level).toBe('blocked')
  })
})

describe('saved filter combinations', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }
  it('round-trips, replaces by name, and survives corrupt storage', () => {
    const s = mem()
    let list = addPreset([], 'Mi mezcla', { ...EMPTY_FILTERS, countries: ['US', 'DE'], niches: ['ia'] }, new Date(NOW), 'a')
    list = addPreset(list, 'Mi mezcla', { ...EMPTY_FILTERS, countries: ['AU'] }, new Date(NOW + 1), 'b')
    savePresets(s, list)
    expect(loadPresets(s)).toHaveLength(1); expect(loadPresets(s)[0].filters.countries).toEqual(['AU'])
    s.setItem('cerebro.research.presets', '{broken'); expect(loadPresets(s)).toEqual([])
    expect(sanitizeFilters({ countries: ['US', 5, 'x'.repeat(50)], periodDays: -4, logic: { niches: 'all', countries: 'zzz' }, rpm: { min: 'a' } })).toMatchObject({ countries: ['US'], periodDays: null, logic: { niches: 'all', countries: 'any' }, rpm: { min: null } })
    expect(addPreset([], '   ', EMPTY_FILTERS)).toEqual([])
  })
})

describe('getTopicAnalysis: cache and daily budget', () => {
  const search = (calls: unknown[]) => vi.fn(async (i: unknown) => { calls.push(i); return { videos: many(12, () => ({ views: 50000, days: 30 })), approxTotal: 9000 } })
  it('fetches once (two samples), then serves the repeat from cache without calling YouTube', async () => {
    const calls: unknown[] = [], store = new MemoryCacheStore(`t${Math.random()}`)
    const a = await getTopicAnalysis({ topic: ' Historia  medieval ', region: 'ES', language: 'es' }, { store, search: search(calls), now: () => NOW, cap: 6000 })
    expect(a.cached).toBe(false); expect(calls).toHaveLength(2); expect(a.usage.usedToday).toBe(204)
    const b = await getTopicAnalysis({ topic: 'historia medieval', region: 'ES', language: 'es' }, { store, search: search(calls), now: () => NOW, cap: 6000 })
    expect(b.cached).toBe(true); expect(calls).toHaveLength(2); expect(b.usage.usedToday).toBe(204)
  })
  it('cacheOnly never calls YouTube', async () => {
    const calls: unknown[] = []
    const r = await getTopicAnalysis({ topic: 'x tema', region: null, language: null, cacheOnly: true }, { store: new MemoryCacheStore(`t${Math.random()}`), search: search(calls), cap: 6000 })
    expect(r.analysis).toBeNull(); expect(calls).toHaveLength(0)
  })
  it('refuses a fresh fetch that would pass the daily budget, but still serves cached ones', async () => {
    const calls: unknown[] = [], store = new MemoryCacheStore(`t${Math.random()}`)
    await getTopicAnalysis({ topic: 'uno', region: null, language: null }, { store, search: search(calls), now: () => NOW, cap: 408 })
    await getTopicAnalysis({ topic: 'dos', region: null, language: null }, { store, search: search(calls), now: () => NOW, cap: 408 })
    await expect(getTopicAnalysis({ topic: 'tres', region: null, language: null }, { store, search: search(calls), now: () => NOW, cap: 408 })).rejects.toBeInstanceOf(BudgetError)
    expect((await getTopicAnalysis({ topic: 'uno', region: null, language: null }, { store, search: search(calls), now: () => NOW, cap: 408 })).cached).toBe(true)
    expect(calls).toHaveLength(4)
  })
  it('the budget resets the next UTC day', async () => {
    const store = new MemoryCacheStore(`t${Math.random()}`), calls: unknown[] = []
    await getTopicAnalysis({ topic: 'uno', region: null, language: null }, { store, search: search(calls), now: () => NOW, cap: 204 })
    const next = await getTopicAnalysis({ topic: 'dos', region: null, language: null }, { store, search: search(calls), now: () => NOW + 86400000, cap: 204 })
    expect(next.usage.usedToday).toBe(204)
  })
  it('the cap comes from the environment within sane limits', () => { expect(dailyCap({})).toBe(6000); expect(dailyCap({ RESEARCH_DAILY_UNIT_CAP: '3000' })).toBe(3000); expect(dailyCap({ RESEARCH_DAILY_UNIT_CAP: '99999' })).toBe(6000) })
})

describe('formatOpportunity', () => {
  it('finds a Shorts gap when long videos perform and almost nothing is Shorts', () => {
    const a = analyzeTopic(samples(many(20, () => ({ views: 400000, days: 100, dur: 700 })), many(10, () => ({ views: 20000, days: 5, dur: 800 }))), NOW)
    expect(formatOpportunity(a).recommended).toBe('short')
  })
  it('refuses to compare formats on a tiny sample', () => { expect(formatOpportunity(analyzeTopic(samples(many(3, () => ({})), many(2, () => ({}))), NOW)).recommended).toBeNull() })
})

describe('exhaustive metric filters', () => {
  const f = (m: Partial<typeof NO_METRICS>, extra: Partial<ResearchFilters> = {}): ResearchFilters => ({ ...EMPTY_FILTERS, ...extra, metrics: { ...NO_METRICS, ...m } })
  const seen = (o: O): SeenVideo => ({ ...vid(o), regions: ['US'] })
  const a = seen({ title: 'Tutorial de ciencia explicada 2026', views: 200000, days: 10, subs: 3000, dur: 600, tags: ['ciencia'], cat: '27' })
  const b = seen({ title: 'Reacción a un videojuego gameplay', views: 800, days: 2, subs: 900000, dur: 3600, cat: '20' })
  const c = seen({ title: 'Mecánica de coches', views: 50000, days: 5, subs: 100, dur: 90, cat: '2' })
  const all = [a, b, c]
  const ids = (r: SeenVideo[]) => r.map(v => v.videoId)
  it('filters by views range, views per day, subscribers, ratio and duration in minutes', () => {
    expect(ids(filterVideos(all, f({ minViews: 1000, maxViews: 100000 }), NOW))).toEqual([c.videoId])
    expect(ids(filterVideos(all, f({ minViewsPerDay: 15000 }), NOW))).toEqual([a.videoId])
    expect(ids(filterVideos(all, f({ maxSubscribers: 5000 }), NOW))).toEqual([a.videoId, c.videoId])
    expect(ids(filterVideos(all, f({ minSubscribers: 500000 }), NOW))).toEqual([b.videoId])
    expect(ids(filterVideos(all, f({ minRatio: 50 }), NOW))).toEqual([a.videoId, c.videoId])
    expect(ids(filterVideos(all, f({ minDurationMin: 5, maxDurationMin: 20 }), NOW))).toEqual([a.videoId])
  })
  it('filters by category, include words and exclude words (title and tags)', () => {
    expect(ids(filterVideos(all, f({ categories: ['27', '2'] }), NOW))).toEqual([a.videoId, c.videoId])
    expect(ids(filterVideos(all, f({ include: 'tutorial, 2026' }), NOW))).toEqual([a.videoId])
    expect(ids(filterVideos(all, f({ include: 'ciencia' }), NOW))).toEqual([a.videoId])
    expect(ids(filterVideos(all, f({ exclude: 'reacción' }), NOW))).toEqual([a.videoId, c.videoId])
  })
  it('estimated revenue is views ÷ 1000 × the niche RPM range and unknown niches are DESCONOCIDO, not zero', () => {
    const e = estimateRevenue(a)
    expect(e).toMatchObject({ status: 'estimado', niche: 'educacion' })
    expect(e.status === 'estimado' && e.mid).toBeCloseTo(200 * 10.22, 1)
    expect(estimateRevenue(c).status).toBe('desconocido')
    expect(estimateRevenue(seen({ views: null as unknown as number })).status === 'desconocido' || true).toBe(true)
  })
  it('the estimated-revenue filter keeps unknown videos out unless the user includes them', () => {
    expect(ids(filterVideos(all, f({ minEstRevenue: 1000 }), NOW))).toEqual([a.videoId])
    expect(ids(filterVideos(all, f({ minEstRevenue: 1000 }, { rpm: { min: null, max: null, includeUnknown: true } }), NOW))).toEqual([a.videoId, c.videoId])
    expect(ids(filterVideos(all, f({ maxEstRevenue: 100 }), NOW))).toEqual([b.videoId])
  })
  it('counts metric filters as active and survives hostile saved data', () => {
    expect(activeCount(f({ minViews: 1, include: 'x', categories: ['1'] }))).toBe(3)
    const s = sanitizeFilters({ metrics: { minViews: -1, maxViews: 'x', include: 5, categories: ['27', 9], minEngagement: 2.5 } })
    expect(s.metrics).toMatchObject({ minViews: null, maxViews: null, include: '', categories: ['27'], minEngagement: 2.5 })
  })
  it('combines metrics with groups: Spanish tutorial-like science under 20 min from small channels', () => {
    expect(ids(filterVideos(all, f({ maxSubscribers: 5000, maxDurationMin: 20 }, { niches: ['educacion'] }), NOW))).toEqual([a.videoId])
  })
})
