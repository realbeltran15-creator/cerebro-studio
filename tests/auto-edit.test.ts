import { describe, expect, it } from 'vitest'
import { autoComposition, defaultAutoEdit, detectShots, findSilences, planSegments, summarize } from '@/lib/editor/auto-edit'

describe('automatic edit', () => {
  it('finds silences relative to the loudest window', () => {
    const rms = [0.5, 0.5, 0.01, 0.01, 0.01, 0.01, 0.5, 0.02, 0.5]
    expect(findSilences(rms, 200, 0.1, 600)).toEqual([{ start: 400, end: 1200 }])
  })
  it('detects shot changes as clear peaks', () => {
    const diffs = [0.01, 0.02, 0.01, 0.6, 0.02, 0.01, 0.02, 0.01, 0.55, 0.01]
    expect(detectShots(diffs, 4, 2)).toEqual([1000, 2250])
  })
  it('removes silences with padding, cuts at shots and splits long takes', () => {
    const seg = planSegments(20000, [{ start: 5000, end: 8000 }], [12000], { ...defaultAutoEdit, maxClipMs: 6000 })
    expect(seg[0]).toEqual({ start: 0, end: 5150, shotStart: false })
    expect(seg[1].start).toBe(7850)
    expect(seg.some(s => s.start === 12000 && s.shotStart)).toBe(true)
    expect(seg.every(s => s.end - s.start <= 6000)).toBe(true)
    const sum = summarize(20000, seg)
    expect(sum.removed).toBe(2700)
  })
  it('keeps short utterances instead of dropping them', () => {
    const seg = planSegments(10000, [{ start: 0, end: 4000 }, { start: 4400, end: 10000 }], [], { ...defaultAutoEdit, paddingMs: 0 })
    expect(seg).toEqual([{ start: 4000, end: 5000, shotStart: false }])
  })
  it('builds clips that play the right part of the source with captions', () => {
    const c = autoComposition({ assetId: 'v1', title: 'Auto', options: defaultAutoEdit, segments: [{ start: 0, end: 3000, shotStart: false }, { start: 5000, end: 9000, shotStart: true }], captions: [{ start: 0, end: 2500, text: 'Hola' }, { start: 5200, end: 6000, text: 'mundo' }] })
    expect(c.clips.map(k => [k.trimInMs, k.durationMs, k.narration])).toEqual([[0, 3000, 'Hola'], [5000, 4000, 'mundo']])
    expect(c.clips[0].transition).toBe('fade')
    expect(c.format).toBe('9:16')
    expect(c.subtitles).toBe(true)
  })
})
