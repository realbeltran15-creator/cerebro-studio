import { describe, expect, it } from 'vitest'
import { emptyComposition, parseComposition, projectDurationMs, type Clip, type Composition } from '@/lib/editor/composition'
import { commit, duplicateClip, historyOf, makeBounceLoop, redo, setDuration, setReverse, splitClip, trimStart, undo, updateClip } from '@/lib/editor/timeline'
import { backCopyOf, FRAME_MS, hasReverse, loopDurationMs, sourceAt } from '@/lib/editor/reverse'
import { frameAt, videoVoices, type KindOf, type VisualOp } from '@/lib/editor/scene'
import { ReverseFrameReader, framesForBudget, type FrameSink, type RevFrame } from '@/lib/editor/reverse-frames'
import { repeatClip } from '@/lib/editor/repeat'
import { updateOverlay } from '@/lib/editor/tracks'

const kindOf: KindOf = id => (id.startsWith('vid') ? 'video' : id.startsWith('img') ? 'image' : null)
const clip = (o: Partial<Clip> & { id: string }): Clip => ({ sceneId: o.id, position: 1, narration: null, visualAssetId: 'vid1', voiceAssetId: null, durationMs: 3000, motion: 'none', trimInMs: 0, transition: 'cut', ...o })
const comp = (...clips: Clip[]): Composition => ({ ...emptyComposition('sb', 'Doc'), clips: clips.map((k, i) => ({ ...k, position: i + 1 })) })
const ops = (c: Composition, t: number) => frameAt(c, t, kindOf).filter((o): o is VisualOp => o.type === 'visual')

describe('reversed source time (shared by preview and export)', () => {
  it('a forward clip reads its window from the start, a reversed one from the end', () => {
    const f = clip({ id: 'a', trimInMs: 1000, durationMs: 3000 })
    const r = { ...f, reverse: true }
    expect(sourceAt(f, 0)).toBe(1000)
    expect(sourceAt(f, 1500)).toBe(2500)
    // reversed: starts on the last frame of [1000, 4000) and walks back
    expect(sourceAt(r, 0)).toBeGreaterThan(3950); expect(sourceAt(r, 0)).toBeLessThan(4000)
    expect(sourceAt(r, 1500)).toBeCloseTo(2500 - FRAME_MS / 2, 3)
    expect(sourceAt(r, 3000 - FRAME_MS)).toBeGreaterThanOrEqual(1000); expect(sourceAt(r, 3000 - FRAME_MS)).toBeLessThan(1000 + FRAME_MS)
    // never before the in-point
    expect(sourceAt(r, 3000)).toBe(1000)
  })

  it('respects the speed: the window is durationMs × speed long and is read backwards at that speed', () => {
    const r = clip({ id: 'a', trimInMs: 500, durationMs: 2000, speed: 2, reverse: true })
    expect(sourceAt(r, 0)).toBeLessThan(4500); expect(sourceAt(r, 0)).toBeGreaterThan(4400)
    expect(sourceAt(r, 1000)).toBeCloseTo(2500 - FRAME_MS, 3)
  })

  it('every frame of a reversed clip is exactly the mirror of the forward clip (no frame skipped or repeated)', () => {
    const N = 90 // 3 s at 30 fps; source frame k covers [k·f, (k+1)·f)
    const f = clip({ id: 'a', durationMs: N * FRAME_MS })
    const r = { ...f, reverse: true }
    const idx = (ms: number) => Math.floor(ms / FRAME_MS + 1e-9)
    const fwd = Array.from({ length: N }, (_, j) => idx(sourceAt(f, j * FRAME_MS)))
    const bwd = Array.from({ length: N }, (_, j) => idx(sourceAt(r, j * FRAME_MS)))
    expect(fwd).toEqual(Array.from({ length: N }, (_, j) => j))
    expect(bwd).toEqual(Array.from({ length: N }, (_, j) => N - 1 - j))
  })

  it('frameAt marks the layer as reversed and puts it at the reversed source time; other clips of the same file are untouched', () => {
    const c = comp(clip({ id: 'a', reverse: true }), clip({ id: 'b' }))
    const a = ops(c, 100)[0], b = ops(c, 3100)[0]
    expect(a.reverse).toBe(true); expect(a.sourceMs).toBeGreaterThan(2800)
    expect(b.reverse).toBeUndefined(); expect(b.sourceMs).toBe(100)
  })

  it('the reversed clip’s own sound is not emitted (reversed speech would be noise); forward clips keep theirs', () => {
    const c = comp(clip({ id: 'a', reverse: true }), clip({ id: 'b' }))
    expect(videoVoices(c, kindOf).map(v => v.key)).toEqual(['vc:b'])
  })
})

