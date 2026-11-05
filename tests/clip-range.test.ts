import { describe, expect, it } from 'vitest'
import { emptyComposition } from '@/lib/editor/composition'
import { addVideoRange, checkClipRange } from '@/lib/editor/timeline'
import { isExportedVideo } from '@/lib/editor/client'

describe('clip range on insert', () => {
  it('validates the interval', () => {
    expect(checkClipRange(0, 5000, 10000)).toEqual({ ok: true, durationMs: 5000 })
    expect(checkClipRange(-1, 5000, 10000).ok).toBe(false)
    expect(checkClipRange(4000, 4000, 10000).ok).toBe(false)
    expect(checkClipRange(1000, 12000, 10000).ok).toBe(false)
    expect(checkClipRange(1000, 1500, 10000).ok).toBe(false)
    expect(checkClipRange(NaN, 3000, null).ok).toBe(false)
    expect(checkClipRange(1000, 3000, null)).toEqual({ ok: true, durationMs: 2000 })
  })
  it('inserts the chosen part already trimmed, at the given index', () => {
    const c0 = addVideoRange(emptyComposition('s', 't'), 'v1', 0, 3000)
    const c = addVideoRange(c0, 'v2', 2000, 6000, 0)
    expect(c.clips.map(k => [k.visualAssetId, k.durationMs, k.trimInMs ?? 0])).toEqual([['v2', 4000, 2000], ['v1', 3000, 0]])
  })
  it('keeps the offset when a long range is split into several clips', () => {
    const c = addVideoRange(emptyComposition('s', 't'), 'v', 10_000, 10_000 + 300_000)
    expect(c.clips.length).toBeGreaterThan(1)
    expect(c.clips[0].trimInMs).toBe(10_000)
    expect(c.clips[1].trimInMs).toBeGreaterThan(10_000)
  })
})
describe('exported video detection', () => {
  it('tells exports from imported clips', () => {
    expect(isExportedVideo({ asset_type: 'video', source_provider: 'browser-render', provenance: null })).toBe(true)
    expect(isExportedVideo({ asset_type: 'video', source_provider: 'upload', provenance: { purpose: 'short' } })).toBe(true)
    expect(isExportedVideo({ asset_type: 'video', source_provider: 'pexels', provenance: null })).toBe(false)
    expect(isExportedVideo({ asset_type: 'image', source_provider: 'browser-render', provenance: null })).toBe(false)
  })
})
