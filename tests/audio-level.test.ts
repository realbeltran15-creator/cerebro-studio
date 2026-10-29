import { describe, expect, it } from 'vitest'
import { normalizedVolume, peakIn } from '@/lib/editor/audio-level'
const wf = (peaks: number[]) => ({ bucketsPerSecond: 10, durationMs: peaks.length * 100, peaks: Uint8Array.from(peaks) })
describe('normalizar volumen', () => {
  it('lleva el pico del tramo al objetivo', () => {
    const w = wf([10, 20, 100, 30, 255, 40])
    expect(peakIn(w, 0, 300)).toBeCloseTo(100 / 255, 5)
    expect(normalizedVolume(w, 0, 300)).toBe(2)
    expect(normalizedVolume(w, 400, 500)).toBeCloseTo(0.9, 2)
  })
  it('no amplifica silencio ni tramos sin datos', () => {
    expect(normalizedVolume(wf([1, 1, 1]), 0, 300)).toBeNull()
    expect(normalizedVolume(wf([200]), 5000, 6000)).toBeNull()
  })
  it('baja un tramo saturado', () => { expect(normalizedVolume(wf([255, 255]), 0, 200)).toBeCloseTo(0.9, 2) })
})
