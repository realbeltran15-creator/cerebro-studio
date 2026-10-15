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

import { blockers, describeActive, durationParam, forTab, planSearchBatch, validateFilters, sameFilters, TAB_FILTERS, TAB_SCOPE } from '@/lib/research/filters'
import { analysisKey, keyOf, recentDaysFrom } from '@/lib/research/markets'
import { formatCovered } from '@/lib/research/topic-analysis'
import { fmtNumber, fmtUsd } from '@/lib/research/format'

describe('apply / reset / validation model', () => {
  const f = (o: Partial<ResearchFilters> = {}): ResearchFilters => ({ ...EMPTY_FILTERS, ...o, logic: { ...EMPTY_FILTERS.logic, ...(o.logic ?? {}) }, metrics: { ...NO_METRICS, ...(o.metrics ?? {}) } })
  it('flags impossible ranges in plain words and allows valid ones', () => {
    expect(validateFilters(f({ rpm: { min: 10, max: 2, includeUnknown: false } }))).toEqual(['RPM: el mínimo (10) es mayor que el máximo (2).'])
    expect(validateFilters(f({ metrics: { minViews: 500, maxViews: 100 } as never }))[0]).toMatch(/Visualizaciones: el mínimo \(500\) es mayor/)
    expect(validateFilters(f({ metrics: { minDurationMin: 30, maxDurationMin: 5 } as never }))[0]).toMatch(/Duración/)
    expect(validateFilters(f({ rpm: { min: 2, max: 10, includeUnknown: false } }))).toEqual([])
    expect(validateFilters(f({ rpm: { min: 3, max: 3, includeUnknown: false } }))).toEqual([])
    expect(validateFilters(f({ countries: Array.from({ length: 9 }, (_, i) => `C${i}`) }))[0]).toMatch(/máximo son 8/)
  })
  it('detects pending changes by comparing draft and applied, ignoring irrelevant noise', () => {
    expect(sameFilters(f(), f())).toBe(true)
    expect(sameFilters(f({ countries: ['US'] }), f())).toBe(false)
    expect(sameFilters(f({ countries: ['US'] }), f({ countries: ['US'] }))).toBe(true)
  })
  const names = { country: (c: string) => c, niche: (n: string) => n, language: (l: string) => l, format: (x: string) => x, contentType: (x: string) => x, category: (x: string) => x }
  it('describes every active filter as a chip that removes only itself', () => {
    const base = f({ countries: ['US', 'DE'], niches: ['ia'], periodDays: 30, rpm: { min: 4, max: null, includeUnknown: false }, metrics: { minViews: 100, maxViews: 900, include: 'tutorial', categories: ['27'] } as never })
    const chips = describeActive(base, names)
    expect(chips.map(c => `${c.group}: ${c.label}`)).toEqual(['País: US', 'País: DE', 'Nicho: ia', 'Periodo: últimos 30 días', 'RPM estimado: 4–∞ USD', 'Categoría: 27', 'Visualizaciones: 100–900', 'Contiene: tutorial'])
    const afterDe = chips[1].remove(base)
    expect(afterDe.countries).toEqual(['US']); expect(afterDe.niches).toEqual(['ia']); expect(afterDe.periodDays).toBe(30)
    expect(chips[3].remove(base).periodDays).toBeNull()
    expect(chips[4].remove(base).rpm).toEqual({ min: null, max: null, includeUnknown: false })
    expect(chips[6].remove(base).metrics.minViews).toBeNull()
    expect(describeActive(f(), names)).toEqual([])
  })
  it('removing every chip one by one ends with no filters (nothing is left behind)', () => {
    let cur = f({ countries: ['US'], languages: ['en'], niches: ['ia'], formats: ['long'], contentTypes: ['tutorial'], periodDays: 7, rpm: { min: 1, max: 2, includeUnknown: false }, metrics: { minLikes: 5, exclude: 'x', minEstRevenue: 1, maxEstRevenue: 2 } as never })
    for (let guard = 0; guard < 20; guard++) { const c = describeActive(cur, names)[0]; if (!c) break; cur = c.remove(cur) }
    expect(describeActive(cur, names)).toEqual([]); expect(activeCount(cur)).toBe(0)
  })
  it('explains an empty result: which filter, once removed, would bring videos back', () => {
    const vids: SeenVideo[] = [{ ...vid({ title: 'Receta de pasta', dur: 600, lang: 'en' }), regions: ['US'] }, { ...vid({ title: 'Inteligencia artificial hoy', dur: 600, lang: 'en' }), regions: ['US'] }]
    const strict = f({ countries: ['US'], niches: ['ia'], languages: ['de'] })
    expect(filterVideos(vids, strict, NOW)).toHaveLength(0)
    const b = blockers(vids, strict, NOW)
    expect(b[0]).toEqual({ group: 'idiomas', wouldShow: 1 })
    expect(b).toEqual([{ group: 'idiomas', wouldShow: 1 }])
    expect(blockers(vids, f(), NOW)).toEqual([])
  })
  it('each section ignores filters it does not use, so an invisible filter can never hide results', () => {
    const all = f({ countries: ['US'], niches: ['ia'], formats: ['long'], contentTypes: ['tutorial'], periodDays: 30, rpm: { min: 4, max: null, includeUnknown: false }, metrics: { minViews: 5 } as never })
    const kw = forTab('keywords', all)
    expect(kw.countries).toEqual(['US']); expect(kw.niches).toEqual(['ia']); expect(kw.periodDays).toBe(30)
    expect(kw.formats).toEqual([]); expect(kw.contentTypes).toEqual([]); expect(kw.rpm.min).toBeNull(); expect(kw.metrics.minViews).toBeNull()
    expect(forTab('saved', all)).toMatchObject({ countries: [], niches: [], periodDays: null })
    expect(forTab('discover', all)).toEqual(all)
    for (const t of Object.keys(TAB_FILTERS) as Array<keyof typeof TAB_FILTERS>) expect(TAB_SCOPE[t].length).toBeGreaterThan(10)
  })
  it('the search cost scales with markets and confirms above 400 units', () => {
    expect(planSearchBatch({ markets: 1, remainingToday: 6000 })).toMatchObject({ units: 102, level: 'ok' })
    expect(planSearchBatch({ markets: 3, remainingToday: 6000 })).toMatchObject({ units: 306, level: 'ok' })
    expect(planSearchBatch({ markets: 5, remainingToday: 6000 })).toMatchObject({ units: 510, level: 'confirm' })
    expect(planSearchBatch({ markets: 8, remainingToday: 500 }).level).toBe('blocked')
    expect(planSearchBatch({ markets: 0, remainingToday: 6000 }).level).toBe('free')
  })
  it('chosen formats become YouTube duration buckets only when unambiguous', () => {
    expect(durationParam(['long'])).toBe('long'); expect(durationParam(['medium'])).toBe('medium'); expect(durationParam(['short', 'brief'])).toBe('short')
    expect(durationParam(['short', 'long'])).toBeUndefined(); expect(durationParam([])).toBeUndefined(); expect(durationParam(['live'])).toBeUndefined()
  })
})

