/**
 * Live, read-only YouTube Data API checks through Cerebro Studio's own code (opt-in:
 * LIVE_YOUTUBE=1 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca-bundle> npx vitest run tests/live/youtube).
 * Public data only; no OAuth, no writes. Quota used: ~102 (one search) + a few units.
 * With a Network Secret the process only needs a non-secret placeholder for the app's "configured" check,
 * and the proxy replaces the x-goog-api-key header (the app never puts the key in the URL).
 */
import { describe, expect, it } from 'vitest'
import { analyzeChannel, searchYouTubeVideos, trendingYouTubeVideos, youtubeCategories, youtubeVideosByIds, YouTubeApiError } from '@/lib/providers/youtube-data'

const live = process.env.LIVE_YOUTUBE === '1'
if (live && !process.env.YOUTUBE_API_KEY?.trim()) process.env.YOUTUBE_API_KEY = 'proxy-injected-placeholder'

describe.skipIf(!live)('YouTube Data API through the real integration (read-only)', () => {
  it('searches videos, separating observed from calculated metrics and de-duplicating', async () => {
    const r = await searchYouTubeVideos({ query: 'documental selva amazónica', maxResults: 10, order: 'viewCount' } as never)
    expect(r.length).toBeGreaterThan(0)
    expect(new Set(r.map(v => v.videoId)).size).toBe(r.length)
    const v = r[0]
    expect(v.url).toBe(`https://www.youtube.com/watch?v=${v.videoId}`)
    expect(typeof v.observed.fetchedAt).toBe('string')
    expect(v.observed.views === null || v.observed.views >= 0).toBe(true)
    expect(v.calculated).toHaveProperty('viewsPerDay')
  }, 60000)

  it('reads trending videos and categories for a region', async () => {
    const [cats, trend] = await Promise.all([youtubeCategories('ES'), trendingYouTubeVideos({ regionCode: 'ES', maxResults: 5 })])
    expect(cats.length).toBeGreaterThan(0)
    expect(trend.length).toBeGreaterThan(0)
  }, 60000)

  it('reads public data of known videos by id and ignores unknown ids', async () => {
    const r = await youtubeVideosByIds(['dQw4w9WgXcQ', 'zzzzzzzzzzz'])
    expect(r.map(v => v.videoId)).toContain('dQw4w9WgXcQ')
    expect(r.find(v => v.videoId === 'dQw4w9WgXcQ')!.observed.views).toBeGreaterThan(0)
  }, 60000)

  it('analyzes a public channel by handle (statistics, median, uploads per week)', async () => {
    const a = await analyzeChannel('@YouTube', 10)
    expect(a.channel.id).toMatch(/^UC/)
    expect(a.observed.subscribers === null || a.observed.subscribers > 0).toBe(true)
    expect(a.calculated.sampleSize).toBeGreaterThan(0)
    expect(a.videos.length).toBe(a.calculated.sampleSize)
  }, 60000)

  it('turns a real API rejection into a typed, explainable error (no secret in the message)', async () => {
    const err = await trendingYouTubeVideos({ regionCode: 'ZZ', maxResults: 1 }).then(() => null, e => e as unknown)
    expect(err).toBeInstanceOf(YouTubeApiError)
    const e = err as YouTubeApiError
    expect(e.status).toBeGreaterThanOrEqual(400)
    expect(e.message.length).toBeGreaterThan(5)
    expect(e.message).not.toMatch(/key=|AIza/i)
  }, 60000)
})
