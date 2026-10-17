import { describe, expect, it, vi } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { MemoryCacheStore, cacheKey } from '@/lib/research/cache'
import { NoBaseAnalysisError, getGrowth, getTopicAnalysis, usableAnalysis } from '@/lib/research/sample'
import { ENGINE_VERSION, analyzeTopic, isCurrentEngine, type TopicAnalysis } from '@/lib/research/topic-analysis'
import { isFresh } from '@/lib/research/markets'

// SIMULATED: fake search function, in-memory store. Nothing reaches YouTube or a database.
const NOW = Date.parse('2026-10-15T12:00:00Z')
let n = 0
const v = (title: string, days: number, views = 20000): YouTubeVideoResult => ({ videoId: `p${++n}`, url: '', title, channelId: `c${n}`, channelTitle: 'C', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: 'es', observed: { views, likes: 1, comments: 1, durationSeconds: 600, channelSubscribers: 5000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / days), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult)
const search = vi.fn(async (input: { order?: string; publishedBeforeDays?: number }) => ({ videos: Array.from({ length: 25 }, (_, i) => v(`tema video ${i}`, input.publishedBeforeDays ? 35 + i : 4 + i)), approxTotal: 100 }))
const mem = () => new MemoryCacheStore(`pp-${++n}-${Math.random()}`)
const analyse = async (store = mem()) => (await getTopicAnalysis({ topic: 'tema', region: null, language: 'es' }, { store, search: search as never, owner: 'o', now: () => NOW })).analysis!

describe('problem 4 — «Medir crecimiento» works even when the server never saw the analysis', () => {
  it('uses the analysis the browser holds when the server cache is empty (another instance, a deploy) and measures growth for one search', async () => {
    const a = await analyse(), fresh = mem(); search.mockClear()
    const r = await getGrowth({ topic: 'tema', region: null, language: 'es', analysis: JSON.parse(JSON.stringify({ ...a, sample: [], topVideos: [] })) }, { store: fresh, search: search as never, owner: 'o', now: () => NOW })
    expect(search).toHaveBeenCalledTimes(1); expect(r.analysis!.growth.previous).toBeTruthy(); expect(await fresh.searchesSince(0)).toBe(1)
  })
  it('without any base analysis it says exactly what to do, in a typed error, and spends nothing', async () => {
    const store = mem(); search.mockClear()
    await expect(getGrowth({ topic: 'tema', region: null, language: 'es' }, { store, search: search as never, owner: 'o', now: () => NOW })).rejects.toBeInstanceOf(NoBaseAnalysisError)
    expect(search).not.toHaveBeenCalled(); expect(await store.unitsSince(0)).toBe(0)
  })
  it('a supplied analysis is only accepted if it is the same research, from the current engine, and complete', async () => {
    const a = await analyse(), req = { topic: 'tema', region: null, language: 'es', recentDays: 30 }
    expect(usableAnalysis(a, req)).toBe(true)
    expect(usableAnalysis({ ...a, engineVersion: ENGINE_VERSION - 1 }, req)).toBe(false)
    expect(usableAnalysis({ ...a, engineVersion: undefined }, req)).toBe(false)
    expect(usableAnalysis({ ...a, topic: 'otro' }, req)).toBe(false)
    expect(usableAnalysis({ ...a, region: 'ES' }, req)).toBe(false)
    expect(usableAnalysis({ ...a, recentDays: 90 }, req)).toBe(false)
    expect(usableAnalysis({ ...a, indices: undefined }, req)).toBe(false)
    expect(usableAnalysis(null, req)).toBe(false); expect(usableAnalysis('x', req)).toBe(false)
  })
  it('a growth measurement is never paid twice for the same analysis', async () => {
    const a = await analyse(), store = mem()
    const first = await getGrowth({ topic: 'tema', region: null, language: 'es', analysis: a }, { store, search: search as never, owner: 'o', now: () => NOW })
    search.mockClear()
    const second = await getGrowth({ topic: 'tema', region: null, language: 'es', analysis: first.analysis }, { store, search: search as never, owner: 'o', now: () => NOW })
    expect(search).not.toHaveBeenCalled(); expect(second.cached).toBe(true)
  })
})

describe('older engines do not contaminate the new ones, and nothing is lost', () => {
  it('every new analysis is stamped with the engine version', async () => { const a = await analyse(); expect(a.engineVersion).toBe(ENGINE_VERSION); expect(isCurrentEngine(a)).toBe(true) })
  it('a cached analysis from an older engine is not served: the cache key carries the engine generation', () => {
    expect(cacheKey('topic', ['tema', null, 'es', '30']).startsWith('v3|')).toBe(true)
  })
  it('an old-engine row sitting in the cache under the previous key generation is ignored and the topic is analysed again', async () => {
    const store = mem(), old = await analyse(mem())
    await store.put(['v2', 'topic', 'tema', '', 'es', '30'].join('|'), 'topic', { ...old, engineVersion: undefined }, 204, 1e9, NOW)
    search.mockClear()
    const r = await getTopicAnalysis({ topic: 'tema', region: null, language: 'es' }, { store, search: search as never, owner: 'o', now: () => NOW })
    expect(r.cached).toBe(false); expect(search).toHaveBeenCalled(); expect(r.analysis!.engineVersion).toBe(ENGINE_VERSION)
  })
  it('an old-engine analysis kept in the browser is never «fresh», so plans re-run it and it never counts as done', async () => {
    const a = await analyse()
    expect(isFresh(a, NOW)).toBe(true)
    expect(isFresh({ ...a, engineVersion: ENGINE_VERSION - 1 } as TopicAnalysis, NOW)).toBe(false)
    expect(isFresh({ ...a, engineVersion: undefined } as TopicAnalysis, NOW)).toBe(false)
  })
  it('growth keeps the engine stamp, so a measured analysis is still current', async () => {
    const a = await analyse(), g = await getGrowth({ topic: 'tema', region: null, language: 'es', analysis: a }, { store: mem(), search: search as never, owner: 'o', now: () => NOW })
    expect(g.analysis!.engineVersion).toBe(ENGINE_VERSION)
  })
  it('re-analysing from the same sample gives the same result (deterministic, so versions can be compared)', async () => {
    const s = { topic: 'tema', region: null, language: 'es', recentDays: 30, top: { videos: Array.from({ length: 12 }, (_, i) => v(`tema video ${i}`, 10 + i)), approxTotal: 5 }, recent: { videos: Array.from({ length: 8 }, (_, i) => v(`tema nuevo ${i}`, 2 + i)), approxTotal: 5 }, fetchedAt: new Date(NOW).toISOString(), units: 204 }
    expect(JSON.stringify(analyzeTopic(s, NOW))).toBe(JSON.stringify(analyzeTopic(s, NOW)))
  })
})