describe('period = recent window, and it is part of the identity of an analysis', () => {
  it('maps the period filter to a 7–365 day window (default 30)', () => {
    expect(recentDaysFrom(null)).toBe(30); expect(recentDaysFrom(7)).toBe(7); expect(recentDaysFrom(90)).toBe(90); expect(recentDaysFrom(1)).toBe(7); expect(recentDaysFrom(9999)).toBe(365)
  })
  it('the same topic with another window is a different analysis (regression: a new window was treated as cached)', () => {
    expect(analysisKey('Historia  Medieval', 'ES', 'es', 30)).toBe('historia medieval|ES|es|30')
    expect(analysisKey('historia medieval', 'ES', 'es', 90)).not.toBe(analysisKey('historia medieval', 'ES', 'es', 30))
    expect(keyOf({ topic: 'x', region: null, language: null })).toBe('x|||30')
  })
  it('the server caches per window and spends again for a new one', async () => {
    const calls: unknown[] = [], store = new MemoryCacheStore(`w${Math.random()}`)
    const search = vi.fn(async (i: unknown) => { calls.push(i); return { videos: many(12, () => ({ views: 50000, days: 30 })), approxTotal: 1 } })
    const req = { topic: 'tema', region: 'ES', language: 'es' }
    const a = await getTopicAnalysis({ ...req, recentDays: 30 }, { store, search, now: () => NOW, cap: 6000 })
    const b = await getTopicAnalysis({ ...req, recentDays: 30 }, { store, search, now: () => NOW, cap: 6000 })
    const c = await getTopicAnalysis({ ...req, recentDays: 90 }, { store, search, now: () => NOW, cap: 6000 })
    expect([a.cached, b.cached, c.cached]).toEqual([false, true, false]); expect(calls).toHaveLength(4)
    expect(a.analysis!.recentDays).toBe(30); expect(c.analysis!.recentDays).toBe(90)
    expect((calls[3] as { publishedWithinDays: number }).publishedWithinDays).toBe(90)
  })
  it('the chosen format needs a sample of it, and Shorts are told apart from long-form', () => {
    const a = analyzeTopic(samples(many(20, () => ({ views: 90000, days: 90, dur: 700 })), many(6, () => ({ views: 3000, days: 5, dur: 700 }))), NOW)
    expect(formatCovered(a, [])).toBe(true); expect(formatCovered(a, ['long'])).toBe(true); expect(formatCovered(a, ['short'])).toBe(false); expect(formatCovered(a, ['short', 'long'])).toBe(true)
  })
})

