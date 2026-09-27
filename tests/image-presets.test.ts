import { describe, expect, it } from 'vitest'
import { buildImagePrompt, imagePresets, presetFrom, sizeForFormat } from '@/lib/providers/image-presets'
import { compositionAssetIds } from '@/lib/editor/client'
import { emptyComposition } from '@/lib/editor/composition'
import { toManual } from '@/lib/editor/timeline'

describe('image prompt pipeline', () => {
  it('offers the documentary presets requested for YouTube stories', () => {
    expect(Object.values(imagePresets).map(p => p.label)).toEqual(['Fotorealista', 'Cinematográfico', 'Documental', 'Archivo / histórico', 'Ilustración'])
  })
  it('matches the image size to the montage format instead of a square crop', () => {
    expect(sizeForFormat('16:9')).toBe('1536x1024')
    expect(sizeForFormat('9:16')).toBe('1024x1536')
    expect(sizeForFormat(undefined)).toBe('1536x1024')
  })
  it('builds a photographic prompt with realism rules and the usual AI tells to avoid', () => {
    const p = buildImagePrompt({ subject: 'Un hombre solo en una cocina de los años 70', preset: 'documentary', format: '16:9', context: 'Miedo a hablar en público' })
    expect(p).toContain('Scene: Un hombre solo en una cocina de los años 70')
    expect(p).toContain('Horizontal 16:9 frame')
    expect(p).toMatch(/available light/i)
    expect(p).toMatch(/skin pores/i)
    expect(p).toMatch(/Avoid: glossy or plastic-looking skin/)
    expect(p).not.toMatch(/premium color grading|dramatic lighting,/i)
  })
  it('illustration keeps the avoid list but not photographic realism rules', () => {
    const p = buildImagePrompt({ subject: 'x', preset: 'illustration' })
    expect(p).not.toMatch(/skin pores/)
    expect(p).toMatch(/Avoid:/)
  })
  it('maps legacy style ids to presets', () => {
    expect(presetFrom('vintage')).toBe('archival')
    expect(presetFrom('cinematic')).toBe('cinematic')
    expect(presetFrom('nope')).toBe('documentary')
  })
})

describe('render inputs include audio tracks', () => {
  it('downloads visuals, voices, music and audio-track clips', () => {
    const c = emptyComposition('sb', 't')
    c.clips = [{ id: 'a', sceneId: 'a', position: 1, narration: null, visualAssetId: 'img', voiceAssetId: 'v1', durationMs: 3000, motion: 'none' }]
    c.musicAssetId = 'm'
    const m = toManual(c)
    m.audioClips!.push({ id: 's', assetId: 'sfx1', kind: 'sfx', linkedClipId: null, offsetMs: 0, startMs: 500, trimInMs: 0, durationMs: 800, volume: 1, muted: false })
    expect(compositionAssetIds(m).sort()).toEqual(['img', 'm', 'sfx1', 'v1'])
  })
})
