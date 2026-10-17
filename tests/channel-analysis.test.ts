import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeChannel, channelSelector } from '@/lib/providers/youtube-data'

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
const day = 86400000

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = 'k'
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/channels?') && url.includes('contentDetails')) return json({ items: [{ id: 'UCxxxxxxxxxxxxxxxxxxxxxx', snippet: { title: 'Canal', customUrl: '@canal', country: 'ES' }, statistics: { subscriberCount: '1000', viewCount: '50000', videoCount: '40' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] })
    if (url.includes('/playlistItems?')) return json({ items: ['video000001', 'video000002', 'video000003', 'video000004'].map(videoId => ({ contentDetails: { videoId } })) })
    if (url.includes('/videos?')) return json({ items: [
      { id: 'video000003', snippet: { channelId: 'c', publishedAt: new Date(Date.now() - 14 * day).toISOString() }, statistics: { viewCount: '100' } },
      { id: 'video000001', snippet: { channelId: 'c', publishedAt: new Date(Date.now() - 0 * day).toISOString() }, statistics: { viewCount: '1000' } },
      { id: 'video000002', snippet: { channelId: 'c', publishedAt: new Date(Date.now() - 7 * day).toISOString() }, statistics: { viewCount: '200' } },
      { id: 'video000004', snippet: { channelId: 'c', publishedAt: new Date(Date.now() - 21 * day).toISOString() }, statistics: { viewCount: '300' } },
    ] })
    if (url.includes('/channels?')) return json({ items: [{ id: 'c', statistics: { subscriberCount: '1000' } }] })
    throw new Error(`unexpected ${url}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('channel analysis', () => {
  it('parses channel URLs, handles and ids', () => {
    expect(channelSelector('@canal')).toEqual({ forHandle: '@canal' })
    expect(channelSelector('https://www.youtube.com/@canal/videos')).toEqual({ forHandle: '@canal' })
    expect(channelSelector('https://youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx')).toEqual({ id: 'UCxxxxxxxxxxxxxxxxxxxxxx' })
    expect(channelSelector('https://example.com/@canal')).toBeNull()
    expect(channelSelector('canal')).toBeNull()
  })

  it('keeps upload order and computes median, average, frequency and outliers', async () => {
    const a = await analyzeChannel('@canal')
    expect(a.videos.map(v => v.videoId)).toEqual(['video000001', 'video000002', 'video000003', 'video000004'])
    expect(a.observed).toMatchObject({ subscribers: 1000, totalViews: 50000, videoCount: 40 })
    expect(a.calculated).toMatchObject({ sampleSize: 4, medianViews: 250, avgViews: 400, outlierIds: ['video000001'] })
    expect(a.calculated.uploadsPerWeek).toBe(1)
  })

  it('rejects unrecognised input before calling the API', async () => {
    await expect(analyzeChannel('nada')).rejects.toMatchObject({ status: 400 })
  })
})
