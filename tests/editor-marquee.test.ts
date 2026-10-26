import { describe, expect, it } from 'vitest'
import { itemsInMarquee, marqueeSelection } from '@/lib/editor/marquee'
import { sliderAnchor } from '@/lib/editor/timeline-zoom'
import type { Composition } from '@/lib/editor/composition'

const comp = (n: number) => ({
  clips: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, visualAssetId: 'a', durationMs: 1000, transition: 'cut' })),
  audioClips: [{ id: 'm1', kind: 'music', assetId: 'x', startMs: 2000, offsetMs: 0, trimInMs: 0, durationMs: 3000, volume: 1, linkedClipId: null }],
  overlays: [], textClips: [{ id: 't1', content: 'hi', startMs: 0, durationMs: 1500 }],
}) as unknown as Composition
const rows = [{ id: 'main', type: 'main', top: 20, bottom: 70 }, { id: 'text', type: 'text', top: 76, bottom: 110 }, { id: 'music', type: 'music', top: 116, bottom: 160 }]

describe('marquee', () => {
  it('selects the clips it touches, left to right and right to left', () => {
    const c = comp(500), px = 10 // 10 px per second => 1 clip = 10 px
    const a = itemsInMarquee(c, rows, { x0: 5, y0: 30, x1: 105, y1: 40 }, px)
    const b = itemsInMarquee(c, rows, { x0: 105, y0: 40, x1: 5, y1: 30 }, px)
    expect(a.length).toBe(11); expect(b).toEqual(a)
  })
  it('only the rows it crosses, and across several tracks', () => {
    const c = comp(20), px = 10
    expect(itemsInMarquee(c, rows, { x0: 0, y0: 30, x1: 200, y1: 40 }, px).every(r => r.kind === 'clip')).toBe(true)
    const all = itemsInMarquee(c, rows, { x0: 25, y0: 30, x1: 40, y1: 130 }, px).map(r => r.kind)
    expect(all).toContain('clip'); expect(all).toContain('audio')
  })
  it('selects 100 clips of a 1387-clip montage far from the start', () => {
    const c = comp(1387), px = 4
    expect(itemsInMarquee(c, rows, { x0: 700 * 4, y0: 30, x1: 800 * 4, y1: 40 }, px).length).toBeGreaterThanOrEqual(100)
  })
  it('ctrl/shift keeps the selection held at the start', () => {
    const c = comp(10)
    const r = marqueeSelection(c, rows, { x0: 0, y0: 30, x1: 15, y1: 40 }, 10, [{ kind: 'clip', id: 'c9' }], true)
    expect(r.map(x => x.id)).toEqual(['c9', 'c0', 'c1'])
  })
})
describe('sliderAnchor', () => {
  it('keeps the playhead where it is on screen', () => {
    const a = sliderAnchor(3000, 10, 29000, 1000) // playhead at 30000 px - 29000 = 1000 -> edge, still visible
    expect(a.t).toBe(3000); expect(a.x).toBe(1000)
  })
  it('falls back to the centre of the window when the playhead is off screen', () => {
    const a = sliderAnchor(10, 10, 5000, 1000)
    expect(a.x).toBe(500); expect(a.t).toBe((5000 + 500) / 10)
  })
})
