import { describe, expect, it } from 'vitest'
import { parseComposition } from '../lib/editor/composition'
import { clipSoundFade, videoVoices, frameAt } from '../lib/editor/scene'
import { envelopeAt } from '../lib/editor/composition'
import type { Composition } from '../lib/editor/composition'

const comp = (clip: Record<string, unknown>, extra: Record<string, unknown> = {}): Composition => parseComposition({
  version: 1, storyboardId: 'sb', title: 't', format: '16:9', musicAssetId: null, musicVolume: 0.25, duckMusic: true, subtitles: false, fadeMs: 300, origin: null,
  clips: [{ id: 'a', sceneId: 'a', position: 0, narration: null, visualAssetId: 'v1', voiceAssetId: null, durationMs: 4000, motion: 'none', trimInMs: 0, volume: 1, muted: false, transition: 'cut', ...clip },
    { id: 'b', sceneId: 'b', position: 1, narration: null, visualAssetId: 'v1', voiceAssetId: null, durationMs: 4000, motion: 'none', trimInMs: 0, volume: 1, muted: false, transition: 'cut' }], ...extra,
}) as Composition
const kindOf = () => 'video' as const

describe('fundidos del sonido propio de un clip de vídeo', () => {
  it('rampa lineal de entrada y salida', () => {
    const c = { durationMs: 4000, audioFadeInMs: 1000, audioFadeOutMs: 2000 }
    expect(clipSoundFade(c, 0)).toBe(0)
    expect(clipSoundFade(c, 500)).toBeCloseTo(0.5)
    expect(clipSoundFade(c, 1000)).toBe(1)
    expect(clipSoundFade(c, 2000)).toBe(1)
    expect(clipSoundFade(c, 3000)).toBeCloseTo(0.5)
    expect(clipSoundFade(c, 4000)).toBe(0)
    expect(clipSoundFade({ durationMs: 4000 }, 123)).toBe(1)
  })
  it('se guarda, se recupera y se descartan valores no válidos', () => {
    const c = comp({ audioFadeInMs: 800, audioFadeOutMs: 1200 })
    expect(c.clips[0].audioFadeInMs).toBe(800); expect(c.clips[0].audioFadeOutMs).toBe(1200)
    const bad = comp({ audioFadeInMs: -5, audioFadeOutMs: 'x' })
    expect(bad.clips[0].audioFadeInMs).toBeUndefined(); expect(bad.clips[0].audioFadeOutMs).toBeUndefined()
  })
  it('el visor aplica el fundido al volumen del fotograma', () => {
    const c = comp({ audioFadeInMs: 1000, volume: 1.5 })
    const vol = (t: number) => (frameAt(c, t, kindOf).find(o => o.type === 'visual') as { volume?: number } | undefined)?.volume
    expect(vol(0)).toBeCloseTo(0); expect(vol(500)).toBeCloseTo(0.75); expect(vol(1500)).toBeCloseTo(1.5)
  })
  it('la exportación recibe el mismo fundido (envolvente de la voz) y coincide con el visor', () => {
    const c = comp({ audioFadeInMs: 1000, audioFadeOutMs: 1500 })
    const v = videoVoices(c, kindOf).find(x => x.key === 'vc:a')!
    expect(v.envelope).toMatchObject({ fadeInMs: 1000, fadeOutMs: 1500, durationMs: 4000 })
    for (const ms of [0, 250, 700, 2000, 3000, 3600, 4000]) expect(envelopeAt(v.envelope!, ms)).toBeCloseTo(clipSoundFade(c.clips[0], ms), 5)
    expect(videoVoices(comp({}), kindOf).find(x => x.key === 'vc:a')!.envelope).toBeNull()
  })
})
