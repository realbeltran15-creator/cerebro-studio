import { describe, it, expect } from 'vitest'
import { createFrameQuality, fidelityWarning, LATE_GAP_MS, WORK_LIMIT_MS } from '@/lib/editor/frame-quality'

const run = (times: number[]) => { const q = createFrameQuality(30); times.forEach(t => q.push(t)); return q.summary() }
const steady = (n: number, step: number, start = 0) => Array.from({ length: n }, (_, i) => start + i * step)

describe('real-time export fidelity meter', () => {
  it('a steady 60 Hz run is not degraded and has no late frames', () => {
    const s = run(steady(600, 1000 / 60))
    expect(s.frames).toBe(600); expect(s.lateFrames).toBe(0); expect(s.droppedEstimate).toBe(0); expect(s.degraded).toBe(false)
  })
  it('a steady 30 fps run is not degraded', () => { expect(run(steady(300, 1000 / 30)).degraded).toBe(false) })
  it('a single visible hitch is enough to flag the export (it can change the picture mid-transition)', () => {
    const t = [...steady(100, 16.7), 1670 + 120, ...steady(100, 16.7, 1670 + 120 + 16.7)]
    const s = run(t); expect(s.lateFrames).toBe(1); expect(s.degraded).toBe(true)
  })
  it('jitter below the threshold (frames up to 80 ms apart) is not a hitch', () => {
    const s = run([0, 16, 50, 100, 170, 250]); expect(s.lateFrames).toBe(0); expect(s.degraded).toBe(false)
  })
  it('several hitches are all counted and flag the export as degraded', () => {
    let t = 0; const times: number[] = []
    for (let i = 0; i < 4; i++) { for (let k = 0; k < 20; k++) { times.push(t); t += 16.7 } t += 100 } // 4 runs of frames, 3 hitches between them
    const s = run(times); expect(s.lateFrames).toBe(3); expect(s.degraded).toBe(true); expect(s.droppedEstimate).toBeGreaterThanOrEqual(3)
  })
  it('a single freeze of a quarter of a second flags it', () => {
    const s = run([0, 16, 32, 300, 316]); expect(s.maxGapMs).toBeGreaterThanOrEqual(250); expect(s.degraded).toBe(true)
  })
  it('gap exactly at the threshold is not late; just above is', () => {
    expect(run([0, LATE_GAP_MS]).lateFrames).toBe(0); expect(run([0, LATE_GAP_MS + 1]).lateFrames).toBe(1)
  })
  it('estimates the frames not drawn from the gap and the target rate', () => {
    const s = run([0, 16, 16 + 200]); expect(s.droppedEstimate).toBe(5) // 200 ms at 30 fps = 6 periods, 5 of them missing
  })
  it('the warning is empty when fine and names the hitches and the fast mode when degraded', () => {
    expect(fidelityWarning(run(steady(60, 16.7)))).toBe(''); expect(fidelityWarning(null)).toBe(''); expect(fidelityWarning(undefined)).toBe('')
    const w = fidelityWarning(run([0, 16, 32, 300, 316])); expect(w).toMatch(/modo rápido/); expect(w).toMatch(/saltos/)
  })
  it('frames that take longer than the work limit to hand over flag the export even with no gaps (the picture lags the project time)', () => {
    const q = createFrameQuality(30); steady(100, 16.7).forEach((t, i) => q.push(t, i === 50 ? WORK_LIMIT_MS + 5 : 12))
    const s = q.summary(); expect(s.lateFrames).toBe(0); expect(s.slowFrames).toBe(1); expect(s.maxWorkMs).toBe(WORK_LIMIT_MS + 5); expect(s.degraded).toBe(true)
  })
  it('normal per-frame work (measured 16-22 ms on a clean machine) is not flagged', () => {
    const q = createFrameQuality(30); steady(300, 16.7).forEach(t => q.push(t, 22)); expect(q.summary().degraded).toBe(false)
  })
  it('an empty or single-frame run is safe', () => { expect(run([]).degraded).toBe(false); expect(run([5]).frames).toBe(1) })
})
