import { describe, expect, it } from 'vitest'
import { emptyComposition, exportPlan } from '@/lib/editor/composition'
import { buildLoopMontage } from '@/lib/editor/loop-montage'
import { browserExportAdvice } from '@/lib/editor/export-limits'

describe('browser export memory advice', () => {
  it('stays silent for normal exports and warns for very large ones', () => {
    expect(browserExportAdvice(300 * 1024 ** 2).level).toBe('ok')
    const a = browserExportAdvice(3.4 * 1024 ** 3)
    expect(a.level).toBe('heavy'); expect(a.neededGB).toBeGreaterThan(8); expect(a.message).toMatch(/Paquete para renderizar en mi PC/)
  })
  it('a 90-minute 1080p montage (download) is flagged; a 5-minute one is not', () => {
    const long = buildLoopMontage({ title: 'x', scenes: [{ assetId: 'a', kind: 'image' }], music: null, targetMs: 90 * 60_000, resolution: '1080' }).composition
    const short = buildLoopMontage({ title: 'x', scenes: [{ assetId: 'a', kind: 'image' }], music: null, targetMs: 5 * 60_000, resolution: '1080' }).composition
    expect(browserExportAdvice(exportPlan(long).estimatedBytes).level).toBe('heavy')
    expect(browserExportAdvice(exportPlan(short).estimatedBytes).level).toBe('ok')
    expect(emptyComposition('a', 'b').clips).toHaveLength(0)
  })
})
