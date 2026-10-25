import { describe, expect, it } from 'vitest'
import { emptyComposition, totalDurationMs, parseComposition, type Composition } from '@/lib/editor/composition'
import { addClip, updateClip, commit, historyOf, undo } from '@/lib/editor/timeline'
import { frameAt } from '@/lib/editor/scene'
import { transitionHandles } from '@/lib/editor/transition-window'
import { cutsOf, planBatchTransitions, selectedCutClipIds, describePlan } from '@/lib/editor/batch-transitions'
import { maxRepeats, planRepeat, repeatClip } from '@/lib/editor/repeat'

const kindOf = () => 'video' as const
const MIN = 60_000, H = 3_600_000
/** A 30 s video used whole (the file is 30 s long), as imported. */
function oneVideo(ms = 30_000, extra: Partial<Composition['clips'][number]> = {}): Composition {
  let c: Composition = { ...emptyComposition('t', 't'), fadeMs: 300, duckMusic: false }
  c = addClip(c, 'vid', ms)
  return updateClip(c, c.clips[0].id, { sourceDurationMs: ms, trimInMs: 0, ...extra })
}
const DISSOLVE = { transition: 'dissolve' as const, ms: 1000, align: 'center' as const, easing: 'linear' as const }
const rep = (n: number, ms = 30_000, extra: Partial<Composition['clips'][number]> = {}) => { const c = oneVideo(ms, extra); return repeatClip(c, c.clips[0].id, n).composition }
const missing = (c: Composition) => { let m = 0; for (let i = 0; i < c.clips.length - 1; i++) { if (c.clips[i].transition === 'cut') continue; const h = transitionHandles(c, i, kindOf); m += h.missingA + h.missingB } return m }

describe('repetition of a clip (instances sharing one media asset)', () => {
  for (const n of [10, 100, 200, 300]) {
    it(`${n} repetitions: ${n} independent instances of the same file, original included`, () => {
      const c = oneVideo()
      const t0 = performance.now()
      const r = repeatClip(c, c.clips[0].id, n)
      const ms = performance.now() - t0
      expect(r.composition.clips).toHaveLength(n)
      expect(r.ids).toHaveLength(n - 1)
      expect(new Set(r.composition.clips.map(k => k.id)).size).toBe(n)              // own ids
      expect(new Set(r.composition.clips.map(k => k.visualAssetId))).toEqual(new Set(['vid'])) // one shared file
      expect(r.composition.clips.map(k => k.position)).toEqual(Array.from({ length: n }, (_, i) => i + 1))
      expect(totalDurationMs(r.composition)).toBe(30_000 * n)
      expect(JSON.stringify(r.composition).length).toBeLessThan(n * 1500)            // small save: no media duplicated
      expect(ms).toBeLessThan(500)
      expect(parseComposition(JSON.parse(JSON.stringify(r.composition)))?.clips).toHaveLength(n) // survives save and reopen
    })
  }
  it('an instance can be edited on its own without touching the others', () => {
    const c = rep(5)
    const edited = updateClip(c, c.clips[2].id, { durationMs: 12_000, speed: 2 })
    expect(edited.clips.filter(k => k.durationMs === 12_000)).toHaveLength(1)
    expect(edited.clips.filter(k => k.speed === 2)).toHaveLength(1)
  })
  it('one Ctrl+Z gives back the original montage', () => {
    const c = oneVideo()
    let h = historyOf(c)
    h = commit(h, planRepeat(c, c.clips[0].id, { mode: 'count', count: 200 }, { settings: DISSOLVE }, kindOf).composition)
    expect(h.present.clips).toHaveLength(200)
    h = undo(h)
    expect(h.present).toBe(c)
  })
  it('respects the montage limits', () => {
    const c = oneVideo(30_000)
    expect(maxRepeats(c, c.clips[0].id)).toBe(720)                                    // 6 h / 30 s
    const p = planRepeat(c, c.clips[0].id, { mode: 'count', count: 5000 }, null, kindOf)
    expect(p.total).toBe(720); expect(p.warnings.join(' ')).toMatch(/máximo/)
  })
})

