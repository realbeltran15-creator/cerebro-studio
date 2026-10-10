import { describe, expect, it } from 'vitest'
import { emptyComposition, type Composition } from '@/lib/editor/composition'
import { addAudioClip, splitClip, updateClip } from '@/lib/editor/timeline'
import { applyStyle, describeChange, learnStyle, mergeStyles } from '@/lib/editor/style'

const kind = (id: string | null) => (id?.startsWith('vid') ? 'video' as const : id ? 'image' as const : 'other' as const)

function base(): Composition {
  const c = emptyComposition('sb', 'Prueba')
  c.clips = [
    { id: 'a', sceneId: 'a', position: 1, narration: 'Uno', visualAssetId: 'vid1', voiceAssetId: null, durationMs: 9000, motion: 'kenburns', transition: 'fade', zoom: 1, volume: 1, muted: false },
    { id: 'b', sceneId: 'b', position: 2, narration: 'Dos', visualAssetId: 'img1', voiceAssetId: null, durationMs: 6000, motion: 'kenburns', transition: 'fade', zoom: 1 },
  ]
  return c
}

/** What the owner does by hand: cut the long video into 3 s pieces, hard cuts, zoom 1.2, mute video, narration as bottom text, a whoosh on every cut, music 20 %. */
function userEdit(c: Composition): Composition {
  let e = splitClip(c, 'a', 3000)
  e = splitClip(e, e.clips[1].id, 3000)
  e = updateClip(e, 'b', { durationMs: 3000 })
  e = { ...e, clips: e.clips.map(k => ({ ...k, transition: 'cut' as const, zoom: 1.2, muted: kind(k.visualAssetId) === 'video', text: k.narration ? { content: k.narration, position: 'bottom' as const, sizePct: 7 } : null })), musicVolume: 0.2 }
  for (const k of e.clips.slice(1)) e = addAudioClip(e, { assetId: 'whoosh', kind: 'sfx', linkedClipId: k.id, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 800, volume: 0.6, muted: false })
  return e
}

describe('learning an edit style', () => {
  const before = base()
  const after = userEdit(before)
  const style = learnStyle(before, after, kind, 'Rápido')

  it('measures pacing, cuts, framing, text, audio and SFX on cuts', () => {
    expect(style.pacing).toMatchObject({ medianClipMs: 3000, maxClipMs: 3000, splitLong: true, retime: true })
    expect(style.transitions.pattern).toBe('cut')
    expect(style.framing.zoom).toBeCloseTo(1.2)
    expect(style.text).toMatchObject({ narrationAsText: true, position: 'bottom', sizePct: 7 })
    expect(style.clipAudio.muteVideo).toBe(true)
    expect(style.mix.musicVolume).toBe(0.2)
    expect(style.sfxOnCuts).toEqual({ assetId: 'whoosh', volume: 0.6 })
    expect(style.observations.length).toBeGreaterThan(4)
  })

  it('replays the same habits on a different edit', () => {
    const other = base()
    other.clips[0] = { ...other.clips[0], id: 'x', durationMs: 12000, narration: 'Otra' }
    const { composition: out, changes } = applyStyle(other, style, kind)
    const videoParts = out.clips.filter(k => k.visualAssetId === 'vid1')
    expect(videoParts.length).toBe(4)
    expect(videoParts.every(k => k.durationMs === 3000 && k.muted)).toBe(true)
    expect(out.clips.every(k => k.transition === 'cut' && k.zoom === 1.2)).toBe(true)
    expect(out.clips.find(k => k.id === 'b')!.durationMs).toBe(3000)
    expect(out.clips[0].text).toEqual({ content: 'Otra', position: 'bottom', sizePct: 7 })
    expect(out.audioClips!.filter(a => a.assetId === 'whoosh').length).toBe(out.clips.length - 1)
    expect(out.musicVolume).toBe(0.2)
    expect(changes.length).toBeGreaterThan(3)
  })

  it('never cuts or retimes a clip that carries a voice', () => {
    let v = base()
    v = addAudioClip(v, { assetId: 'voz', kind: 'voice', linkedClipId: 'a', offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 8000, volume: 1, muted: false })
    const out = applyStyle(v, style, kind).composition
    expect(out.clips.find(k => k.id === 'a')!.durationMs).toBe(9000)
  })

  it('accumulates sessions', () => {
    const m = mergeStyles(style, { ...style, pacing: { ...style.pacing, medianClipMs: 5000 } })
    expect(m.samples).toBe(2)
    expect(m.pacing.medianClipMs).toBe(4000)
    expect(m.name).toBe('Rápido')
  })

  it('describes each recorded action', () => {
    const c = base()
    expect(describeChange(c, splitClip(c, 'a', 3000))).toBe('Clip dividido o añadido')
    expect(describeChange(c, updateClip(c, 'b', { transition: 'cut' }))).toBe('Transición')
    expect(describeChange(c, { ...c, musicVolume: 0.1 })).toBe('Música')
  })
})