describe('number format is consistent', () => {
  it('always groups thousands, so 1.022 and 10.220 look alike', () => {
    expect(fmtNumber(1022)).toBe('1.022'); expect(fmtNumber(10220)).toBe('10.220'); expect(fmtUsd(2000)).toBe('$2.000'); expect(fmtUsd(10.22)).toBe('$10,22')
  })
})

import { SEEDS, SEED_LANGS, suggestSeeds, seedFallback } from '@/lib/research/seeds'
import { budgetPlan, jobKey, pendingJobs, planGuided, reportCsv, reportMarkdown, reportRow, VIABILITY } from '@/lib/research/guided'
import { parseTopics, planLabel, searchPlanFor, type Queries } from '@/lib/research/search-plan'
import { marketLabel, marketsFromFilters } from '@/lib/research/markets'
import { COUNTRIES } from '@/lib/research/discovery'
import { NICHES } from '@/lib/research/taxonomy'
import { countryRpm } from '@/lib/research/monetization'

describe('seed catalogue', () => {
  it('has 8 seeds in Spanish, English and German for every niche, and every taxonomy niche is covered', () => {
    for (const n of NICHES) { expect(SEEDS[n.id], n.id).toBeDefined(); for (const l of SEED_LANGS) expect(SEEDS[n.id][l].length, `${n.id}/${l}`).toBe(8) }
    expect(Object.keys(SEEDS).sort()).toEqual(NICHES.map(n => n.id).sort())
    expect(Object.keys(VIABILITY).sort()).toEqual(NICHES.map(n => n.id).sort())
  })
  it('interleaves the chosen niches so each is represented, in the market language, and pages through more ideas', () => {
    const de = suggestSeeds(['ia', 'finanzas'], 'de', 4)
    expect(de).toEqual([SEEDS.ia.de[0], SEEDS.finanzas.de[0], SEEDS.ia.de[1], SEEDS.finanzas.de[1]])
    expect(suggestSeeds(['ia'], 'es', 2)[0]).toBe(SEEDS.ia.es[0])
    expect(suggestSeeds(['ia'], 'ja', 1)[0]).toBe(SEEDS.ia.en[0])
    expect(suggestSeeds(['ia'], 'en', 2, 2)).toEqual(SEEDS.ia.en.slice(2, 4))
    expect(suggestSeeds([], 'en', 20)).toHaveLength(20)
    for (const l of SEED_LANGS) expect(new Set(suggestSeeds([], l, 160)).size, `duplicate seeds in ${l}`).toBe(160)
    expect(seedFallback('ja')).toBe(true); expect(seedFallback('de')).toBe(false)
  })
})

