import { describe, expect, it } from 'vitest'
import { analyzeSource, AnalysisAbortError } from '@/lib/editor/media-analysis'
import { waveformColumns } from '@/lib/editor/waveform'

// A real file: 16-bit PCM WAV, 8 kHz mono, 20 s of low noise with a click every 500 ms. The decoder reads the container itself.
const SR = 8000
function wav(seconds: number, periodMs: number, firstMs = 250, channels = 1) {
  const n = Math.round(seconds * SR), pcm = new Int16Array(n * channels)
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5 }
  for (let i = 0; i < n; i++) for (let ch = 0; ch < channels; ch++) pcm[i * channels + ch] = Math.round(rnd() * 0.02 * 32767)
  for (let t = firstMs; t < seconds * 1000; t += periodMs) { const at = Math.round(t / 1000 * SR); for (let j = 0; j < 120 && at + j < n; j++) pcm[(at + j) * channels] += Math.round(0.9 * Math.exp(-j / 25) * (j % 2 ? -1 : 1) * 32767) }
  const buf = new ArrayBuffer(44 + pcm.byteLength), v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true)
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2 * channels, true); v.setUint16(32, 2 * channels, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.byteLength, true)
  new Int16Array(buf, 44).set(pcm)
  return new Blob([buf], { type: 'audio/wav' })
}

describe('media analysis of a real audio file (streamed and decoded locally)', () => {
  it('measures duration, a real waveform, the beats and the tempo from the file itself', async () => {
    const r = await analyzeSource({ kind: 'blob', blob: wav(20, 500) }, { waveform: { bucketsPerSecond: 50 }, beats: true, rms: { windowMs: 50 } })
    expect(r.hasAudio).toBe(true); expect(r.hasVideo).toBe(false); expect(Math.abs(r.durationMs - 20000)).toBeLessThan(100)
    expect(r.waveform!.peaks.length).toBeGreaterThan(990); expect(r.waveform!.peaks.length).toBeLessThanOrEqual(1001)
    const cols = waveformColumns(r.waveform!, 0, 1000, 50)   // the click at 250 ms is the loud part of the first second
    expect(Math.max(...cols.slice(11, 15))).toBeGreaterThan(0.6); expect(Math.max(...cols.slice(36, 40))).toBeGreaterThan(0.6); expect(Math.max(...cols.slice(20, 30))).toBeLessThan(0.2)
    expect(r.beats!.bpm).toBeGreaterThan(118); expect(r.beats!.bpm).toBeLessThan(122)
    const truth = Array.from({ length: 39 }, (_, i) => 250 + 500 * i)
    expect(truth.filter(t => r.beats!.beatsMs.some(b => Math.abs(b - t) <= 30)).length).toBeGreaterThanOrEqual(36)
    expect(r.rms!.length).toBeGreaterThan(390)
  })
  it('stereo works too', async () => { const r = await analyzeSource({ kind: 'blob', blob: wav(6, 500, 250, 2) }, { waveform: {} }); expect(r.waveform!.peaks.length).toBeGreaterThan(290) })
  it('reports progress and can be cancelled', async () => {
    const seen: number[] = []
    await analyzeSource({ kind: 'blob', blob: wav(8, 500) }, { waveform: {} }, { onProgress: f => seen.push(f) })
    expect(seen.length).toBeGreaterThan(0); expect(seen[seen.length - 1]).toBeGreaterThan(0.8); expect(seen.every((f, i) => i === 0 || f >= seen[i - 1])).toBe(true)
    const ac = new AbortController(); ac.abort()
    await expect(analyzeSource({ kind: 'blob', blob: wav(8, 500) }, { waveform: {} }, { signal: ac.signal })).rejects.toBeInstanceOf(AnalysisAbortError)
  })
  it('a file that is not media fails with a clear message instead of hanging', async () => {
    await expect(analyzeSource({ kind: 'blob', blob: new Blob(['esto no es un audio'], { type: 'audio/wav' }) }, { waveform: {} })).rejects.toThrow()
  })
})