describe('transitions with a reversed clip', () => {
  it('holds the nearest frame instead of reading beyond the file, with no black frame', () => {
    const c = comp(clip({ id: 'a', reverse: true, trimInMs: 2000, sourceDurationMs: 20_000, transition: 'dissolve', transitionMs: 1000, transitionOpts: { align: 'center' } }), clip({ id: 'b', reverse: true, trimInMs: 2000, sourceDurationMs: 20_000 }))
    // inside the window both layers are on screen and nothing is empty
    for (const t of [2600, 3000, 3400]) {
      const o = ops(c, t)
      expect(o).toHaveLength(2)
      expect(o.every(x => x.media === 'video' && x.alpha > 0)).toBe(true)
    }
    const after = ops(c, 3400) // A is past its end (0.4 s): holds the frame at its end instead of playing on
    expect(after[0].live).toBe(false)
    expect(after[0].sourceMs).toBeGreaterThanOrEqual(2000); expect(after[0].sourceMs).toBeLessThan(2000 + FRAME_MS)
    const before = ops(c, 2600) // B before its start: holds its first frame
    expect(before[1].live).toBe(false)
    expect(before[1].sourceMs).toBeGreaterThan(4900)
  })
})

describe('editing a reversed clip', () => {
  it('toggling affects only that clip and is undone / redone as one step', () => {
    const c0 = comp(clip({ id: 'a' }), clip({ id: 'b' }))
    let h = historyOf(c0)
    h = commit(h, setReverse(h.present, 'a'))
    expect(h.present.clips.map(k => !!k.reverse)).toEqual([true, false])
    h = commit(h, setReverse(h.present, 'a'))
    expect(h.present.clips.map(k => !!k.reverse)).toEqual([false, false])
    expect('reverse' in h.present.clips[0]).toBe(false)
    h = undo(h); expect(h.present.clips[0].reverse).toBe(true)
    h = undo(h); expect(h.present.clips[0].reverse).toBeUndefined()
    h = redo(h); expect(h.present.clips[0].reverse).toBe(true)
    expect(c0.clips[0].reverse).toBeUndefined() // the earlier version was not mutated
  })

  it('survives duplication, batch repetition and saving/reloading the project', () => {
    let c = comp(clip({ id: 'a', reverse: true }), clip({ id: 'b' }))
    c = duplicateClip(c, 'a')
    expect(c.clips.map(k => !!k.reverse)).toEqual([true, true, false])
    c = repeatClip(c, 'a', 3).composition
    expect(c.clips.filter(k => k.reverse)).toHaveLength(4)
    const back = parseComposition(JSON.parse(JSON.stringify(c)))!
    expect(back.clips.map(k => !!k.reverse)).toEqual(c.clips.map(k => !!k.reverse))
    expect(hasReverse(back)).toBe(true)
  })

  it('overlays keep the flag too', () => {
    const c = { ...comp(clip({ id: 'a' })), tracks: [{ id: 'main', type: 'main' as const, name: 'Vídeo' }, { id: 'ov1', type: 'overlay' as const, name: 'Capa' }], overlays: [{ id: 'o1', trackId: 'ov1', assetId: 'vid2', startMs: 0, durationMs: 2000, trimInMs: 0, transform: { x: 0.5, y: 0.5, scale: 0.4, rotation: 0, opacity: 1 } }] }
    const r = updateOverlay(c, 'o1', { reverse: true })
    expect(parseComposition(JSON.parse(JSON.stringify(r)))!.overlays![0].reverse).toBe(true)
    expect(ops(r, 100).find(o => o.slot === 'ov:o1')!.reverse).toBe(true)
  })

  it('shortening a reversed clip at its END moves the in-point (the end of the block is the start of the source window)', () => {
    const c = comp(clip({ id: 'a', trimInMs: 1000, durationMs: 3000, reverse: true }))
    const s = setDuration(c, 'a', 2000).clips[0]
    expect(s.trimInMs).toBe(2000); expect(s.durationMs).toBe(2000)
    // the frame it starts on is unchanged: still the last frame of the original window
    expect(sourceAt(s, 0)).toBeCloseTo(sourceAt(c.clips[0], 0), 3)
    // a forward clip behaves as before
    const f = setDuration(comp(clip({ id: 'a', trimInMs: 1000, durationMs: 3000 })), 'a', 2000).clips[0]
    expect(f.trimInMs).toBe(1000)
  })

  it('trimming the START of a reversed clip shortens its window at the far end and keeps the in-point', () => {
    const c = comp(clip({ id: 'a', trimInMs: 1000, durationMs: 3000, reverse: true }))
    const t = trimStart(c, 'a', 500).clips[0]
    expect(t.trimInMs).toBe(1000); expect(t.durationMs).toBe(2500)
    // it now starts 0.5 s further along the reversed playback: the frame at the window's end minus 0.5 s
    expect(sourceAt(t, 0)).toBeCloseTo(sourceAt(c.clips[0], 500), 3)
  })

  it('splitting a reversed clip keeps both halves reading the same frames in the same order', () => {
    const c = comp(clip({ id: 'a', trimInMs: 1000, durationMs: 3000, reverse: true }))
    const s = splitClip(c, 'a', 1200).clips
    expect(s).toHaveLength(2)
    expect(s.every(k => k.reverse)).toBe(true)
    expect(sourceAt(s[0], 0)).toBeCloseTo(sourceAt(c.clips[0], 0), 3)
    expect(sourceAt(s[1], 0)).toBeCloseTo(sourceAt(c.clips[0], 1200), 3)
    expect(sourceAt(s[1], s[1].durationMs)).toBe(1000)
    expect(s[0].durationMs + s[1].durationMs).toBe(3000)
  })

  it('changing the speed keeps the same stretch of the file', () => {
    const c = comp(clip({ id: 'a', trimInMs: 1000, durationMs: 3000, reverse: true }))
    const sped = updateClip(c, 'a', { speed: 2, durationMs: 1500, trimInMs: 1000 }).clips[0]
    expect(sped.trimInMs).toBe(1000)
  })
})