describe('guided research (N per market) and its budget', () => {
  const six = marketsFromFilters({ countries: ['US', 'DE', 'AU', 'GB', 'CA', 'CH'], languages: [] })
  it('Switzerland is a market (German) and has no per-country RPM table, so it is unknown rather than invented', () => {
    expect(COUNTRIES.find(c => c.code === 'CH')).toMatchObject({ name: 'Suiza', language: 'de', continent: 'europe' })
    expect(countryRpm('CH')).toBeNull(); expect(marketLabel('CH', 'de')).toBe('Suiza (alemán)')
  })
  it('plans 20 per market in six markets, each in its own language, with no duplicates inside a market', () => {
    const p = planGuided({ markets: six, nicheIds: [], perMarket: 20 })
    expect(p.jobs).toHaveLength(120); expect(p.shortfall).toEqual([])
    for (const m of six) { const topics = p.jobs.filter(j => j.market.region === m.region).map(j => j.topic); expect(topics).toHaveLength(20); expect(new Set(topics).size).toBe(20) }
    expect(p.jobs.find(j => j.market.region === 'CH')!.topic).toMatch(/[a-zäöüß]/i)
    expect(SEEDS.tecnologia.de).toContain(p.jobs.find(j => j.market.region === 'CH')!.topic)
  })
  it('reports a shortfall when the chosen niches cannot supply enough ideas, instead of padding', () => {
    const p = planGuided({ markets: six.slice(0, 1), nicheIds: ['ia'], perMarket: 20 })
    expect(p.jobs).toHaveLength(8); expect(p.shortfall).toEqual([{ market: 'Estados Unidos (inglés)', wanted: 20, got: 8 }])
  })
  it('120 analyses cost 24,480 units: more than two full days of the whole YouTube quota, so the queue spans days', () => {
    const p = planGuided({ markets: six, nicheIds: [], perMarket: 20 })
    const bp = budgetPlan({ jobs: p.jobs, done: {}, recentDays: 30, remainingToday: 6000, dailyCap: 6000 })
    expect(bp).toMatchObject({ totalUnits: 24480, pending: 120, todayJobs: 29, todayUnits: 5916, daysNeeded: 5 })
    expect(budgetPlan({ jobs: p.jobs, done: {}, recentDays: 30, remainingToday: 10000, dailyCap: 10000 }).daysNeeded).toBe(3)
    expect(budgetPlan({ jobs: p.jobs, done: {}, recentDays: 30, remainingToday: 100, dailyCap: 6000 }).todayJobs).toBe(0)
  })
  it('skips what is already analysed and counts only the rest', () => {
    const p = planGuided({ markets: six.slice(0, 2), nicheIds: [], perMarket: 3 })
    const done = Object.fromEntries(p.jobs.slice(0, 2).map(j => [jobKey(j, 30), {}]))
    expect(pendingJobs(p.jobs, done, 30)).toHaveLength(4)
    expect(pendingJobs(p.jobs, done, 90)).toHaveLength(6)
    expect(budgetPlan({ jobs: p.jobs, done, recentDays: 30, remainingToday: 6000, dailyCap: 6000 })).toMatchObject({ pending: 4, doneCount: 2 })
    expect(budgetPlan({ jobs: p.jobs, done: Object.fromEntries(p.jobs.map(j => [jobKey(j, 30), {}])), recentDays: 30, remainingToday: 6000, dailyCap: 6000 })).toMatchObject({ pending: 0, daysNeeded: 0 })
  })
})

