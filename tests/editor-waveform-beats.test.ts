import { describe, expect, it } from 'vitest'
import { PeakBuilder, waveformColumns, waveformPath } from '@/lib/editor/waveform'
import { OnsetBuilder, detectBeats } from '@/lib/editor/beats'

// SYNTHETIC signals: the algorithms are checked against sounds whose true peaks and beats are known.
const SR = 8000
const noise = (seed: number) => { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5 } }
/** `seconds` of low noise with a short decaying click at every `periodMs` (first at `firstMs`). */
function clicks(seconds: number, periodMs: number, firstMs = 250, amp = 0.9) {
  const n = Math.round(seconds * SR), x = new Float32Array(n), r = noise(7)
  for (let i = 0; i < n; i++) x[i] = r() * 0.02
  for (let t = firstMs; t < seconds * 1000; t += periodMs) {
    const at = Math.round(t / 1000 * SR)
    for (let j = 0; j < 120 && at + j < n; j++) x[at + j] += amp * Math.exp(-j / 25) * (j % 2 ? -1 : 1)
  }
  return x
}
const feed = (x: Float32Array, push: (c: Float32Array[]) => void, chunk = 1000) => { for (let i = 0; i < x.length; i += chunk) push([x.subarray(i, i + chunk)]) }

describe('waveform: real peaks, measured in streaming chunks', () => {
  it('records the loudest sample of each bucket and the duration, whatever the chunk size', () => {
    const x = new Float32Array(SR * 2); x[SR / 2] = 0.5; x[SR + 100] = -1
    for (const chunk of [333, 4096, x.length]) {
      const b = new PeakBuilder(SR, 10); feed(x, c => b.push(c), chunk)
      const w = b.finish()
      expect(w.durationMs).toBe(2000); expect(w.peaks.length).toBe(20)
      expect(w.peaks[5]).toBe(128); expect(w.peaks[10]).toBe(255); expect(w.peaks[0]).toBe(0)
    }
  })
  it('uses the loudest channel, so a sound in only one channel is still drawn', () => {
    const l = new Float32Array(SR), r = new Float32Array(SR); r[10] = 0.8
    const b = new PeakBuilder(SR, 10); b.push([l, r]); expect(b.finish().peaks[0]).toBe(204)
  })
  it('columns condense a window (the trimmed part of an audio clip) and silent/empty windows are zeros', () => {
    const x = new Float32Array(SR * 4); x.fill(0.25, SR * 2, SR * 3)
    const b = new PeakBuilder(SR, 50); b.push([x]); const w = b.finish()
    const c = waveformColumns(w, 0, 4000, 4)
    expect(c[0]).toBe(0); expect(c[2]).toBeCloseTo(0.25, 1); expect(c[3]).toBe(0)
    expect(waveformColumns(w, 2000, 3000, 2).every(v => Math.abs(v - 0.25) < 0.01)).toBe(true)
    expect(waveformColumns(w, 500, 500, 3)).toEqual([0, 0, 0]); expect(waveformColumns(w, 9000, 10000, 2)).toEqual([0, 0])
  })
  it('the path is a closed shape inside the box', () => {
    const p = waveformPath([0, 0.5, 1], 30, 20)
    expect(p.startsWith('M')).toBe(true); expect(p.endsWith('Z')).toBe(true); expect(waveformPath([], 10, 10)).toBe('')
    const ys = [...p.matchAll(/,(-?[\d.]+)/g)].map(m => Number(m[1])); expect(Math.min(...ys)).toBeGreaterThanOrEqual(0); expect(Math.max(...ys)).toBeLessThanOrEqual(20)
  })
})

describe('beats: hits found in the signal, tempo from its regularity', () => {
  const detect = (x: Float32Array) => { const o = new OnsetBuilder(SR); feed(x, c => o.push(c)); return detectBeats(o.finish()) }
  it('finds clicks every 500 ms (120 BPM) within ~25 ms of their true time', () => {
    const r = detect(clicks(20, 500))
    expect(r.bpm).toBeGreaterThan(118); expect(r.bpm).toBeLessThan(122); expect(r.confidence).toBeGreaterThan(0.4)
    const truth = Array.from({ length: 39 }, (_, i) => 250 + 500 * i)
    const hit = truth.filter(t => r.beatsMs.some(b => Math.abs(b - t) <= 25))
    expect(hit.length).toBeGreaterThanOrEqual(36); expect(r.beatsMs.length).toBeLessThanOrEqual(42)
  })
  it('estimates another tempo too (90 BPM)', () => { expect(detect(clicks(20, 667)).bpm).toBeGreaterThan(88); expect(detect(clicks(20, 667)).bpm).toBeLessThan(92) })
  it('plain noise has no pulse: very low confidence and few or no beats', () => {
    const r = new Float32Array(SR * 20), n = noise(3); for (let i = 0; i < r.length; i++) r[i] = n() * 0.3
    const res = detect(r); expect(res.confidence).toBeLessThan(0.25)
  })
  it('silence and tiny inputs return nothing instead of inventing beats', () => {
    expect(detect(new Float32Array(SR * 10))).toMatchObject({ beatsMs: [], bpm: null })
    expect(detect(new Float32Array(100))).toEqual({ beatsMs: [], bpm: null, confidence: 0 })
  })
  it('the result is the same however the audio is chunked', () => {
    const x = clicks(10, 500), a = new OnsetBuilder(SR), b = new OnsetBuilder(SR)
    feed(x, c => a.push(c), 500); feed(x, c => b.push(c), 7919)
    expect(detectBeats(a.finish())).toEqual(detectBeats(b.finish()))
  })
})