describe('«Crear bucle ida y vuelta»', () => {
  const N = 60
  const base = () => comp(clip({ id: 'a', durationMs: N * FRAME_MS, trimInMs: 0 }), clip({ id: 'z', visualAssetId: 'img1' }))
  const frames = (c: Composition) => {
    const out: number[] = []
    for (const k of c.clips.filter(x => x.visualAssetId === 'vid1')) {
      for (let j = 0; j < Math.round(k.durationMs / FRAME_MS); j++) out.push(Math.floor(sourceAt(k, j * FRAME_MS) / FRAME_MS + 1e-9))
    }
    return out
  }

  it('puts a reversed copy of the same file right after the clip, with no new media', () => {
    const c = makeBounceLoop(base(), 'a')
    expect(c.clips.map(k => [k.reverse === true, k.visualAssetId])).toEqual([[false, 'vid1'], [true, 'vid1'], [false, 'img1']])
    expect(c.clips[0].id).toBe('a'); expect(new Set(c.clips.map(k => k.id)).size).toBe(3)
    expect(c.clips.map(k => k.position)).toEqual([1, 2, 3])
  })

  it('shows no frame twice at the joins: 0…N-1, N-2…1, then 0 again', () => {
    const c = makeBounceLoop(base(), 'a', 2)
    const f = frames(c)
    expect(f.slice(0, N)).toEqual(Array.from({ length: N }, (_, j) => j))
    expect(f.slice(N, N + N - 2)).toEqual(Array.from({ length: N - 2 }, (_, j) => N - 2 - j))
    expect(f.slice(N + N - 2, N + N - 2 + N)).toEqual(Array.from({ length: N }, (_, j) => j)) // second lap starts on 0
    // no two neighbouring frames are equal anywhere
    for (let i = 1; i < f.length; i++) expect(f[i]).not.toBe(f[i - 1])
    // and every step is one frame (no jump)
    for (let i = 1; i < f.length; i++) expect(Math.abs(f[i] - f[i - 1])).toBe(1)
  })

  it('computes the total duration correctly', () => {
    const b = base()
    const c = makeBounceLoop(b, 'a')
    expect(projectDurationMs(c)).toBe(projectDurationMs(b) + (backCopyOf(b.clips[0])!.durationMs))
    expect(loopDurationMs(b.clips[0])).toBe(c.clips[0].durationMs + c.clips[1].durationMs)
    expect(c.clips[1].durationMs).toBe(Math.round(N * FRAME_MS - 2 * FRAME_MS))
    expect(makeBounceLoop(base(), 'a', 3).clips.filter(k => k.visualAssetId === 'vid1')).toHaveLength(6)
  })

  it('cuts between the pair so the loop is seamless and keeps the original transition to the next clip', () => {
    const b = base(); b.clips[0].transition = 'dissolve'
    const c = makeBounceLoop(b, 'a')
    expect(c.clips[0].transition).toBe('cut'); expect(c.clips[1].transition).toBe('dissolve')
  })

  it('undo restores the original montage', () => {
    let h = historyOf(base())
    h = commit(h, makeBounceLoop(h.present, 'a'))
    expect(h.present.clips).toHaveLength(3)
    h = undo(h); expect(h.present.clips).toHaveLength(2)
    h = redo(h); expect(h.present.clips).toHaveLength(3)
  })
})