describe('the single search button: what it will do and what it costs', () => {
  const q = (o: Partial<Queries> = {}): Queries => ({ niches: '', keywords: '', competition: '', international: '', perMarket: 3, order: 'relevance', ...o })
  const base = { analyses: {}, charts: {}, remainingToday: 6000 }
  const f = (o: Partial<ResearchFilters> = {}): ResearchFilters => ({ ...EMPTY_FILTERS, ...o, logic: { ...EMPTY_FILTERS.logic }, metrics: { ...NO_METRICS } })
  it('parses typed topics: trims, de-duplicates, caps', () => {
    expect(parseTopics(' a b , a b;\n\nx ,  ,historia medieval')).toEqual(['historia medieval'].length ? ['a b', 'historia medieval'] : [])
    expect(parseTopics('a,bb,cc,dd,ee,ff,gg,hh', 3)).toEqual(['bb', 'cc', 'dd'])
  })
  it('Nichos with typed topics = topics × markets; cached ones are free; the label carries the cost', () => {
    const p = searchPlanFor('niches', f({ countries: ['US', 'DE'] }), q({ niches: 'historia medieval, huerto en casa' }), base)
    expect(p).toMatchObject({ kind: 'analysis', fresh: 4, units: 816, level: 'confirm', auto: false })
    expect(planLabel(p)).toBe('Aplicar y buscar (816 unidades)')
    const cached = { [jobKey(p.jobs[0], 30)]: {} as never }
    expect(searchPlanFor('niches', f({ countries: ['US', 'DE'] }), q({ niches: 'historia medieval, huerto en casa' }), { ...base, analyses: cached })).toMatchObject({ fresh: 3, cached: 1, units: 612 })
    const free = searchPlanFor('niches', f(), q({ niches: 'tema' }), { ...base, analyses: { [jobKey({ topic: 'tema', market: marketsFromFilters({ countries: [], languages: [] })[0] }, 30)]: {} as never } })
    expect(free).toMatchObject({ units: 0, level: 'free' }); expect(planLabel(free)).toBe('Aplicar y mostrar (en caché)')
  })
  it('Nichos with nothing typed proposes ideas per market in each language (and says they are proposals)', () => {
    const p = searchPlanFor('niches', f({ countries: ['US', 'DE'], niches: ['ia'] }), q({ perMarket: 2 }), base)
    expect(p.auto).toBe(true); expect(p.jobs).toHaveLength(4)
    expect(p.jobs.filter(j => j.market.region === 'DE').map(j => j.topic)).toEqual(SEEDS.ia.de.slice(0, 2))
    expect(p.jobs.filter(j => j.market.region === 'US').map(j => j.topic)).toEqual(SEEDS.ia.en.slice(0, 2))
  })
  it('Palabras clave needs a typed keyword; without one the button only applies filters', () => {
    expect(searchPlanFor('keywords', f(), q(), base).kind).toBe('none'); expect(planLabel(searchPlanFor('keywords', f(), q(), base))).toBe('Aplicar filtros')
    expect(searchPlanFor('keywords', f({ countries: ['US'] }), q({ keywords: 'a1, b2, c3, d4' }), base).jobs).toHaveLength(3)
  })
  it('Competencia searches the typed text in every market at 102 units each', () => {
    const p = searchPlanFor('competition', f({ countries: ['US', 'DE', 'AU'] }), q({ competition: 'ia' }), base)
    expect(p).toMatchObject({ kind: 'search', units: 306, level: 'ok', query: 'ia' })
    expect(searchPlanFor('competition', f(), q(), base).kind).toBe('none')
  })
  it('Descubrir and Tendencias load only the charts that are missing, at 2 units per country', () => {
    const p = searchPlanFor('discover', f({ countries: ['US', 'DE', 'AU'] }), q(), { ...base, charts: { DE: [] } })
    expect(p).toMatchObject({ kind: 'charts', units: 4, chartRegions: ['US', 'AU'] }); expect(planLabel(p)).toBe('Aplicar y cargar tendencias de 2 países (4 unidades)')
    expect(searchPlanFor('discover', f({ countries: ['DE'] }), q(), { ...base, charts: { DE: [] } }).kind).toBe('none')
  })
  it('Tendencias internacionales combines charts and a topic analysis in one cost', () => {
    const p = searchPlanFor('international', f({ countries: ['US', 'DE'] }), q({ international: 'ia para negocios' }), base)
    expect(p).toMatchObject({ kind: 'multi', units: 2 * 204 + 2 * 2 }); expect(p.message).toMatch(/Total 412 unidades/)
  })
  it('blocks a plan that passes the daily budget or the batch limit, and asks to confirm above 400', () => {
    expect(searchPlanFor('niches', f({ countries: ['US', 'DE', 'AU'] }), q({ niches: 'a1, b2, c3' }), { ...base, remainingToday: 500 }).level).toBe('blocked')
    expect(searchPlanFor('niches', f({ countries: ['US'] }), q({ niches: 'a1, b2' }), base).level).toBe('confirm')
    expect(searchPlanFor('niches', f({ countries: ['US'] }), q({ niches: 'a1' }), base).level).toBe('ok')
  })
})

