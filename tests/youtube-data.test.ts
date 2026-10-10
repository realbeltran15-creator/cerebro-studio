import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseIsoDuration, searchYouTubeVideos, trendingYouTubeVideos, youtubeCategories, youtubeVideoId } from '@/lib/providers/youtube-data'
import { recurringTerms } from '@/lib/radar'

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
let calls: string[] = []
let headers: Array<Record<string, string>> = []

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = 'k'
  calls = []
  headers = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input); calls.push(url); headers.push((init?.headers ?? {}) as Record<string, string>)
    if (url.includes('/search?')) return json({ items: [{ id: { videoId: 'b' } }, { id: { videoId: 'a' } }] })
    if (url.includes('chart=mostPopular')) {
      if (url.includes('videoCategoryId=99')) return json({ error: { errors: [{ reason: 'notFound' }] } }, 404)
      return json({ items: [{ id: 't1', snippet: { title: 'T', channelId: 'c1', publishedAt: new Date(Date.now() - 2 * 86400000).toISOString() }, statistics: { viewCount: '2000' } }] })
    }
    if (url.includes('/videos?')) return json({ items: [
      { id: 'a', snippet: { title: 'A', channelId: 'c1' }, statistics: { viewCount: '1000', likeCount: '50', commentCount: '10' }, contentDetails: { duration: 'PT1H2M3S' } },
      { id: 'b', snippet: { title: 'B', channelId: 'c2' }, statistics: {} },
    ] })
    if (url.includes('/channels?')) return json({ items: [{ id: 'c1', statistics: { subscriberCount: '1000' } }, { id: 'c2', statistics: { hiddenSubscriberCount: true } }] })
    if (url.includes('/videoCategories?')) return json({ items: [{ id: '1', snippet: { title: 'Cine', assignable: true } }, { id: '2', snippet: { title: 'X', assignable: false } }] })
    throw new Error(`unexpected ${url}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('YouTube Data API adapter', () => {
  it('sends the key in the x-goog-api-key header and never in the URL', async () => {
    await youtubeCategories('ES')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every(u => !/[?&]key=/.test(u))).toBe(true)
    expect(headers.every(h => h['x-goog-api-key'] === 'k')).toBe(true)
  })
  it('keeps search order and separates observed from calculated metrics', async () => {
    const r = await searchYouTubeVideos({ query: 'q', order: 'viewCount', regionCode: 'ES', publishedWithinDays: 30 })
    expect(r.map(v => v.videoId)).toEqual(['b', 'a'])
    expect(r[1].observed.durationSeconds).toBe(3723)
    expect(r[1].calculated.viewsToSubscribers).toBe(1)
    expect(r[1].calculated.engagementRate).toBe(6)
    expect(r[0].observed.channelSubscribers).toBeNull()
    expect(calls[0]).toMatch(/regionCode=ES/)
    expect(calls[0]).toMatch(/publishedAfter=/)
  })

  it('reads the trending chart and surfaces API errors with their status', async () => {
    const t = await trendingYouTubeVideos({ regionCode: 'ES' })
    expect(t[0].calculated.viewsPerDay).toBe(1000)
    await expect(trendingYouTubeVideos({ regionCode: 'ES', categoryId: '99' })).rejects.toMatchObject({ status: 404 })
  })

  it('lists only assignable categories', async () => {
    expect(await youtubeCategories('ES')).toEqual([{ id: '1', title: 'Cine' }])
  })

  it('refuses to run without a key', async () => {
    delete process.env.YOUTUBE_API_KEY
    await expect(searchYouTubeVideos({ query: 'q' })).rejects.toMatchObject({ status: 503 })
  })
})

describe('helpers', () => {
  it('parses durations and video ids', () => {
    expect(parseIsoDuration('PT45S')).toBe(45)
    expect(parseIsoDuration('bad')).toBeNull()
    expect(['https://www.youtube.com/watch?v=abcdefghijk', 'https://youtu.be/abcdefghijk?t=3', 'https://youtube.com/shorts/abcdefghijk', 'https://vimeo.com/1', 'bad'].map(youtubeVideoId))
      .toEqual(['abcdefghijk', 'abcdefghijk', 'abcdefghijk', null, null])
  })

  it('counts recurring title terms, ignoring stopwords', () => {
    expect(recurringTerms(['Supervivencia en los Andes: la historia', 'La historia real de supervivencia', 'Andes 1972 | Official Trailer', 'Nada que ver']))
      .toEqual([{ term: 'andes', titles: 2 }, { term: 'historia', titles: 2 }, { term: 'supervivencia', titles: 2 }])
  })
})