describe('reverse frame reader (bounded memory)', () => {
  // A fake decoder: 3000 frames at 30 fps = 100 s. It counts how many frames are alive in a window at once.
  const FPS = 30, TOTAL = 3000
  const mk = () => {
    const log = { requested: [] as Array<[number, number]> }
    const sink: FrameSink = {
      async *canvases(start = 0, end = Infinity) {
        log.requested.push([start, end])
        // a real decoder starts at the frame shown at `start` and stops before `end`
        for (let k = Math.max(0, Math.floor(start * FPS + 1e-9)); k < TOTAL && k / FPS < end - 1e-9; k++) yield { canvas: { width: 8, height: 8 } as unknown as HTMLCanvasElement, timestamp: k / FPS, k } as RevFrame & { k: number }
      },
    }
    return { sink, log }
  }
  const idx = (f: RevFrame | null) => (f as unknown as { k: number } | null)?.k

  it('forward mode (speed ramps): walks 600 frames forwards through windows, in order, bounded, with look-ahead', async () => {
    const { sink } = mk()
    for (const look of [false, true]) {
      const r = new ReverseFrameReader(sink, FPS, 30, look, true)
      const got: number[] = []
      for (let j = 0; j < 600; j++) got.push(idx(await r.get((300 + j + 0.5) / FPS))!)
      expect(got).toEqual(Array.from({ length: 600 }, (_, j) => 300 + j))
      expect(r.stats.peakFrames).toBeLessThanOrEqual(34)
      expect(r.stats.framesDecoded).toBeLessThan(600 * 2.2)
    }
  })

  it('serves 600 frames of a 100 s file backwards, in order, with no frame lost, and never holds more than a window', async () => {
    const { sink } = mk()
    const r = new ReverseFrameReader(sink, FPS, 30, false)
    const got: number[] = []
    for (let j = 0; j < 600; j++) got.push(idx(await r.get((2400 - j + 0.5) / FPS))!)
    expect(got).toEqual(Array.from({ length: 600 }, (_, j) => 2400 - j))
    expect(r.stats.peakFrames).toBeLessThanOrEqual(34)             // a window, not the clip
    expect(r.stats.framesDecoded).toBeLessThan(600 * 1.4)          // each frame decoded ~once (overlap only at window edges)
    expect(r.stats.windows).toBeGreaterThan(15)
  })

  it('with look-ahead, the previous window is ready before the playhead reaches it', async () => {
    const { sink } = mk()
    const r = new ReverseFrameReader(sink, FPS, 30, true)
    let misses = 0
    await r.get(1000.5 / FPS)
    for (let j = 1; j < 300; j++) {
      await new Promise(res => setTimeout(res, 0)) // the decoder works while frames are shown
      if (!r.peek((1000 - j + 0.5) / FPS)) { misses++; await r.get((1000 - j + 0.5) / FPS) }
    }
    expect(misses).toBeLessThan(3)
  })

  it('sizes windows from a byte budget: 1080p frames get a small window, 960 px ones a larger one', () => {
    expect(framesForBudget(1920, 1080, 160 * 1048576)).toBeLessThan(25)
    expect(framesForBudget(960, 540, 96 * 1048576)).toBeGreaterThan(40)
    expect(framesForBudget(7680, 4320, 1)).toBe(6)
  })
})