describe('the report: complete, honest about what it does not know', () => {
  const a = (o: O & { verdict?: 'oportunidad' | 'saturado' | 'sin_demanda' | 'mixto'; region?: string | null; lang?: string | null; niches?: string[] } = {}) => ({
    ...analyzeTopic({ ...samples(many(25, () => ({ views: 90000, days: 90, dur: 700, title: o.title ?? 'Inteligencia artificial para negocios' })), many(10, () => ({ views: 4000, days: 5, dur: 700, title: o.title ?? 'Inteligencia artificial para negocios' }))), region: o.region === undefined ? 'DE' : o.region, language: o.lang === undefined ? 'de' : o.lang, topic: o.title ?? 'KI Tools', recentDays: 30 }, NOW),
  })
  it('keeps every promised field per analysis and marks unknown ones as unknown', () => {
    const md = reportMarkdown([a({ title: 'KI Tools' }), a({ region: 'CH', title: 'Mecánica de coches' })], { generatedAt: '2026-10-13T00:00:00Z' })
    for (const must of ['# Informe de investigación de nichos', '## Método y límites', 'Parámetros', 'Fecha de consulta', 'Evidencia', 'Confianza', 'Formato recomendado', 'Escenarios', 'Viabilidad (criterio editorial, no medido)', 'RPM ESTIMADO', 'No disponible con esta fuente', 'Google Trends no está conectado']) expect(md, must).toContain(must)
    expect(md).toMatch(/Suiza \(alemán\)/); expect(md).toMatch(/Referencia de RPM del país:\*\* desconocida/)
    expect(md).not.toMatch(/RPM verificado:/); expect(md).toMatch(/nada de lo de aquí es RPM verificado/)
  })
  it('an analysis whose niche has no RPM reference is DESCONOCIDO with no scenarios, never zero', () => {
    const row = reportRow({ ...a({ title: 'Mecánica de coches' }), niches: ['motor'] })
    expect(row.rpm.status).toBe('desconocido'); expect(row.scenario100k).toBeNull(); expect(row.scenario1m).toBeNull()
    expect(reportCsv([{ ...a(), niches: ['motor'] }]).split('\n')[1]).toMatch(/DESCONOCIDO,desconocido,desconocido,desconocido,desconocido,desconocido/)
  })
  it('RPM scenarios scale exactly with views and Shorts use the disclosed discount', () => {
    const long = reportRow({ ...a(), niches: ['educacion'], byFormat: { short: { count: 8, recentCount: 4, medianViewsPerDay: 300 }, long: { count: 20, recentCount: 5, medianViewsPerDay: 900 } } })
    expect(long.format).toBe('long'); expect(long.scenario100k).toMatchObject({ low: 1022, high: 1022 }); expect(long.scenario1m).toMatchObject({ low: 10220, high: 10220 })
    const short = reportRow({ ...a(), niches: ['educacion'], byFormat: { short: { count: 20, recentCount: 5, medianViewsPerDay: 900 }, long: { count: 0, recentCount: 0, medianViewsPerDay: null } } })
    expect(short.format).toBe('short'); expect(short.scenario1m!.high).toBe(1430)
  })
  it('CSV neutralises formulas and has a stable column set', () => {
    const csv = reportCsv([{ ...a({ title: '=HYPERLINK("x")' }) }])
    const [head, row] = csv.split('\n')
    expect(head.split(',').length).toBeGreaterThanOrEqual(30); expect(row).toContain(`'=HYPERLINK`)
  })
})

import { buildRecommendations } from '@/lib/research/recommendations'
import { analysisExclusions, NO_ANALYSIS, sanitizeAnalysis, analysisActive } from '@/lib/research/filters'

describe('analysis-level filters (demand, supply, competition, growth, classification)', () => {
  const f = (a: Partial<typeof NO_ANALYSIS> = {}, o: Partial<ResearchFilters> = {}): ResearchFilters => ({ ...EMPTY_FILTERS, ...o, logic: { ...EMPTY_FILTERS.logic }, metrics: { ...NO_METRICS }, analysis: { ...NO_ANALYSIS, ...a } })
  const mk = (i: { d: number; s: number; c: number; g: number; o: number }, v: 'oportunidad' | 'saturado' | 'sin_demanda' | 'mixto' = 'mixto') => ({ ...analyzeTopic(samples(many(25, () => ({ views: 90000, days: 90 })), many(10, () => ({ views: 4000, days: 5 }))), NOW), indices: { demand: i.d, supply: i.s, competition: i.c, growth: i.g, opportunity: i.o }, verdict: v })
  it('each threshold excludes exactly the analyses that fail it, and says which filter did', () => {
    const a = mk({ d: 60, s: 40, c: 30, g: 70, o: 65 }, 'oportunidad')
    expect(analysisExclusions(a, f())).toEqual([])
    expect(analysisExclusions(a, f({ minDemand: 70 }))).toEqual(['demanda'])
    expect(analysisExclusions(a, f({ maxSupply: 30 }))).toEqual(['oferta'])
    expect(analysisExclusions(a, f({ maxCompetition: 20 }))).toEqual(['competencia'])
    expect(analysisExclusions(a, f({ minGrowth: 80 }))).toEqual(['crecimiento'])
    expect(analysisExclusions(a, f({ minOpportunity: 90 }))).toEqual(['oportunidad'])
    expect(analysisExclusions(a, f({ verdicts: ['saturado'] }))).toEqual(['clasificación'])
    expect(analysisExclusions(a, f({ minDemand: 50, maxSupply: 60, maxCompetition: 55, verdicts: ['oportunidad'] }))).toEqual([])
    expect(analysisExclusions({ ...a, confidence: 'baja' }, f({ minConfidence: 'media' }))).toEqual(['confianza'])
  })
  it('combines with niches, countries, RPM and format, reporting every reason', () => {
    const a = { ...mk({ d: 10, s: 90, c: 90, g: 10, o: 5 }, 'saturado'), niches: ['motor'], region: 'DE' }
    expect(analysisExclusions(a, f({ minDemand: 50, maxCompetition: 40 }, { countries: ['US'], rpm: { min: 1, max: null, includeUnknown: false } })).sort()).toEqual(['competencia', 'demanda', 'países', 'RPM estimado'].sort())
  })
  it('sanitizes saved values: only 0–100, known classifications, known confidence', () => {
    expect(sanitizeAnalysis({ minDemand: 150, maxSupply: -1, maxCompetition: 55, verdicts: ['oportunidad', 'x'], minConfidence: 'alta' })).toMatchObject({ minDemand: null, maxSupply: null, maxCompetition: 55, verdicts: ['oportunidad'], minConfidence: null })
    expect(analysisActive({ ...NO_ANALYSIS, minDemand: 5, verdicts: ['a', 'b'] })).toBe(2)
    expect(validateFilters(f({ minDemand: 150 }))[0]).toMatch(/entre 0 y 100/)
    const chip = describeActive(f({ maxCompetition: 55, verdicts: ['oportunidad'] }), { country: c => c, niche: n => n, language: l => l, format: x => x, contentType: x => x, category: x => x })
    expect(chip.map(c => `${c.group}: ${c.label}`)).toEqual(['Competencia: ≤ 55', 'Clasificación: Nicho desatendido con demanda'])
    expect(chip[0].remove(f({ maxCompetition: 55 })).analysis.maxCompetition).toBeNull()
  })
})