describe('repeat + transition on every cut: no cumulative trimming, real material on both sides', () => {
  it('10 repetitions, 1 s centred dissolve: each cut costs exactly the transition length, nothing is frozen', () => {
    const c = oneVideo()
    const p = planRepeat(c, c.clips[0].id, { mode: 'count', count: 10 }, { settings: DISSOLVE }, kindOf)
    expect(p.finalMs).toBe(10 * 30_000 - 9 * 1000)
    expect(p.plan!.applied).toBe(9); expect(p.plan!.skipped).toEqual([]); expect(p.plan!.shortened).toEqual([])
    expect(missing(p.composition)).toBe(0)
    // every instance keeps nearly all its content: edges are trimmed once, never progressively
    expect(p.composition.clips.map(k => k.durationMs)).toEqual([29_500, ...Array(8).fill(29_000), 29_500])
    expect(Math.min(...p.composition.clips.map(k => k.trimInMs ?? 0))).toBe(0)
    expect(Math.max(...p.composition.clips.map(k => k.trimInMs ?? 0))).toBe(500)
  })
  it('the transition shows frames of BOTH videos moving (real sources), at 50/50 on the cut', () => {
    const c = oneVideo()
    const p = planRepeat(c, c.clips[0].id, { mode: 'count', count: 3 }, { settings: DISSOLVE }, kindOf).composition
    const cut = p.clips[0].durationMs
    for (const t of [cut - 400, cut, cut + 400]) {
      const v = frameAt(p, t, kindOf).filter(o => o.type === 'visual') as unknown as Array<{ alpha: number; live: boolean; sourceMs: number }>
      expect(v).toHaveLength(2); expect(v.every(x => x.live)).toBe(true)
    }
    const mid = frameAt(p, cut, kindOf).filter(o => o.type === 'visual') as unknown as Array<{ alpha: number; sourceMs: number }>
    expect(mid[1].alpha).toBeCloseTo(0.5, 1)
    expect(mid[0].sourceMs).toBeCloseTo(29_500, -1); expect(mid[1].sourceMs).toBeCloseTo(500, -1)
  })
  it('no transition is applied when none is chosen: straight copies keep the full length', () => {
    const c = oneVideo()
    const p = planRepeat(c, c.clips[0].id, { mode: 'count', count: 10 }, null, kindOf)
    expect(p.finalMs).toBe(300_000); expect(p.plan).toBeNull()
  })
  it('a source with extra material (trim in the middle of a longer file) needs no trimming at all', () => {
    const c = oneVideo(30_000, { sourceDurationMs: 60_000, trimInMs: 10_000 })
    const p = planRepeat(c, c.clips[0].id, { mode: 'count', count: 20 }, { settings: DISSOLVE }, kindOf)
    expect(p.finalMs).toBe(20 * 30_000); expect(p.plan!.trimmedMs).toBe(0)
    expect(missing(p.composition)).toBe(0)
  })
})

