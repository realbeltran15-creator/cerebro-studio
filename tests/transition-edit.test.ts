import { describe, expect, it } from 'vitest'
import { emptyComposition, parseComposition, totalDurationMs, type Composition } from '@/lib/editor/composition'
import { addClip, commit, deleteClip, historyOf, moveClip, redo, setDuration, trimStart, undo, updateClip } from '@/lib/editor/timeline'
import { frameAt, transitionWindow } from '@/lib/editor/scene'
import { transitionHandles, transitionPatch } from '@/lib/editor/transition-window'

const kindOf = () => 'video' as const
type V = { slot: string; alpha: number }
const visuals = (c: Composition, t: number) => frameAt(c, t, kindOf).filter(o => o.type === 'visual') as unknown as V[]

/** Three videos (4 s each, files of 12 s, B and C start 2 s into theirs) joined by centred linear dissolves. */
function three(align: 'before' | 'center' | 'after' = 'center', ms = 1000): Composition {
  let c: Composition = { ...emptyComposition('t', 't'), fadeMs: 300, duckMusic: false }
  for (const a of ['a', 'b', 'c']) c = addClip(c, a, 4000)
  c.clips.forEach((k, i) => { c = updateClip(c, k.id, { sourceDurationMs: 12000, trimInMs: i ? 2000 : 0, ...(i < 2 ? { transition: 'dissolve', transitionMs: ms, transitionOpts: { easing: 'linear', align } } : {}) }) })
  return c
}
const sweep = (c: Composition) => { const bad: number[] = []; for (let t = 0; t < totalDurationMs(c); t += 20) if (visuals(c, t).length < 1) bad.push(t); return bad }

describe('editing around a transition keeps both clips taking part and never breaks the picture', () => {
  it('continuity: for every alignment and curve there is always a picture, and the incoming clip only ever grows in', () => {
    for (const align of ['before', 'center', 'after'] as const) for (const easing of ['linear', 'smooth', 'in', 'out'] as const) {
      let c = three(align)
      c = updateClip(c, c.clips[0].id, { transitionOpts: { easing, align } })
      expect(sweep(c)).toEqual([])
      let prev = -1
      for (let t = 0; t < 8000; t += 20) { const v = visuals(c, t); if (t > 2800 && t < 5200 && v.length === 2) { expect(v[1].alpha + 1e-9).toBeGreaterThanOrEqual(prev); prev = v[1].alpha } }
    }
  })
  it('changing duration and type only moves the window; clip lengths and project length stay', () => {
    let c = three()
    const len = totalDurationMs(c)
    c = updateClip(c, c.clips[0].id, { transitionMs: 2000 })
    expect(transitionWindow(c, 0)).toEqual({ ms: 2000, pre: 1000, post: 1000 })
    c = updateClip(c, c.clips[0].id, { ...transitionPatch(c.clips[0], 'slide'), transitionMs: 600 })
    expect(c.clips[0].transition).toBe('slide'); expect(c.clips[0].transitionOpts?.align).toBe('center')
    expect(transitionWindow(c, 0).ms).toBe(600)
    expect(totalDurationMs(c)).toBe(len); expect(c.clips.map(k => k.durationMs)).toEqual([4000, 4000, 4000])
  })
  it('a transition newly chosen is centred; one with an alignment keeps it; an old project keeps «ends at the cut»', () => {
    expect(transitionPatch({ transition: 'fade' }, 'dissolve').transitionOpts?.align).toBe('center')
    expect(transitionPatch({ transition: 'dissolve', transitionOpts: { align: 'after' } }, 'slide').transitionOpts).toBeUndefined()
    expect(transitionPatch({ transition: 'dissolve' }, 'wipe').transitionOpts).toBeUndefined()   // legacy dissolve: alignment stays unset
  })
  it('moving a clip keeps every transition (they travel with the clip they follow) and the total length', () => {
    let c = three(); const len = totalDurationMs(c)
    c = moveClip(c, c.clips[0].id, 2)
    expect(c.clips.filter(k => k.transition === 'dissolve')).toHaveLength(2)
    expect(totalDurationMs(c)).toBe(len); expect(sweep(c)).toEqual([])
    expect(transitionWindow(c, 1).pre + transitionWindow(c, 0).post).toBeLessThanOrEqual(c.clips[1].durationMs)
  })
  it('trimming: cutting more off B\'s start gives it material before its entry; shortening A keeps the window inside it; no frame is invented', () => {
    let c = three()
    c = updateClip(c, c.clips[1].id, { trimInMs: 200 })                      // B only has 200 ms before its start
    expect(transitionHandles(c, 0, kindOf).missingB).toBe(300)
    c = trimStart(c, c.clips[1].id, 300)                                    // cut 300 ms more off B's start: it now has 500 ms before its entry
    expect(c.clips[1].durationMs).toBe(3700); expect(transitionHandles(c, 0, kindOf).missingB).toBe(0)
    const shorter = setDuration(c, c.clips[0].id, 1000)
    expect(transitionWindow(shorter, 0).ms).toBeLessThanOrEqual(1000)
    expect(shorter.clips[0].sourceDurationMs).toBe(12000)                   // the file length survives edits
    expect(sweep(shorter)).toEqual([])
  })
  it('deleting the incoming clip: the previous clip transitions into the next one, nothing breaks, only that clip\'s time is removed', () => {
    let c = three(); const len = totalDurationMs(c)
    c = deleteClip(c, c.clips[1].id)
    expect(c.clips).toHaveLength(2); expect(totalDurationMs(c)).toBe(len - 4000)
    expect(visuals(c, 3600)).toHaveLength(2)                                // still a real two-clip transition around the new cut
    expect(sweep(c)).toEqual([])
  })
  it('undo and redo restore the transition exactly', () => {
    let h = historyOf(three())
    h = commit(h, updateClip(h.present, h.present.clips[0].id, { transitionMs: 2000, transitionOpts: { easing: 'in', align: 'after' } }))
    h = commit(h, updateClip(h.present, h.present.clips[0].id, { transition: 'wipe' }))
    h = undo(h); expect(h.present.clips[0].transition).toBe('dissolve')
    h = undo(h); expect(h.present.clips[0].transitionMs).toBe(1000); expect(h.present.clips[0].transitionOpts).toEqual({ easing: 'linear', align: 'center' })
    h = redo(h); h = redo(h)
    expect(h.present.clips[0]).toMatchObject({ transition: 'wipe', transitionMs: 2000, transitionOpts: { easing: 'in', align: 'after' } })
  })
  it('saved and recovered: every transition field survives, and a project saved before alignment existed opens unchanged', () => {
    const c = three('after', 700)
    const back = parseComposition(JSON.parse(JSON.stringify(c)))!
    expect(back.clips.map(k => [k.transition, k.transitionMs, k.transitionOpts?.align, k.sourceDurationMs])).toEqual(c.clips.map(k => [k.transition, k.transitionMs, k.transitionOpts?.align, k.sourceDurationMs]))
    const legacy = JSON.parse(JSON.stringify(c)); legacy.clips.forEach((k: { transitionOpts?: object; sourceDurationMs?: number }) => { if (k.transitionOpts) k.transitionOpts = { easing: 'linear' }; delete k.sourceDurationMs })
    const old = parseComposition(legacy)!
    expect(transitionWindow(old, 0)).toEqual({ ms: 700, pre: 700, post: 0 })      // exactly what it did before
    expect(sweep(old)).toEqual([])
  })
})