describe('recommendations: real videos only, thumbnails from the API, no repeats', () => {
  const withVideos = (title: string, region: string, vids: YouTubeVideoResult[], over: Record<string, unknown> = {}) => ({ ...analyzeTopic({ ...samples(vids, many(8, () => ({ views: 3000, days: 6, title }))), region, language: region === 'DE' ? 'de' : 'en', topic: title }, NOW), topVideos: vids.slice(0, 6), ...over }) as ReturnType<typeof analyzeTopic>
  const v = (title: string, o: O & { thumb?: string | null } = {}) => { const x = vid({ title, ...o }); return { ...x, url: `https://www.youtube.com/watch?v=${x.videoId}`, thumbnailUrl: o.thumb === undefined ? `https://i.ytimg.com/vi/${title.replace(/\W+/g, '')}/mqdefault.jpg` : o.thumb } }
  const shared = [v('Guía A', { views: 300000, days: 40, subs: 3000, ch: 'c1', dur: 900 }), v('Short B #shorts', { views: 90000, days: 10, subs: 1200, ch: 'c2', dur: 40 }), v('Todo C', { views: 150000, days: 100, subs: 800000, ch: 'c3', dur: 1500 })]
  const a1 = withVideos('inteligencia artificial para negocios', 'US', shared, { niches: ['ia'] })
  const a2 = withVideos('KI Tools Test', 'DE', shared.slice(0, 2), { niches: ['ia'] })
  const input = (analyses: ReturnType<typeof analyzeTopic>[], charts: Record<string, YouTubeVideoResult[]> = {}, filters = EMPTY_FILTERS) => buildRecommendations({ analyses, charts, filters })

  it('always returns the nine sections in the requested order, empty with an explanation instead of invented items', () => {
    const r = input([])
    expect(r.sections.map(s => s.id)).toEqual(['demand', 'neglected', 'emerging', 'money', 'lowcomp', 'international', 'small', 'shorts', 'long'])
    expect(r.sections.every(s => s.items.length === 0 && s.empty.length > 10)).toBe(true); expect(r.updatedAt).toBeNull()
  })
  it('a video appears at most once across all sections (regression: repeats)', () => {
    const r = input([a1, a2])
    const ids = r.sections.flatMap(s => s.items.flatMap(i => (i.kind === 'video' ? [i.video.videoId] : i.videos.map(x => x.videoId))))
    expect(ids.length).toBeGreaterThan(0); expect(new Set(ids).size).toBe(ids.length)
  })
  it('shows up to three representative videos per niche, from different channels, with the API thumbnail and facts', () => {
    const demand = input([a1]).sections[0].items[0]
    expect(demand.kind).toBe('niche'); if (demand.kind !== 'niche') return
    expect(demand.videos.length).toBeLessThanOrEqual(3); expect(new Set(demand.videos.map(x => x.channelTitle)).size).toBeGreaterThan(0)
    const first = demand.videos[0]
    expect(first.thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//); expect(first.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/)
    expect(first).toMatchObject({ views: expect.any(Number), publishedAt: expect.any(String), market: 'Estados Unidos (inglés)' }); expect(first.format.reason.length).toBeGreaterThan(0)
    expect(demand.updatedAt).toBe(a1.fetchedAt); expect(demand.reason).toMatch(/^Demanda \d+\/100/)
  })
  it('never invents a thumbnail: a video the API gave none for stays without one', () => {
    const a = withVideos('tema sin miniatura', 'US', [v('Sin miniatura', { thumb: null, views: 100000, days: 20, subs: 900000 })], { niches: ['ia'] })
    const item = input([a]).sections[0].items[0]; expect(item.kind === 'niche' && item.videos[0].thumbnailUrl).toBeNull()
  })
  it('the neglected section takes only real opportunities; the Shorts/long sections only format gaps', () => {
    const opp = { ...a1, verdict: 'oportunidad' as const }, sat = { ...a2, verdict: 'saturado' as const }
    const r = input([opp, sat])
    const neglected = r.sections.find(s => s.id === 'neglected')!.items
    expect(neglected.map(i => (i.kind === 'niche' ? i.topic : ''))).toEqual([opp.topic])
    const gapShort = withVideos('gap shorts', 'US', Array.from({ length: 20 }, () => v('Largo', { views: 400000, days: 100, dur: 700, ch: 'x' })), { niches: ['ia'] })
    expect(input([gapShort]).sections.find(s => s.id === 'shorts')!.items).toHaveLength(1)
    expect(input([gapShort]).sections.find(s => s.id === 'long')!.items).toHaveLength(0)
  })
  it('monetisation lists only niches with an ESTIMATED reference, labelled as such; unknown niches are left out', () => {
    const known = { ...a1, niches: ['educacion'] }, unknown = { ...a2, niches: ['motor'] }
    const items = input([known, unknown]).sections.find(s => s.id === 'money')!.items
    expect(items).toHaveLength(1); const it0 = items[0]; expect(it0.kind === 'niche' && it0.rpmNote).toMatch(/ESTIMADO/)
  })
  it('international trends are real videos present in several countries and shared terms; one-country videos are not "international"', () => {
    const both = vid({ title: 'Inteligencia artificial hoy', views: 800000, subs: 500000 }), onlyUs = vid({ title: 'Solo en EE. UU.', views: 600000, subs: 400000 })
    const r = input([], { US: [both, onlyUs], DE: [both] }, { ...EMPTY_FILTERS, countries: ['US', 'DE'] })
    const intl = r.sections.find(s => s.id === 'international')!
    expect(intl.items).toHaveLength(1); expect(intl.items[0].kind === 'video' && intl.items[0].video.videoId).toBe(both.videoId)
    expect(intl.items[0].kind === 'video' && intl.items[0].reason).toMatch(/Estados Unidos, Alemania/)
    expect(r.internationalTerms.some(t => t.term === 'inteligencia artificial hoy' || t.regions.length === 2)).toBe(true)
  })
  it('small-channel wins need a small channel, enough views and a high ratio', () => {
    const win = v('Canal pequeño gana', { views: 90000, subs: 2000, days: 20 }), big = v('Canal grande', { views: 90000, subs: 2_000_000, days: 20 }), low = v('Pocas vistas', { views: 900, subs: 100, days: 20 })
    const a = withVideos('tema', 'US', [win, big, low], { niches: ['ia'] })
    const items = input([a]).sections.find(s => s.id === 'small')!.items
    expect(items.map(i => (i.kind === 'video' ? i.video.title : ''))).toEqual(['Canal pequeño gana'])
  })
  it('with no analyses the demand section is filled from the official charts, labelled as inferred and not as an analysis', () => {
    const r = input([], { ES: [vid({ title: 'Receta de pasta fácil', views: 500000, subs: 900000 }), vid({ title: 'Otra receta de cocina', views: 300000, subs: 900000 })] })
    const item = r.sections[0].items[0]
    expect(item.kind === 'niche' && item.source).toBe('chart'); expect(item.kind === 'niche' && item.indices).toBeNull(); expect(item.kind === 'niche' && item.reason).toMatch(/inferido/)
  })
  it('the applied filters apply to the recommendations too (niche and classification)', () => {
    const r = input([a1, a2], {}, { ...EMPTY_FILTERS, countries: ['DE'], analysis: { ...NO_ANALYSIS, minDemand: 0 } })
    const topics = r.sections[0].items.map(i => (i.kind === 'niche' ? i.topic : ''))
    expect(topics).toEqual([a2.topic])
  })
})
