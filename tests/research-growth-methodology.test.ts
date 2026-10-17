import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { MemoryCacheStore } from '@/lib/research/cache'
import { getGrowth, getTopicAnalysis } from '@/lib/research/sample'
import { ENGINE_VERSION, analyzeTopic, applyGrowth, upgradeAnalysis, type TopicAnalysis, type TopicSamples } from '@/lib/research/topic-analysis'
import { cacheKey } from '@/lib/research/cache'

// SIMULATED. They reproduce the audited artefact (ETF Alemania «×10 al alza») and check that stored older analyses are upgraded for free, or kept apart.
const NOW = Date.parse('2026-10-18T12:00:00Z')
let n = 0
const v = (title: string, days: number, views: number, ch?: string): YouTubeVideoResult => ({ videoId: `g${++n}`, url: `https://www.youtube.com/watch?v=g${n}`, title, channelId: ch ?? `c${n}`, channelTitle: 'Kanal', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: 'de', categoryId: null, description: '', tags: [], channelCountry: null, live: null,
  observed: { views, likes: 1, comments: 1, durationSeconds: 600, channelSubscribers: 20000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / Math.max(days, 1)), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult)
const T = 'ETF Sparplan erklärt'
// Realistic: every video collects most of its views in the first days, so newer videos always show more views PER DAY.
const decay = (days: number, lifetime: number) => Math.round(lifetime * (1 - Math.exp(-days / 6)))
const recentVideos = () => Array.from({ length: 14 }, (_, i) => v(`ETF Sparplan Tutorial ${i}`, 8 + i, decay(8 + i, 30000), `r${i}`))
const olderVideos = () => ({ videos: Array.from({ length: 14 }, (_, i) => v(`ETF Sparplan Anleitung ${i}`, 38 + i, decay(38 + i, 30000), `p${i}`)), approxTotal: 90 })   // SAME lifetime potential: nothing changed
const samples = (): TopicSamples => ({ topic: T, region: 'DE', language: 'de', recentDays: 30, top: { videos: Array.from({ length: 20 }, (_, i) => v(`ETF Sparplan Strategie ${i}`, 120 + i, 90000, `t${i}`)), approxTotal: 900 }, recent: { videos: recentVideos(), approxTotal: 90 }, fetchedAt: new Date(NOW).toISOString(), units: 204 })

describe('P1 — the age of a video cannot create a trend', () => {
  it('identical lifetime potential in both windows: views per day differ by more than 2×, but NO growth is claimed', () => {
    const a = analyzeTopic(samples(), NOW), g = applyGrowth(a, olderVideos(), NOW)
    expect(g.growth.recent.medianVpd! / g.growth.previous!.medianVpd!).toBeGreaterThan(2)       // the old method (threshold ×2 on views per day) called this «al alza»
    expect(g.growth.state).toBe('no_calculable'); expect(g.growth.label).toBeUndefined(); expect(g.indices.growth).toBeNull(); expect(g.growthPct).toBeNull()
    expect(g.reasons.join(' ')).not.toMatch(/al alza|×10/); expect(g.reasons.join(' ')).toMatch(/No concluyente/)
  })
  it('a real rise (newer videos already ahead on total views despite less time) is reported as a hint, with the evidence', () => {
    const a = analyzeTopic({ ...samples(), recent: { videos: Array.from({ length: 14 }, (_, i) => v(`ETF Sparplan Tutorial ${i}`, 8 + i, decay(8 + i, 90000), `r${i}`)), approxTotal: 90 } }, NOW)
    const g = applyGrowth(a, olderVideos(), NOW)
    expect(g.growth.state).toBe('calculable'); expect(g.growth.label).toBe('al alza (posible)'); expect(g.growth.reason).toMatch(/indicio, no una tendencia confirmada/)
  })
  it('the engine no longer produces a «a la baja» label at all', () => {
    const a = analyzeTopic(samples(), NOW)
    for (const life of [3000, 12000, 30000, 200000]) expect(applyGrowth(a, { videos: olderVideos().videos.map(x => ({ ...x, observed: { ...x.observed, views: decay(40, life) } })), approxTotal: 1 }, NOW).growth.label).not.toBe('a la baja')
  })
})

describe('older analyses: never mixed in — engine 6 changed what demand and supply mean', () => {
  const stored = (engineVersion: number): TopicAnalysis => ({ ...analyzeTopic(samples(), NOW), engineVersion })
  it('an analysis from engine 4 or 5 is not upgraded in place (its stored videos lack the channels and text the new numbers need)', () => {
    expect(upgradeAnalysis(stored(4), NOW)).toBeNull(); expect(upgradeAnalysis(stored(5), NOW)).toBeNull(); expect(upgradeAnalysis(stored(ENGINE_VERSION), NOW)).not.toBeNull()
  })
  it('«Medir crecimiento» still works with ONE search on a current analysis and uses the comparable-windows method', async () => {
    const a = analyzeTopic(samples(), NOW); let calls = 0
    const r = await getGrowth({ topic: T, region: 'DE', language: 'de', analysis: a }, { store: new MemoryCacheStore(`gm-${Math.random()}`), search: (async () => { calls++; return olderVideos() }) as never, owner: 'o', now: () => NOW })
    expect(calls).toBe(1); expect(r.analysis!.growth.state).toBe('no_calculable'); expect(r.analysis!.growth.measuredAt).toBeTruthy()
  })
  it('a server cache entry from an older engine is re-analysed (and paid) instead of being served', async () => {
    const store = new MemoryCacheStore(`gm-${Math.random()}`); let calls = 0
    const search = (async () => { calls++; return { videos: recentVideos(), approxTotal: 5 } }) as never
    await store.put(cacheKey('topic', [T, 'DE', 'de', '30']), 'topic', stored(5), 204, 1e9, NOW)
    const redo = await getTopicAnalysis({ topic: T, region: 'DE', language: 'de' }, { store, search, owner: 'o', now: () => NOW })
    expect(redo.cached).toBe(false); expect(calls).toBeGreaterThan(0); expect(redo.analysis!.engineVersion).toBe(ENGINE_VERSION)
  })
})
