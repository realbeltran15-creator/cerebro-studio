import { describe, expect, it } from 'vitest'
import { emptyComposition, parseComposition } from '@/lib/editor/composition'
import { addClip, updateClip } from '@/lib/editor/timeline'
import { frameAt, transitionWindow, videoVoices } from '@/lib/editor/scene'
import { transitionHandles } from '@/lib/editor/transition-window'

const kindOf = () => 'video' as const
type V = { slot: string; alpha: number; live: boolean; sourceMs: number; volume: number }
const vis = (c: ReturnType<typeof montage>, t: number) => frameAt(c, t, kindOf).filter(o => o.type === 'visual') as unknown as V[]

/** A (4 s) + B (4 s) of two different files, a linear dissolve of `ms` aligned as asked. A's file is 10 s long, B starts at 2 s of its file. */
function montage(align: 'before' | 'center' | 'after' | undefined, ms = 1000, extra: Record<string, unknown> = {}) {
  let c = { ...emptyComposition('t', 't'), fadeMs: 300, duckMusic: false }
  c = addClip(c, 'a', 4000); c = addClip(c, 'b', 4000)
  c = updateClip(c, c.clips[0].id, { sourceDurationMs: 10000, trimInMs: 0 })
  c = updateClip(c, c.clips[1].id, { trimInMs: 2000, sourceDurationMs: 10000 })
  return updateClip(c, c.clips[0].id, { transition: 'dissolve', transitionMs: ms, transitionOpts: { easing: 'linear', ...(align ? { align } : {}) }, ...extra })
}

describe('a transition belongs to the cut: both clips take part, around the cut', () => {
  it('windows: before ends at the cut, center is split, after starts at it', () => {
    expect(transitionWindow(montage('before'), 0)).toEqual({ ms: 1000, pre: 1000, post: 0 })
    expect(transitionWindow(montage(undefined), 0)).toEqual({ ms: 1000, pre: 1000, post: 0 })   // montages made before alignment existed
    expect(transitionWindow(montage('center'), 0)).toEqual({ ms: 1000, pre: 500, post: 500 })
    expect(transitionWindow(montage('after'), 0)).toEqual({ ms: 1000, pre: 0, post: 1000 })
  })
  it('centered dissolve: A fades out while B fades in, 50 / 50 exactly at the cut, nothing before or after the window', () => {
    const c = montage('center')
    expect(vis(c, 3400)).toHaveLength(1)                  // before the window: only A
    expect(vis(c, 4600)).toHaveLength(1)                  // after the window: only B
    const first = vis(c, 3510), mid = vis(c, 4000), last = vis(c, 4490)
    expect(first).toHaveLength(2); expect(first[1].alpha).toBeLessThan(0.02)       // first frame: all A
    expect(mid[0].alpha).toBeCloseTo(1, 5); expect(mid[1].alpha).toBeCloseTo(0.5, 2)  // middle: A under, B at half (cross dissolve)
    expect(last[1].alpha).toBeGreaterThan(0.98)                                    // last frame: all B
  })
  it('uses real material from both files: A plays on past its end, B plays from before its start', () => {
    const c = montage('center')
    const [a, b] = vis(c, 4250)                            // 250 ms after the cut
    expect(a.live).toBe(true); expect(a.sourceMs).toBeCloseTo(4250, 0)   // A's file continues (it has 6 s more)
    expect(b.live).toBe(true); expect(b.sourceMs).toBeCloseTo(2250, 0)
    const [a2, b2] = vis(c, 3750)                          // 250 ms before the cut
    expect(a2.sourceMs).toBeCloseTo(3750, 0); expect(b2.live).toBe(true); expect(b2.sourceMs).toBeCloseTo(1750, 0)   // B's file before its in-point
  })
  it('where a file has no material the frame is held (and transitionHandles says how much is missing)', () => {
    let c = montage('center')
    c = updateClip(c, c.clips[0].id, { sourceDurationMs: 4000 })        // A's file ends exactly at its out-point
    c = updateClip(c, c.clips[1].id, { trimInMs: 200 })                 // B only has 200 ms before its start
    const [a, b] = vis(c, 4250)
    expect(a.live).toBe(false); expect(a.volume).toBe(0)
    expect(b.live).toBe(true)
    expect(vis(c, 3600)[1].live).toBe(false)                           // 400 ms before the cut: B has only 200 ms
    expect(vis(c, 3850)[1].live).toBe(true)
    const h = transitionHandles(c, 0, kindOf)
    expect(h.missingA).toBe(500); expect(h.missingB).toBe(300)
    expect(h.maxCoveredMs).toBe(0)                                    // A has no material after its end: a centered window cannot be covered
    expect(transitionHandles(updateClip(c, c.clips[0].id, { sourceDurationMs: 4300 }), 0, kindOf).maxCoveredMs).toBe(400)   // B's 200 ms before its start cover 400 ms centered
    expect(transitionHandles(montage('center'), 0, kindOf)).toMatchObject({ missingA: 0, missingB: 0 })
  })
  it('images always have material; an unknown file length is reported', () => {
    const img = () => 'image' as const
    const c = montage('center')
    expect(transitionHandles(c, 0, img)).toMatchObject({ missingA: 0, missingB: 0 })
    expect(transitionHandles(updateClip(c, c.clips[0].id, { sourceDurationMs: undefined }), 0, kindOf)).toMatchObject({ missingA: 500, unknown: true })
  })
  it('does not move clips or change the project length', () => {
    const lens = (a: 'before' | 'center' | 'after') => { const c = montage(a); return [c.clips.map(k => k.durationMs), frameAt(c, 7999, kindOf).length] }
    expect(lens('center')).toEqual(lens('before')); expect(lens('after')).toEqual(lens('before'))
  })
  it('sound follows the same window: A sounds past the cut and fades out, B comes in from before it', () => {
    const v = videoVoices(montage('center'), kindOf)
    const a = v.find(x => x.key.startsWith('vc:') && x.startMs === 0)!, b = v.find(x => x.startMs > 0)!
    expect(a.endMs).toBe(4500); expect(a.envelope?.fadeOutMs).toBe(1000)
    expect(b.startMs).toBe(3500); expect(b.sourceStartMs).toBe(1500); expect(b.envelope?.fadeInMs).toBe(1000)
  })
  it('alignment and source length survive saving and reopening; absent stays «before» (old projects unchanged)', () => {
    const c = montage('center')
    const back = parseComposition(JSON.parse(JSON.stringify(c)))!
    expect(back.clips[0].transitionOpts?.align).toBe('center'); expect(back.clips[0].sourceDurationMs).toBe(10000)
    const old = parseComposition(JSON.parse(JSON.stringify(montage(undefined))))!
    expect(old.clips[0].transitionOpts?.align).toBeUndefined(); expect(transitionWindow(old, 0).pre).toBe(1000)
  })
  it('a centered transition cannot run into the previous cut\'s window', () => {
    let c = montage('center', 3000)
    c = addClip(c, 'c', 4000)
    c = updateClip(c, c.clips[1].id, { transition: 'dissolve', transitionMs: 3000, transitionOpts: { align: 'center' } })
    const w0 = transitionWindow(c, 0), w1 = transitionWindow(c, 1)
    expect(w0.post + w1.pre).toBeLessThanOrEqual(c.clips[1].durationMs)
  })
})
