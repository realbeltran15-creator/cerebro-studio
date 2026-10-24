/**
 * The «verification project» used to compare the offline engine with the browser: 13 s, red (dissolve) → green video (wipe) → blue (slide)
 * → yellow; a magenta video as an overlay 4.5–8.5 s at the top right; a title; subtitles; two music clips (one with volume automation),
 * a voice (the music ducks under it), an effect. Shared by the Node side and the browser side so both render the very same montage.
 */
import { emptyComposition, type Composition } from '../../lib/editor/composition'
import { addAudioClip, addClip, addTextClip, updateClip } from '../../lib/editor/timeline'
import { addOverlay, addTrack } from '../../lib/editor/tracks'

export const MEDIA: Record<string, { kind: 'image' | 'video' | 'audio'; file: string }> = {
  red: { kind: 'image', file: 'red.png' }, blue: { kind: 'image', file: 'blue.png' }, yellow: { kind: 'image', file: 'yellow.png' },
  green: { kind: 'video', file: 'green.mp4' }, magenta: { kind: 'video', file: 'magenta.mp4' },
  m1: { kind: 'audio', file: 'm1.wav' }, m2: { kind: 'audio', file: 'm2.wav' }, vo: { kind: 'audio', file: 'vo.wav' }, fx: { kind: 'audio', file: 'fx.wav' },
}

export function parityProject(): Composition {
  let c: Composition = { ...emptyComposition('sb', 'Verificación'), editedManually: true, fadeMs: 400, subtitles: true, duckMusic: true }
  c = addClip(c, 'red', 3000); c = addClip(c, 'green', 4000); c = addClip(c, 'blue', 3000); c = addClip(c, 'yellow', 3000)
  c = updateClip(c, c.clips[0].id, { transition: 'dissolve', narration: 'Hola a todos' })
  c = updateClip(c, c.clips[1].id, { transition: 'wipe' })
  c = updateClip(c, c.clips[2].id, { transition: 'slide' })
  const tr = addTrack(c, 'overlay'); c = tr.composition
  c = addOverlay(c, { assetId: 'magenta', startMs: 4500, durationMs: 4000, trackId: tr.trackId, transform: { x: 0.75, y: 0.3, scale: 0.3, rotation: 0, opacity: 1 } }).composition
  c = addTextClip(c, { content: 'TITULO', startMs: 500, durationMs: 2500, position: 'top', sizePct: 8, animation: 'none', color: '#ffffff' })
  c = addAudioClip(c, { assetId: 'm1', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 13000, volume: 0.6, muted: false, envelope: [{ atMs: 5500, gain: 1 }, { atMs: 6000, gain: 0.1 }] })
  c = addAudioClip(c, { assetId: 'm2', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 6000, trimInMs: 0, durationMs: 7000, volume: 0.5, muted: false })
  c = addAudioClip(c, { assetId: 'vo', kind: 'voice', linkedClipId: null, offsetMs: 0, startMs: 1500, trimInMs: 0, durationMs: 1500, volume: 1, muted: false })
  c = addAudioClip(c, { assetId: 'fx', kind: 'sfx', linkedClipId: null, offsetMs: 0, startMs: 9000, trimInMs: 0, durationMs: 500, volume: 1, muted: false })
  return { ...c, exportSettings: { quality: 'normal', resolution: '720', destination: 'download' } }
}

/** [time ms, x, y] as fractions of the frame: plain areas, transition mid-points included (those are compared with a looser tolerance). */
export const SAMPLES: Array<[number, number, number]> = [
  [1200, 0.5, 0.8], [4000, 0.3, 0.6], [5500, 0.3, 0.6], [5500, 0.75, 0.3], [8000, 0.75, 0.3], [11000, 0.5, 0.5], [12000, 0.4, 0.6], [2800, 0.5, 0.6], [6800, 0.2, 0.6], [6800, 0.9, 0.5],
  [2900, 0.5, 0.5], [6900, 0.5, 0.5], [3300, 0.5, 0.5],
]
export const TONES: Array<[string, number, number, number]> = [
  ['music1_before_voice', 110, 300, 1300], ['music1_under_voice', 110, 1900, 2900], ['voice', 330, 1900, 2900], ['voice_after', 330, 3500, 4500],
  ['music1_after_automation', 110, 6500, 7500], ['music2', 165, 6500, 7500], ['music2_before', 165, 4000, 5500], ['sfx', 880, 9050, 9450], ['sfx_before', 880, 8000, 8800],
  ['video_main', 440, 3600, 4400], ['video_main_after', 440, 7600, 8400], ['video_overlay', 660, 5000, 8000], ['video_overlay_before', 660, 3500, 4300],
]
/** Energy of a tone (Goertzel) in [fromMs, toMs) of a mono mix. */
export function tone(samples: Float32Array, rate: number, freq: number, fromMs: number, toMs: number) {
  const a = Math.floor(fromMs / 1000 * rate), b = Math.min(samples.length, Math.floor(toMs / 1000 * rate))
  const k = 2 * Math.cos(2 * Math.PI * freq / rate)
  let s1 = 0, s2 = 0
  for (let i = a; i < b; i++) { const s0 = samples[i] + k * s1 - s2; s2 = s1; s1 = s0 }
  return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / Math.max(1, b - a)
}
