import { describe, expect, it } from 'vitest'
import { checkingSink, headOfComposition } from '@/lib/editor/export-selftest'
import { parseComposition, totalDurationMs, projectDurationMs } from '@/lib/editor/composition'

const comp = (n: number) => parseComposition({
  version: 1, title: 't', format: '16:9', storyboardId: 's', editedManually: true,
  clips: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, sceneId: 'manual', position: i + 1, visualAssetId: 'v', durationMs: 4000, transition: 'dissolve', transitionMs: 1000 })),
  audioClips: [{ id: 'a0', kind: 'music', assetId: 'm0', startMs: 0, offsetMs: 0, trimInMs: 0, durationMs: 90000, volume: 0.5 }, { id: 'a1', kind: 'music', assetId: 'm1', startMs: 90000, offsetMs: 0, trimInMs: 0, durationMs: 90000, volume: 0.5 }],
})!

describe('export self-test helpers', () => {
  it('cuts a long montage to its first seconds (clips, last clip and songs)', () => {
    const h = headOfComposition(comp(100), 20000)
    expect(totalDurationMs(h)).toBe(20000)
    expect(h.clips.length).toBe(5)
    expect(h.audioClips?.length).toBe(1)
    expect(h.audioClips?.[0].durationMs).toBe(20000)
    expect(projectDurationMs(h)).toBe(20000)
    expect(h.exportSettings).toEqual(comp(100).exportSettings)
  })
  it('trims the last clip when the cut falls inside it', () => {
    const h = headOfComposition(comp(100), 18500)
    expect(totalDurationMs(h)).toBe(18500)
    expect(h.clips.at(-1)?.transition).toBe('fade')
  })
  it('a shorter montage is left whole', () => {
    expect(headOfComposition(comp(2), 20000).clips.length).toBe(2)
  })
  it('the checking sink accepts in-order writes and flags a seek back', async () => {
    const ok = checkingSink(); const w = ok.stream.getWriter()
    await w.write({ type: 'write', data: new Uint8Array(10), position: 0 }); await w.write({ type: 'write', data: new Uint8Array(5), position: 10 })
    expect(ok.stats()).toMatchObject({ bytes: 15, writes: 2, sequential: true })
    const bad = checkingSink(); const w2 = bad.stream.getWriter()
    await w2.write({ type: 'write', data: new Uint8Array(10), position: 0 }); await w2.write({ type: 'write', data: new Uint8Array(4), position: 2 })
    expect(bad.stats()).toMatchObject({ sequential: false, firstBadAt: 2 })
  })
})
