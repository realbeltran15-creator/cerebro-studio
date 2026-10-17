import { describe, expect, it } from 'vitest'
import { COUNTRIES, crossRegionTerms, formatOf, isNeglectedNiche, neglectedNiches, sortVideos } from '@/lib/research/discovery'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

const NOW = Date.parse('2026-10-13T00:00:00Z')
const vid = (id: string, o: { dur?: number | null; views?: number | null; subs?: number | null; lang?: string | null; days?: number; ratio?: number | null; vpd?: number | null; eng?: number | null; title?: string } = {}): YouTubeVideoResult => ({
  videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: o.title ?? id, channelId: 'c', channelTitle: 'C', publishedAt: new Date(NOW - (o.days ?? 5) * 86400000).toISOString(), thumbnailUrl: null,
  declaredLanguage: o.lang === undefined ? 'es' : o.lang,
  observed: { views: o.views === undefined ? 1000 : o.views, likes: null, comments: null, durationSeconds: o.dur === undefined ? 300 : o.dur, channelSubscribers: o.subs === undefined ? 500 : o.subs, fetchedAt: '' },
  calculated: { viewsPerDay: o.vpd ?? null, viewsToSubscribers: o.ratio === undefined ? 2 : o.ratio, engagementRate: o.eng ?? null },
})

describe('format by duration', () => {
  it('buckets exactly at the limits and leaves unknown durations out', () => {
    expect([30, 60, 61, 240, 241, 1200, 1201].map(formatOf)).toEqual(['short', 'short', 'brief', 'brief', 'medium', 'medium', 'long'])
    expect(formatOf(null)).toBeNull()
  })
})

describe('sortVideos (the only sort; filtering lives in the main panel)', () => {
  const list = [vid('a', { dur: 45, views: 9000, subs: 800, ratio: 11, days: 3 }), vid('b', { dur: 900, views: 200000, subs: 2_000_000, ratio: 0.1, days: 40 }), vid('c', { dur: null, views: null, subs: null, ratio: null, days: 90 })]
  it('keeps the API order by default', () => { expect(sortVideos(list, 'api').map(v => v.videoId)).toEqual(['a', 'b', 'c']) })
  it('sorts by the chosen metric, putting missing values last, without mutating the input', () => {
    const before = list.map(v => v.videoId)
    expect(sortVideos(list, 'views').map(v => v.videoId)).toEqual(['b', 'a', 'c'])
    expect(sortVideos(list, 'ratio').map(v => v.videoId)).toEqual(['a', 'b', 'c'])
    expect(sortVideos(list, 'newest').map(v => v.videoId)).toEqual(['a', 'b', 'c'])
    expect(list.map(v => v.videoId)).toEqual(before)
  })
})

describe('neglected niches', () => {
  it('needs a small channel, enough views and a high views/subscribers ratio', () => {
    expect(isNeglectedNiche(vid('x', { subs: 3000, views: 40000, ratio: 13.3 }))).toBe(true)
    expect(isNeglectedNiche(vid('x', { subs: 3000, views: 900, ratio: 13.3 }))).toBe(false)
    expect(isNeglectedNiche(vid('x', { subs: 900_000, views: 4_000_000, ratio: 4.4 }))).toBe(false)
    expect(isNeglectedNiche(vid('x', { subs: 3000, views: 40000, ratio: 1.2 }))).toBe(false)
    expect(isNeglectedNiche(vid('x', { subs: null, views: 40000, ratio: null }))).toBe(false)
  })
  it('lists the best ratio first', () => {
    const r = neglectedNiches([vid('lo', { subs: 5000, views: 20000, ratio: 4 }), vid('hi', { subs: 1000, views: 20000, ratio: 20 }), vid('no', { subs: 1e6, views: 1e7, ratio: 10 })])
    expect(r.map(v => v.videoId)).toEqual(['hi', 'lo'])
  })
})

describe('worldwide signals', () => {
  it('reports terms present in several countries and ignores ones in a single country', () => {
    const terms = crossRegionTerms([
      { region: 'ES', videos: [vid('1', { title: 'Mundial final goles' })] },
      { region: 'MX', videos: [vid('2', { title: 'Mundial resumen' })] },
      { region: 'JP', videos: [vid('3', { title: 'Anime nuevo' })] },
    ])
    expect(terms).toEqual([{ term: 'mundial', regions: ['ES', 'MX'] }])
  })
})

describe('country list', () => {
  it('has unique codes and every continent has at least one country', () => {
    expect(new Set(COUNTRIES.map(c => c.code)).size).toBe(COUNTRIES.length)
    expect(new Set(COUNTRIES.map(c => c.continent)).size).toBe(6)
  })
})
