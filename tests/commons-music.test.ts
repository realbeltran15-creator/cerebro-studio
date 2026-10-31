import { describe, expect, it, vi } from 'vitest'
import { allowedCommonsDownload, commonsLicense, findCommonsMusic, parseCommonsPages } from '@/lib/shorts/commons-music'

const page = (title: string, license: string, over: Record<string, unknown> = {}) => ({
  title: `File:${title}`, pageid: 1,
  imageinfo: [{ url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${title}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}`, mime: 'audio/mpeg', size: 3_000_000, duration: 120,
    extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Kevin MacLeod</a>' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } }, ...over }],
})

describe('commons music', () => {
  it('accepts CC0, public domain and CC BY; rejects NC, ND and SA', () => {
    expect(commonsLicense('CC0 1.0')?.status).toBe('public_domain')
    expect(commonsLicense('Public domain')?.status).toBe('public_domain')
    expect(commonsLicense('CC BY 4.0')?.status).toBe('licensed')
    expect(commonsLicense('CC BY-SA 4.0')).toBeNull()
    expect(commonsLicense('CC BY-NC 3.0')).toBeNull()
    expect(commonsLicense('CC BY-ND 2.0')).toBeNull()
    expect(commonsLicense('All rights reserved')).toBeNull()
  })
  it('only downloads from upload.wikimedia.org over https', () => {
    expect(allowedCommonsDownload('https://upload.wikimedia.org/x.mp3')).toBe(true)
    expect(allowedCommonsDownload('http://upload.wikimedia.org/x.mp3')).toBe(false)
    expect(allowedCommonsDownload('https://evil.example/x.mp3')).toBe(false)
    expect(allowedCommonsDownload('https://u:p@upload.wikimedia.org/x.mp3')).toBe(false)
  })
  it('builds a credited track, prefers MP3, skips wrong duration and unknown licenses', () => {
    const tracks = parseCommonsPages([
      page('a.ogg', 'CC BY 4.0', { mime: 'application/ogg' }),
      page('b.mp3', 'CC BY 4.0'),
      page('c.mp3', 'CC BY-NC 3.0'),
      page('d.mp3', 'CC BY 4.0', { duration: 5 }),
      page('e.pdf', 'CC BY 4.0', { mime: 'application/pdf' }),
    ])
    expect(tracks.map(t => t.title)).toEqual(['b', 'a'])
    expect(tracks[0].author).toBe('Kevin MacLeod')
    expect(tracks[0].attribution).toMatch(/Kevin MacLeod.*Wikimedia Commons.*CC BY 4\.0/)
    expect(tracks[1].mimeType).toBe('audio/ogg')
  })
  it('falls through the searches and returns null when nothing qualifies', async () => {
    const none = vi.fn(async () => new Response(JSON.stringify({ query: { pages: {} } })))
    expect(await findCommonsMusic(none as unknown as typeof fetch)).toBeNull()
    expect(none.mock.calls.length).toBeGreaterThan(1)
    const some = vi.fn(async () => new Response(JSON.stringify({ query: { pages: { 1: page('x.mp3', 'CC0 1.0') } } })))
    expect((await findCommonsMusic(some as unknown as typeof fetch))?.licenseStatus).toBe('public_domain')
    expect(some).toHaveBeenCalledTimes(1)
  })
})
