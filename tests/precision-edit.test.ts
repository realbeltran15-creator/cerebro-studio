import { describe, expect, it } from 'vitest'
import { emptyComposition, projectDurationMs, type Clip, type Composition } from '@/lib/editor/composition'
import { rollEdit, slideClip, slipClip, splitEditJL } from '@/lib/editor/precision'

const clip = (o: Partial<Clip> & { id: string }): Clip => ({ sceneId: o.id, position: 1, narration: null, visualAssetId: 'vid1', voiceAssetId: null, durationMs: 3000, motion: 'none', trimInMs: 2000, sourceDurationMs: 20000, ...o } as Clip)
const comp = (...clips: Clip[]): Composition => ({ ...emptyComposition('sb', 'Doc'), clips: clips.map((k, i) => ({ ...k, position: i + 1 })) })

describe('slip', () => {
  it('moves the source window only', () => {
    const c = slipClip(comp(clip({ id: 'a' })), 'a', 500)
    expect(c.clips[0].trimInMs).toBe(2500); expect(c.clips[0].durationMs).toBe(3000)
  })
  it('stays inside the file', () => {
    const c = comp(clip({ id: 'a' }))
    expect(slipClip(c, 'a', -9999).clips[0].trimInMs).toBe(0)
    expect(slipClip(c, 'a', 99999).clips[0].trimInMs).toBe(17000)
  })
})
describe('roll', () => {
  const c = comp(clip({ id: 'a', trimInMs: 0 }), clip({ id: 'b', trimInMs: 4000 }))
  it('moves the cut and keeps the total', () => {
    const r = rollEdit(c, 'a', 500)
    expect(r.clips[0].durationMs).toBe(3500); expect(r.clips[1].durationMs).toBe(2500); expect(r.clips[1].trimInMs).toBe(4500)
    expect(projectDurationMs(r)).toBe(projectDurationMs(c))
  })
  it('limits: next clip keeps its minimum and cannot start before its file', () => {
    expect(rollEdit(c, 'a', 99999).clips[1].durationMs).toBe(1000)
    expect(rollEdit(c, "a", -99999).clips[1].trimInMs).toBe(2000)
  })
  it('does nothing on the last clip', () => { expect(rollEdit(c, 'b', 500)).toBe(c) })
})
describe('slide', () => {
  const c = comp(clip({ id: 'a', trimInMs: 0 }), clip({ id: 'b', trimInMs: 5000 }), clip({ id: 'z', trimInMs: 4000 }))
  it('moves b, keeps its content and compensates neighbours', () => {
    const r = slideClip(c, 'b', 1000)
    expect(r.clips[0].durationMs).toBe(4000); expect(r.clips[1].trimInMs).toBe(5000); expect(r.clips[1].durationMs).toBe(3000)
    expect(r.clips[2].durationMs).toBe(2000); expect(r.clips[2].trimInMs).toBe(5000)
    expect(projectDurationMs(r)).toBe(projectDurationMs(c))
  })
  it('needs both neighbours', () => { expect(slideClip(c, 'a', 500)).toBe(c) })
})
describe('J / L cuts', () => {
  const base = comp(clip({ id: 'a' }), clip({ id: 'b' }))
  const withAudio = { ...base, audioClips: [{ id: 'v', assetId: 'x', kind: 'voice' as const, linkedClipId: 'b', offsetMs: 0, startMs: 0, trimInMs: 800, durationMs: 3000, volume: 1, muted: false }] }
  it('J: the sound of b starts earlier', () => {
    const r = splitEditJL(withAudio, 'b', 'J', 500)
    expect(r.audioClips![0].offsetMs).toBe(-500); expect(r.audioClips![0].trimInMs).toBe(300); expect(r.audioClips![0].durationMs).toBe(3500)
  })
  it('L: the sound of b goes on longer', () => { expect(splitEditJL(withAudio, 'b', 'L', 700).audioClips![0].durationMs).toBe(3700) })
})

import { freezeFrame, splitClip } from '@/lib/editor/timeline'
import { frameAt, videoVoices, type KindOf, type VisualOp } from '@/lib/editor/scene'
import { sourceAt } from '@/lib/editor/reverse'