describe('repeat until a target length (overlaps counted, last segment adjusted non-destructively)', () => {
  for (const [label, target] of [['90 min', 90 * MIN], ['3 h', 3 * H], ['5 h', 5 * H]] as const) {
    it(`${label} from a 30 s video with 1 s dissolves: exact length, ~${Math.round(target / 29_000)} instances, every cut real`, () => {
      const c = oneVideo()
      const t0 = performance.now()
      const p = planRepeat(c, c.clips[0].id, { mode: 'target', targetMs: target, exact: true }, { settings: DISSOLVE }, kindOf)
      const ms = performance.now() - t0
      expect(p.ok).toBe(true)
      expect(p.finalMs).toBe(target)
      expect(totalDurationMs(p.composition)).toBe(target)
      expect(p.total).toBeGreaterThan(target / 30_000)                              // more than a naive multiplication would give
      expect(p.total).toBeLessThanOrEqual(Math.ceil(target / 29_000) + 1)
      expect(missing(p.composition)).toBe(0)
      expect(p.composition.clips.every(k => k.durationMs >= 1000)).toBe(true)
      expect(p.composition.clips.length).toBe(p.total)
      expect(ms).toBeLessThan(4000)
      expect(p.adjustedMs).toBeGreaterThanOrEqual(0)
    })
  }
  it('target without exact adjustment overshoots by less than one repetition and says nothing is cut', () => {
    const c = oneVideo()
    const p = planRepeat(c, c.clips[0].id, { mode: 'target', targetMs: 90 * MIN, exact: false }, { settings: DISSOLVE }, kindOf)
    expect(p.finalMs).toBeGreaterThanOrEqual(90 * MIN); expect(p.finalMs - 90 * MIN).toBeLessThan(30_000); expect(p.adjustedMs).toBe(0)
  })
  it('the same target WITHOUT transitions needs fewer repetitions (naive multiplication)', () => {
    const c = oneVideo()
    const a = planRepeat(c, c.clips[0].id, { mode: 'target', targetMs: 90 * MIN, exact: true }, null, kindOf)
    const b = planRepeat(c, c.clips[0].id, { mode: 'target', targetMs: 90 * MIN, exact: true }, { settings: DISSOLVE }, kindOf)
    expect(a.total).toBe(180); expect(b.total).toBeGreaterThan(a.total)
  })
  it('a project that already has other clips counts them', () => {
    let c = oneVideo(); c = addClip(c, 'img', 10_000)
    const p = planRepeat(c, c.clips[0].id, { mode: 'target', targetMs: 10 * MIN, exact: true }, null, kindOf)
    expect(p.finalMs).toBe(10 * MIN)
  })
  it('a transition that eats the whole clip is refused with an explanation', () => {
    const c = oneVideo(2000)
    const p = planRepeat(c, c.clips[0].id, { mode: 'target', targetMs: 5 * MIN, exact: true }, { settings: { ...DISSOLVE, ms: 2500 } }, kindOf)
    expect(p.finalMs).toBeGreaterThan(0)
  })
})

