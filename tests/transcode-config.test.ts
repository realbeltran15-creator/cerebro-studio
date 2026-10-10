import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcodeArgs, transcodeConfigFromEnv } from '@/lib/editor/transcode'

afterEach(() => vi.unstubAllEnvs())

describe('converter configuration', () => {
  it('is off unless a safe URL is configured', () => {
    expect(transcodeConfigFromEnv()).toBeNull()
    for (const bad of ['', 'ftp://x/y', 'http://evil.example/core', 'javascript:alert(1)', 'https://', 'not a url']) { vi.stubEnv('NEXT_PUBLIC_FFMPEG_CORE_BASE_URL', bad); expect(transcodeConfigFromEnv(), bad).toBeNull() }
  })
  it('accepts https and localhost only, trimming trailing slashes', () => {
    vi.stubEnv('NEXT_PUBLIC_FFMPEG_CORE_BASE_URL', 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/')
    expect(transcodeConfigFromEnv()).toEqual({ baseUrl: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm' })
    vi.stubEnv('NEXT_PUBLIC_FFMPEG_CORE_BASE_URL', 'http://127.0.0.1:8801/core')
    expect(transcodeConfigFromEnv()).toEqual({ baseUrl: 'http://127.0.0.1:8801/core' })
  })
  it('builds a re-encode (never a stream copy) to H.264 + AAC with faststart and even dimensions', () => {
    const a = transcodeArgs('in.media', 'out.mp4').join(' ')
    expect(a).toContain('-c:v libx264')
    expect(a).toContain('-c:a aac')
    expect(a).toContain('-pix_fmt yuv420p')
    expect(a).toContain('-movflags +faststart')
    expect(a).toContain('trunc(iw/2)*2')
    expect(a).not.toMatch(/-c(:v)? copy/)
  })
})
