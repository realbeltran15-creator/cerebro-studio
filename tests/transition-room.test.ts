import { describe, expect, it } from 'vitest'
import { emptyComposition, totalDurationMs, type Composition } from '@/lib/editor/composition'
import { addClip, updateClip } from '@/lib/editor/timeline'
import { frameAt } from '@/lib/editor/scene'
import { transitionHandles } from '@/lib/editor/transition-window'
import { makeRoomForTransition } from '@/lib/editor/transition-room'

const kindOf = () => 'video' as const
type V = { slot: string; alpha: number; live: boolean; sourceMs: number }
const vis = (c: Composition, t: number) => frameAt(c, t, kindOf).filter(o => o.type === 'visual') as unknown as V[]

/** Exactly the situation of the real app: two videos used whole (8 s and 6 s files, trim 0), a centred dissolve of 2 s. */
function wholeVideos(ms = 2000, align: 'center' | 'before' | 'after' = 'center'): Composition {
  let c: Composition = { ...emptyComposition('t', 't'), fadeMs: 300, duckMusic: false }
  c = addClip(c, 'a', 8000); c = addClip(c, 'b', 6000)
  c = updateClip(c, c.clips[0].id, { sourceDurationMs: 8000, trimInMs: 0, transition: 'dissolve', transitionMs: ms, transitionOpts: { easing: 'linear', align } })
  return updateClip(c, c.clips[1].id, { sourceDurationMs: 6000, trimInMs: 0 })
}

describe('creating real material for a transition between two whole videos', () => {
  it('before: both sides hold a frame (the bug seen in the real app)', () => {
    const c = wholeVideos()
    const h = transitionHandles(c, 0, kindOf)
    expect([h.missingA, h.missingB]).toEqual([1000, 1000])
    expect(vis(c, 7500)[1].live).toBe(false)      // B frozen on its first frame before the cut
    expect(vis(c, 8500)[0].live).toBe(false)      // A frozen on its last frame after it
  })
  it('after: A and B both play real frames in the whole 2 s window; the project is 2 s shorter, said explicitly', () => {
    const c0 = wholeVideos(), r = makeRoomForTransition(c0, 0, kindOf), c = r.composition
    expect([r.trimmedAMs, r.trimmedBMs, r.ms]).toEqual([1000, 1000, 2000])
    expect(totalDurationMs(c)).toBe(totalDurationMs(c0) - 2000)
    expect(r.message).toMatch(/recortaron 1 s del final del clip 1 y 1 s del principio del clip 2/)
    expect(r.message).toMatch(/2 s menos/)
    const h = transitionHandles(c, 0, kindOf); expect([h.missingA, h.missingB]).toEqual([0, 0])
    const cut = c.clips[0].durationMs                                    // 7000
    for (const t of [cut - 1000 + 10, cut - 500, cut, cut + 500, cut + 990]) {
      const [a, b] = vis(c, t)
      expect(a.live && b.live).toBe(true)                                 // both advance
    }
    // At the start A = 100 %, B = 0 %; in the middle 50 / 50; at the end A = 0, B = 100 %.
    expect(vis(c, cut - 1000 + 1)[1].alpha).toBeLessThan(0.01)
    expect(vis(c, cut)[1].alpha).toBeCloseTo(0.5, 2)
    expect(vis(c, cut + 999)[1].alpha).toBeGreaterThan(0.99)
    // B plays its own first second (the trimmed material) before the cut: source 0 at the window start, 1000 (its new in-point) at the cut.
    expect(vis(c, cut - 1000 + 1)[1].sourceMs).toBeCloseTo(1, -1); expect(vis(c, cut)[1].sourceMs).toBeCloseTo(1000, -1)
    // B's picture is continuous through the cut: its source time advances 1:1 across it.
    expect(vis(c, cut + 100)[1].sourceMs - vis(c, cut - 100)[1].sourceMs).toBeCloseTo(200, -1)
  })
  it('only what is missing is trimmed (a clip that already has material is left alone)', () => {
    let c = wholeVideos()
    c = updateClip(c, c.clips[1].id, { trimInMs: 1000 })               // B already has 1 s before its entry
    c = updateClip(c, c.clips[0].id, { sourceDurationMs: 9000 })       // A has 1 s after its end
    const r = makeRoomForTransition(c, 0, kindOf)
    expect([r.trimmedAMs, r.trimmedBMs, r.message]).toEqual([0, 0, ''])
    expect(r.composition).toBe(c)
  })
  it('also for the «before» and «after» alignments; only the side that needs it is trimmed', () => {
    const rb = makeRoomForTransition(wholeVideos(2000, 'before'), 0, kindOf), ra = makeRoomForTransition(wholeVideos(2000, 'after'), 0, kindOf)
    expect([rb.trimmedAMs, rb.trimmedBMs]).toEqual([0, 2000]); expect([ra.trimmedAMs, ra.trimmedBMs]).toEqual([2000, 0])
  })
  it('clips too short give a shorter transition, said explicitly; hopeless cases change nothing', () => {
    let c = wholeVideos(2000)
    c = updateClip(c, c.clips[1].id, { durationMs: 1500, sourceDurationMs: 1500 })
    const r = makeRoomForTransition(c, 0, kindOf)
    expect(r.limited).toBe(true); expect(r.ms).toBeLessThan(2000); expect(r.message).toMatch(/se limitó/)
    expect(Math.min(...r.composition.clips.map(k => k.durationMs))).toBeGreaterThanOrEqual(1000)
    const w = wholeVideos(), tiny = updateClip(updateClip(w, w.clips[0].id, { durationMs: 1000 }), w.clips[1].id, { durationMs: 1000 })
    expect(makeRoomForTransition(tiny, 0, kindOf).composition).toBe(tiny)
  })
  it('images need no material and are never trimmed', () => {
    const img = () => 'image' as const
    expect(makeRoomForTransition(wholeVideos(), 0, img).message).toBe('')
  })
})
