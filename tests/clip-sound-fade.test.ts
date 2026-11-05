import { describe, expect, it } from 'vitest'
import { parseComposition, envelopeAt } from '../lib/editor/composition'
import { clipSoundFade, videoVoices, frameAt } from '../lib/editor/scene'
import { splitClip, trimStart } from '../lib/editor/timeline'
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

  it('automatización de volumen por clip: varios puntos, interpolación lineal y fundidos combinados', () => {
    const c = comp({ volume: 1.5, volumeEnvelope: [{ atMs: 2000, gain: 0.2 }, { atMs: 0, gain: 1 }, { atMs: 3000, gain: 1 }], audioFadeOutMs: 1000 })
    expect(c.clips[0].volumeEnvelope).toEqual([{ atMs: 0, gain: 1 }, { atMs: 2000, gain: 0.2 }, { atMs: 3000, gain: 1 }])
    const vol = (t: number) => (frameAt(c, t, kindOf).find(o => o.type === 'visual') as { volume?: number } | undefined)?.volume
    expect(vol(0)).toBeCloseTo(1.5); expect(vol(1000)).toBeCloseTo(1.5 * 0.6); expect(vol(2000)).toBeCloseTo(1.5 * 0.2)
    expect(vol(2500)).toBeCloseTo(1.5 * 0.6); expect(vol(3500)).toBeCloseTo(1.5 * 0.5); expect(vol(3990)).toBeCloseTo(0, 1)
    const v = videoVoices(c, kindOf).find(x => x.key === 'vc:a')!
    for (const ms of [0, 500, 1000, 2000, 2500, 3000, 3500, 3900]) expect(envelopeAt(v.envelope!, ms) * 1.5).toBeCloseTo(vol(ms)!, 5)
  })
  it('valida puntos: descarta no numéricos y negativos, limita 0–2 y ordena', () => {
    const c = comp({ volumeEnvelope: [{ atMs: 500, gain: 9 }, { atMs: -1, gain: 1 }, { atMs: 'x', gain: 1 }, { atMs: 100, gain: -3 }, null] })
    expect(c.clips[0].volumeEnvelope).toEqual([{ atMs: 100, gain: 0 }, { atMs: 500, gain: 2 }])
    expect(comp({ volumeEnvelope: [] }).clips[0].volumeEnvelope).toBeUndefined()
  })
  it('dividir conserva el nivel en el corte, reparte los fundidos y recortar el inicio desplaza los puntos', () => {
    const c = comp({ audioFadeInMs: 500, audioFadeOutMs: 700, volumeEnvelope: [{ atMs: 0, gain: 1 }, { atMs: 2000, gain: 0.2 }, { atMs: 4000, gain: 1 }] })
    const r = splitClip(c, 'a', 1000)
    const [x, y] = r.clips
    expect(x.audioFadeInMs).toBe(500); expect(x.audioFadeOutMs).toBeUndefined(); expect(y.audioFadeInMs).toBeUndefined(); expect(y.audioFadeOutMs).toBe(700)
    expect(clipSoundFade({ ...x, audioFadeInMs: 0 }, 1000)).toBeCloseTo(0.6); expect(clipSoundFade({ ...y, audioFadeOutMs: 0 }, 0)).toBeCloseTo(0.6)
    expect(clipSoundFade({ ...y, audioFadeOutMs: 0 }, 1000)).toBeCloseTo(0.2); expect(y.volumeEnvelope).toEqual([{ atMs: 0, gain: 0.6 }, { atMs: 1000, gain: 0.2 }, { atMs: 3000, gain: 1 }])
    const t = trimStart(c, 'a', 1000).clips[0]
    expect(t.volumeEnvelope?.[0]).toEqual({ atMs: 0, gain: expect.closeTo(0.6, 5) }); expect(t.volumeEnvelope?.[1]).toEqual({ atMs: 1000, gain: 0.2 })
  })
})
