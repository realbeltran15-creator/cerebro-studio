import { describe, expect, it } from 'vitest'
import { parseComposition, type Composition } from '@/lib/editor/composition'

/** A montage with every property the editor can set, as it is stored in render_jobs.composition (jsonb). */
export function everything(): Composition {
  return {
    version: 1, storyboardId: 'sb', title: 'Todo', format: 'custom', customSize: { width: 1080, height: 1350 },
    editedManually: true, subtitles: true, captionStyle: 'karaoke', fadeMs: 450, duckMusic: false, musicAssetId: 'bg', musicVolume: 0.3,
    hookText: 'Mira esto', hookMs: 2500, origin: null, autoSnapshot: null, styleRef: null,
    clips: [
      { id: 'c1', sceneId: 's1', position: 1, narration: 'Hola', visualAssetId: 'img1', voiceAssetId: null, durationMs: 4000, motion: 'none', focusX: 0.3, focusY: 0.7, zoom: 1.4, trimInMs: 0, volume: 1, muted: false,
        transition: 'blur', transitionMs: 1200, text: { content: 'Uno', position: 'top', sizePct: 7, animation: 'pop', font: 'serif', color: '#ff0000', x: 0.4, y: 0.2, outAnimation: 'slide', outline: '#00ff00', outlineWidth: 14, shadow: true, background: '#000000', backgroundOpacity: 0.4, bold: false },
        speed: 1, camera: { kind: 'pan_right', amount: 0.2 }, filters: { brightness: 1.2, contrast: 0.9, saturation: 0, blur: 0.5 }, crop: { left: 0.1, top: 0.05, right: 0, bottom: 0.2 }, rotation: 12, opacity: 0.8, groupId: 'g1',
        cues: [{ startMs: 0, endMs: 1500, text: 'Hola' }] },
      { id: 'c2', sceneId: 's2', position: 2, narration: null, visualAssetId: 'vid1', voiceAssetId: null, durationMs: 3000, motion: 'none', focusX: 0.5, focusY: 0.5, zoom: 1, trimInMs: 2500, volume: 0.6, muted: true, transition: 'slide_up', text: null, speed: 2, camera: null },
    ],
    audioClips: [
      { id: 'a1', assetId: 'mus', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 500, trimInMs: 1000, durationMs: 6000, volume: 0.7, muted: false, fadeInMs: 800, fadeOutMs: 1500, envelope: [{ atMs: 0, gain: 1 }, { atMs: 3000, gain: 0.2 }], pan: -0.4, trackId: 'mus2', groupId: 'g1' },
      { id: 'a2', assetId: 'vo', kind: 'voice', linkedClipId: 'c1', offsetMs: 200, startMs: 0, trimInMs: 0, durationMs: 1500, volume: 1, muted: true },
      { id: 'a3', assetId: 'fx', kind: 'sfx', linkedClipId: null, offsetMs: 0, startMs: 3000, trimInMs: 0, durationMs: 400, volume: 1, muted: false, origin: 'cut-sfx' },
    ],
    textClips: [{ id: 't1', content: 'Título', position: 'center', sizePct: 9, animation: 'typewriter', font: 'condensed', color: '#ffffff', startMs: 1000, durationMs: 2000, trackId: 'tx2', outAnimation: 'fade', shadow: true }],
    overlays: [{ id: 'o1', trackId: 'ov1', assetId: 'logo', startMs: 1500, durationMs: 4000, trimInMs: 300, speed: 0.5, volume: 0.4, muted: true,
      transform: { x: 0.8, y: 0.2, scale: 0.25, rotation: -15, opacity: 0.9 }, keyframes: [{ atMs: 0, x: 0.1, opacity: 0 }, { atMs: 2000, x: 0.8, scale: 0.5, rotation: 30, opacity: 1 }],
      crop: { left: 0, top: 0.1, right: 0.1, bottom: 0 }, filters: { brightness: 1, contrast: 1.3, saturation: 1.2, blur: 0 }, camera: { kind: 'zoom_in', amount: 0.15 }, fadeInMs: 500, fadeOutMs: 700, groupId: 'g2' }],
    tracks: [
      { id: 'ov1', type: 'overlay', name: 'Logo', locked: true },
      { id: 'main', type: 'main', name: 'Vídeo principal', hidden: true },
      { id: 'text', type: 'text', name: 'Texto' }, { id: 'tx2', type: 'text', name: 'Rótulos', solo: true },
      { id: 'voice', type: 'voice', name: 'Voz', muted: true }, { id: 'music', type: 'music', name: 'Música' }, { id: 'mus2', type: 'music', name: 'Música 2', solo: true }, { id: 'sfx', type: 'sfx', name: 'Efectos' },
    ],
    markers: [{ id: 'm1', atMs: 1234, label: 'Aquí', color: '#ffaa00' }],
    mix: { voice: { gain: 1.2, muted: false, solo: false }, music: { gain: 0.5, muted: true, solo: false }, sfx: { gain: 1, muted: false, solo: true }, video: { gain: 0.8, muted: false, solo: false } },
    exportSettings: { quality: 'high', resolution: '1440', videoKbps: 12000, destination: 'download', mode: 'realtime' },
  }
}

describe('persistence: every property survives the round trip to the database', () => {
  it('stored → read back is identical', () => {
    const c = everything()
    const back = parseComposition(JSON.parse(JSON.stringify(c)))
    expect(back).toEqual(c)
  })
  it('reading it twice changes nothing (stable)', () => {
    const once = parseComposition(JSON.parse(JSON.stringify(everything())))!
    expect(parseComposition(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })
})