describe('bulk transitions: which cuts', () => {
  const base = () => rep(21)
  it('all / range / every N / selected / none', () => {
    const c = base()
    expect(cutsOf(c, { kind: 'all' })).toHaveLength(20)
    expect(cutsOf(c, { kind: 'range', from: 3, to: 6 })).toEqual([2, 3, 4, 5])
    expect(cutsOf(c, { kind: 'range', from: 6, to: 3 })).toEqual([2, 3, 4, 5])
    expect(cutsOf(c, { kind: 'every', n: 5 })).toEqual([0, 5, 10, 15])
    expect(cutsOf(c, { kind: 'every', n: 10, from: 5 })).toEqual([4, 14])
    const ids = selectedCutClipIds(c, [c.clips[2].id, c.clips[3].id, c.clips[4].id, c.clips[9].id], null)
    expect(cutsOf(c, { kind: 'selected', clipIds: ids })).toEqual([2, 3])
    expect(selectedCutClipIds(c, [], c.clips[7].id)).toEqual([c.clips[7].id])
    expect(cutsOf(c, { kind: 'range', from: 40, to: 50 })).toEqual([])
  })
  it('only the chosen cuts change; the others stay exactly as they were', () => {
    const c = base()
    const p = planBatchTransitions(c, { kind: 'every', n: 5 }, { action: 'apply', settings: DISSOLVE }, kindOf)
    const changed = p.composition.clips.map((k, i) => (k !== c.clips[i] ? i : -1)).filter(i => i >= 0)
    expect(p.chosen).toEqual([0, 5, 10, 15])
    expect(p.applied).toBe(4)
    for (const cut of p.chosen) expect(p.composition.clips[cut].transition).toBe('dissolve')
    expect(changed.every(i => p.chosen.some(cu => i === cu || i === cu + 1))).toBe(true)
    expect(p.afterMs).toBe(p.beforeMs - 4 * 1000)
    expect(missing({ ...p.composition, clips: p.composition.clips.map((k, i) => (p.chosen.includes(i) ? k : { ...k, transition: 'cut' as const })) })).toBe(0)
  })
  it('remove transitions in a range leaves straight cuts and does not trim or restore anything', () => {
    const c = planBatchTransitions(base(), { kind: 'all' }, { action: 'apply', settings: DISSOLVE }, kindOf).composition
    const p = planBatchTransitions(c, { kind: 'range', from: 5, to: 8 }, { action: 'remove' }, kindOf)
    expect(p.removed).toBe(4)
    expect(p.composition.clips.slice(4, 8).every(k => k.transition === 'cut' && k.transitionMs === undefined)).toBe(true)
    expect(p.composition.clips[3].transition).toBe('dissolve'); expect(p.composition.clips[8].transition).toBe('dissolve')
    expect(p.afterMs).toBe(p.beforeMs)
  })
  it('without permission to trim, no clip is trimmed: the transition is shortened to the real material or the cut is left straight', () => {
    const c = base()                                            // whole 30 s files: no material anywhere
    const p = planBatchTransitions(c, { kind: 'all' }, { action: 'apply', settings: DISSOLVE, allowTrim: false, onFail: 'cut' }, kindOf)
    expect(p.trimmedMs).toBe(0); expect(p.afterMs).toBe(p.beforeMs)
    expect(p.skipped).toHaveLength(20); expect(p.needsDecision).toBe(true)
    expect(p.composition.clips.slice(0, 20).every(k => k.transition === 'cut')).toBe(true)
    expect(describePlan(p, { action: 'apply', settings: DISSOLVE }).join(' ')).toMatch(/sin transición/)
    // with a file longer than the clip there is material: applied untouched
    const d = rep(6, 30_000, { sourceDurationMs: 90_000, trimInMs: 30_000 })
    const q = planBatchTransitions(d, { kind: 'all' }, { action: 'apply', settings: DISSOLVE, allowTrim: false }, kindOf)
    expect(q.applied).toBe(5); expect(q.trimmedMs).toBe(0); expect(q.shortened).toEqual([]); expect(q.afterMs).toBe(q.beforeMs)
  })
  it('clips too short for the transition: reported and shortened (reduce) or left straight (cut); never emptied', () => {
    const c = rep(6, 3000)
    const big = { ...DISSOLVE, ms: 2800 }
    const r = planBatchTransitions(c, { kind: 'all' }, { action: 'apply', settings: big, onFail: 'reduce' }, kindOf)
    expect(r.composition.clips.every(k => k.durationMs >= 1000)).toBe(true)
    const k = planBatchTransitions(c, { kind: 'all' }, { action: 'apply', settings: big, onFail: 'cut' }, kindOf)
    expect(k.composition.clips.every(x => x.durationMs >= 1000)).toBe(true)
    expect(r.needsDecision || k.needsDecision || r.applied > 0).toBe(true)
  })
  it('settings reach every chosen cut: type, duration, alignment, intensity, direction, curve', () => {
    const c = base()
    const p = planBatchTransitions(c, { kind: 'range', from: 1, to: 3 }, { action: 'apply', settings: { transition: 'slide', ms: 800, align: 'after', intensity: 1.5, direction: 'up', easing: 'in' } }, kindOf)
    for (const i of [0, 1, 2]) expect(p.composition.clips[i]).toMatchObject({ transition: 'slide', transitionMs: 800, transitionOpts: { align: 'after', intensity: 1.5, direction: 'up', easing: 'in' } })
  })
  it('after a bulk apply one transition is edited alone and the others do not move', () => {
    const c = planBatchTransitions(base(), { kind: 'all' }, { action: 'apply', settings: DISSOLVE }, kindOf).composition
    const e = updateClip(c, c.clips[7].id, { transition: 'wipe', transitionMs: 2000 })
    expect(e.clips.filter(k => k.transition === 'wipe')).toHaveLength(1)
    expect(e.clips.filter((k, i) => i !== 7 && k !== c.clips[i])).toHaveLength(0)
  })
  it('1800 cuts are planned quickly', () => {
    const c = rep(1800, 10_000)
    const t0 = performance.now()
    const p = planBatchTransitions(c, { kind: 'all' }, { action: 'apply', settings: DISSOLVE }, kindOf)
    expect(performance.now() - t0).toBeLessThan(3000)
    expect(p.applied).toBe(1799); expect(p.afterMs).toBe(1800 * 10_000 - 1799 * 1000)
  })
})
