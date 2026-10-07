import { describe, expect, it } from 'vitest'
import { suggestSegment } from '@/lib/editor/repurpose'
import type { Clip } from '@/lib/editor/composition'

const clip = (n: number, narration: string | null, seconds: number, visual = true): Clip => ({ id: `c${n}`, sceneId: `s${n}`, position: n, narration, visualAssetId: visual ? `a${n}` : null, voiceAssetId: null, durationMs: seconds * 1000, motion: 'none' })

describe('suggestSegment (calculated, deterministic)', () => {
  const clips = [
    clip(1, 'Una introducción larga sin gancho que explica el contexto histórico', 20, false),
    clip(2, '¿Por qué nadie sobrevivió a aquella caída de 3000 metros?', 12),
    clip(3, 'Ella despertó sola en la selva y caminó once días siguiendo un arroyo.', 20),
    clip(4, 'Así volvió a la civilización.', 10),
    clip(5, 'Epílogo sin cierre', 40),
  ]
  it('picks a contiguous run that starts with the hook and respects the platform limit', () => {
    const s = suggestSegment(clips, { maxMs: 60_000 })!
    expect(s.sceneIds[0]).toBe('s2')
    expect(s.durationMs).toBeLessThanOrEqual(60_000)
    const idx = s.sceneIds.map(id => Number(id.slice(1)))
    expect(idx).toEqual(idx.map((_, k) => idx[0] + k))
    expect(s.method).toBe('heuristic')
    expect(s.reasons.join(' ')).toMatch(/gancho/)
  })
  it('never exceeds the limit and is deterministic', () => {
    const a = suggestSegment(clips, { maxMs: 35_000 })!
    expect(a.durationMs).toBeLessThanOrEqual(35_000)
    expect(suggestSegment(clips, { maxMs: 35_000 })).toEqual(a)
  })
  it('prefers scenes that have visuals', () => {
    const noVisual = [clip(1, '¿Y si todo fuera mentira? Una historia de 1971.', 30, false), clip(2, '¿Y si todo fuera mentira? Una historia de 1971.', 30, true)]
    expect(suggestSegment(noVisual, { maxMs: 30_000 })!.sceneIds).toEqual(['s2'])
  })
  it('returns null when nothing fits or there are no clips', () => {
    expect(suggestSegment([], { maxMs: 60_000 })).toBeNull()
    expect(suggestSegment([clip(1, 'x', 120)], { maxMs: 60_000 })).toBeNull()
  })
})
