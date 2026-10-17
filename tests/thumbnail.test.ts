import { describe, expect, it } from 'vitest'
import { thumbnailPrompt, validThumbnail } from '@/lib/providers/thumbnail-prompt'
import { catalog } from '@/lib/providers/catalog'
import { rankModels } from '@/lib/providers/router'

describe('thumbnails', () => {
  it('validates the spec and builds a 16:9 prompt with exact overlay text', () => {
    expect(validThumbnail({ concept: '' })).toBeNull()
    expect(validThumbnail({ concept: 'x', overlayText: 'y'.repeat(41) })).toBeNull()
    const t = validThumbnail({ concept: 'Un faro en la tormenta', overlayText: 'SOBREVIVIÓ', style: 'nope' })!
    expect(t.style).toBe('documentary')
    const p = thumbnailPrompt(t)
    expect(p).toContain('16:9')
    expect(p).toContain('"SOBREVIVIÓ"')
    expect(thumbnailPrompt({ concept: 'faro' })).toContain('No text')
  })
  it('auto choice needs high quality and text rendering when there is overlay text', () => {
    const ready = Object.fromEntries(catalog.map(m => [m.id, { ready: true }]))
    const r = rankModels(catalog, { modality: 'image', strategy: 'best_value', minQuality: 4, format: '16:9', needs: ['text_in_image'] }, ready).find(x => x.eligible)!
    expect(r.model.quality).toBeGreaterThanOrEqual(4)
    expect(r.model.capabilities).toContain('text_in_image')
    expect(r.model.confirm).toBeFalsy()
  })
})
