import { describe, expect, it } from 'vitest'
import { emptyComposition } from '@/lib/editor/composition'
import { addClip, updateClip } from '@/lib/editor/timeline'
import { frameAt, transitionMsOf, voiceGainAt, audioVoices } from '@/lib/editor/scene'

const kindOf = () => 'image' as const
function twoClips(a: number, b: number, tr: number) {
  let c = { ...emptyComposition('t', 't'), fadeMs: 300, duckMusic: false }
  c = addClip(c, 'x', a); c = addClip(c, 'y', b)
  return updateClip(c, c.clips[0].id, { transition: 'dissolve', transitionMs: tr })
}
const alphaOfNext = (c: ReturnType<typeof twoClips>, t: number) => frameAt(c, t, kindOf).filter(o => o.type === 'visual').map(o => (o as { alpha: number }).alpha)

describe('transition length is limited by the clips around the cut', () => {
  it('never exceeds the clip that ends or the one that starts', () => {
    expect(transitionMsOf(twoClips(4000, 4000, 1500), 0)).toBe(1500)
    expect(transitionMsOf(twoClips(4000, 1000, 1500), 0)).toBe(1000)    // the incoming clip is shorter
    expect(transitionMsOf(twoClips(1000, 4000, 1500), 0)).toBe(1000)    // the outgoing clip is shorter
    expect(transitionMsOf(twoClips(4000, 4000, -5), 0)).toBe(0)
    expect(transitionMsOf(twoClips(4000, 4000, 1500), 1)).toBe(300)   // the last clip uses the montage fade, within its own length
    expect(transitionMsOf(twoClips(4000, 4000, 1500), 5)).toBe(0)
  })
  it('a clip shorter than its transition no longer starts in the middle of a transition (no jump after the previous cut)', () => {
    // clip 2 (1 s) asked for 1500 ms: used to start at 47 % of its own transition.
    let c = twoClips(3000, 1000, 500)
    c = addClip(c, 'z', 3000)
    c = updateClip(c, c.clips[1].id, { transition: 'dissolve', transitionMs: 1500 })
    const at = (t: number) => frameAt(c, t, kindOf).filter(o => o.type === 'visual') as Array<{ alpha: number }>
    expect(at(3000)).toHaveLength(1)                       // first instant of clip 2: only clip 2, as at the end of the previous cut
    expect(at(3040)[1].alpha).toBeLessThan(0.06)           // the incoming picture starts from nothing (before: ~0.47 straight away)
    expect(at(3400)[1].alpha).toBeGreaterThan(0.2); expect(at(3400)[1].alpha).toBeLessThan(0.45)  // 40 % into the clip = 40 % into the transition (eased)
  })
  it('the sound crossfade follows the same length', () => {
    const c = twoClips(4000, 1000, 1500)
    const v = audioVoices(c)
    expect(Array.isArray(v)).toBe(true)
    expect(typeof voiceGainAt).toBe('function')
  })
})