describe('freeze frame', () => {
  const kindOf: KindOf = () => 'video'
  const base = comp(clip({ id: 'a', trimInMs: 1000, durationMs: 4000 }))
  it('splits and inserts a still clip of 2 s that keeps the total + 2 s', () => {
    const r = freezeFrame(base, 'a', 1500)
    expect(r.clips.map(k => k.durationMs)).toEqual([1500, 2000, 2500])
    expect(r.clips[1].freeze).toBe(true)
    expect(r.clips[1].trimInMs).toBe(2500)
    expect(r.clips[2].trimInMs).toBe(2500)
    expect(projectDurationMs(r)).toBe(projectDurationMs(base) + 2000)
  })
  it('the still clip reads one source time for its whole length and is silent', () => {
    const r = freezeFrame(base, 'a', 1500)
    const f = r.clips[1]
    expect(sourceAt(f, 0)).toBe(2500); expect(sourceAt(f, 1999)).toBe(2500)
    const op = frameAt(r, 1500 + 1000, kindOf).find((o): o is VisualOp => o.type === 'visual')!
    expect(op.sourceMs).toBe(2500); expect(op.reverse).toBe(true)
    expect(videoVoices(r, kindOf).some(v => v.key.includes(f.id))).toBe(false)
  })
  it('near an edge it goes before/after without splitting', () => {
    expect(freezeFrame(base, 'a', 200).clips.map(k => k.durationMs)).toEqual([2000, 4000])
    expect(freezeFrame(base, 'a', 3900).clips.map(k => k.durationMs)).toEqual([4000, 2000])
  })
  it('splitting a frozen clip keeps its frame', () => {
    const f = freezeFrame(base, 'a', 1500).clips[1]
    const s = splitClip({ ...base, clips: [f] }, f.id, 1000)
    expect(s.clips.map(k => k.trimInMs)).toEqual([2500, 2500])
  })
})

import { setSpeedRamp } from '@/lib/editor/timeline'
import { consumedMs } from '@/lib/editor/reverse'
describe('speed ramp', () => {
  const base = comp(clip({ id: 'a', trimInMs: 1000, durationMs: 4000, speed: 1 }))
  const r = setSpeedRamp(base, 'a', 3)
  it('source time follows the integral of a linear speed', () => {
    const k = r.clips[0]
    expect(sourceAt(k, 0)).toBe(1000)
    expect(sourceAt(k, 4000)).toBeCloseTo(1000 + 4000 * 2, 5) // average speed 2
    expect(sourceAt(k, 2000)).toBeCloseTo(1000 + 2000 + (2 * 2000 * 2000) / (2 * 4000), 5)
    expect(consumedMs(k)).toBe(8000)
    // monotonic
    let prev = -1; for (let t = 0; t <= 4000; t += 100) { const v = sourceAt(k, t); expect(v).toBeGreaterThan(prev); prev = v }
  })
  it('uses the frame reader forwards and is silent', () => {
    const kindOf: KindOf = () => 'video'
    const op = frameAt(r, 1000, kindOf).find((o): o is VisualOp => o.type === 'visual')!
    expect(op.reverse).toBe(true); expect(op.forward).toBe(true)
    expect(videoVoices(r, kindOf)).toHaveLength(0)
  })
  it('reverse and freeze clips refuse a ramp; null removes it', () => {
    expect(setSpeedRamp(comp(clip({ id: 'a', reverse: true })), 'a', 2).clips[0].ramp).toBeUndefined()
    expect(setSpeedRamp(r, 'a', null).clips[0].ramp).toBeUndefined()
  })
  it('splitting keeps the curve continuous (same speed and same frame at the cut)', () => {
    const s = splitClip(r, 'a', 1000)
    const [x, y] = s.clips
    expect(x.speed).toBe(1); expect(x.ramp).toBeCloseTo(1.5, 5)
    expect(y.speed).toBeCloseTo(1.5, 5); expect(y.ramp).toBe(3)
    expect(y.trimInMs).toBe(Math.round(sourceAt(r.clips[0], 1000)))
    expect(sourceAt(x, 1000)).toBeCloseTo(sourceAt(y, 0), 0)
    expect(sourceAt(y, 3000)).toBeCloseTo(sourceAt(r.clips[0], 4000), 0)
  })
})
