import { describe, expect, it } from 'vitest'
import { emptyComposition, tracksOf, type Composition } from '@/lib/editor/composition'
import { addMaskedCopy, DEFAULT_MASK_POINTS } from '@/lib/editor/tracks'
import { frameAt } from '@/lib/editor/scene'
import { sourceAt } from '@/lib/editor/reverse'

const comp = (): Composition => {
  const c = emptyComposition('sb', 'Lofi')
  return { ...c, clips: [
    { id: 'a', sceneId: 'a', position: 0, narration: null, visualAssetId: 'img', voiceAssetId: null, durationMs: 2000, motion: 'none' },
    { id: 'b', sceneId: 'b', position: 1, narration: null, visualAssetId: 'water', voiceAssetId: null, durationMs: 6000, motion: 'none', trimInMs: 1500, speed: 1 },
  ] }
}

describe('«Cambiar una zona (máscara)»', () => {
  it('puts a muted, reversed, full-frame copy of the clip on a new overlay track, exactly over it, limited to a soft free mask', () => {
    const r = addMaskedCopy(comp(), 'b')!
    const o = r.composition.overlays!.find(x => x.id === r.id)!
    expect(o).toMatchObject({ assetId: 'water', startMs: 2000, durationMs: 6000, trimInMs: 1500, muted: true, reverse: true, transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 } })
    expect(o.fx?.mask).toEqual({ shape: 'polygon', inset: 0, points: DEFAULT_MASK_POINTS, feather: 0.03 })
    const track = tracksOf(r.composition).find(t => t.id === o.trackId)!
    expect(track).toMatchObject({ type: 'overlay', name: 'Máscara' })
  })
  it('the copy reads the same stretch backwards: at the start it shows the end of the window, at the end the start', () => {
    const r = addMaskedCopy(comp(), 'b')!
    const o = r.composition.overlays!.find(x => x.id === r.id)!
    expect(sourceAt(o, 0)).toBeGreaterThan(7400)
    expect(sourceAt(o, 6000 - 1)).toBeLessThan(1600)
  })
  it('a reversed clip gets a forward copy; reverse can be forced off', () => {
    const c = comp(); c.clips[1] = { ...c.clips[1], reverse: true }
    expect(addMaskedCopy(c, 'b')!.composition.overlays![0].reverse).toBeUndefined()
    expect(addMaskedCopy(comp(), 'b', { reverse: false })!.composition.overlays![0].reverse).toBeUndefined()
  })
  it('the viewer draws the copy above the clip with its mask, only while the clip plays', () => {
    const r = addMaskedCopy(comp(), 'b')!
    const kindOf = (id: string | null) => (id === 'water' ? 'video' : 'image') as 'video' | 'image'
    const ops = frameAt(r.composition, 3000, kindOf)
    const ov = ops.find(op => op.type === 'visual' && op.slot === `ov:${r.id}`)
    expect(ov && ov.type === 'visual' && ov.fx?.mask?.shape).toBe('polygon')
    expect(frameAt(r.composition, 1000, kindOf).some(op => op.type === 'visual' && op.slot === `ov:${r.id}`)).toBe(false)
  })
  it('no picture → nothing', () => {
    const c = comp(); c.clips[1] = { ...c.clips[1], visualAssetId: null }
    expect(addMaskedCopy(c, 'b')).toBeNull()
  })
})
