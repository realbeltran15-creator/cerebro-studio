import { emptyComposition, type AudioClip, type Clip, type Composition } from '@/lib/editor/composition'
import { wordCount } from '@/lib/scripts'
import type { ShortScript } from './script'

/** Duration of a WAV file in ms, read from its header (no decoding); null when it is not a readable PCM WAV. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4))
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let byteRate = 0
  for (let o = 12; o + 8 <= bytes.length;) {
    const size = v.getUint32(o + 4, true)
    if (tag(o) === 'fmt ' && o + 20 <= bytes.length) byteRate = v.getUint32(o + 16, true)
    if (tag(o) === 'data') {
      // Some encoders stream the file and leave the data size as 0 or 0xFFFFFFFF: use what is actually there.
      const available = bytes.length - (o + 8)
      const data = size === 0 || size === 0xffffffff || size > available ? available : size
      return byteRate > 0 ? Math.round((data / byteRate) * 1000) : null
    }
    o += 8 + size + (size % 2)
  }
  return null
}

/** The voice must be roughly as long as the script says; far off means a broken or truncated synthesis. */
export function voiceLooksRight(audioMs: number | null, estimatedSeconds: number) {
  if (audioMs === null) return false
  const ratio = audioMs / 1000 / Math.max(estimatedSeconds, 1)
  return ratio >= 0.5 && ratio <= 1.8 && audioMs >= 8000 && audioMs <= 75_000
}

/** Scene lengths proportional to their words and adding up to the audio, each at least 1.5 s. */
export function sceneDurations(narrations: string[], audioMs: number) {
  const words = narrations.map(n => Math.max(wordCount(n), 1))
  const total = words.reduce((a, b) => a + b, 0)
  const raw = words.map(w => Math.max(1500, Math.round((w / total) * audioMs)))
  const extra = raw.reduce((a, b) => a + b, 0) - audioMs
  if (extra > 0) {
    // Take the surplus (from the minimum lengths) out of the longest scene.
    const longest = raw.indexOf(Math.max(...raw))
    raw[longest] = Math.max(1500, raw[longest] - extra)
  }
  return raw
}

export const HOOK_MS = 2200

export function buildShortComposition(input: {
  storyboardId: string
  title: string
  script: ShortScript
  scenes: Array<{ id: string; position: number }>
  durationsMs: number[]
  imageAssetIds: Array<string | null>
  voiceAssetId: string
  audioMs: number
  musicAssetId: string | null
}): Composition {
  const base = emptyComposition(input.storyboardId, input.title, '9:16')
  const clips: Clip[] = input.scenes.map((scene, i) => ({
    id: scene.id, sceneId: scene.id, position: scene.position, narration: input.script.scenes[i].narration,
    visualAssetId: input.imageAssetIds[i] ?? null, voiceAssetId: null, durationMs: input.durationsMs[i], motion: 'kenburns', focusX: 0.5, transition: 'cut',
    // The data is on screen from the first frame; later scenes carry their own short text.
    text: input.script.scenes[i].onScreenText ? { content: input.script.scenes[i].onScreenText, position: i === 0 ? 'center' : 'top', sizePct: i === 0 ? 8 : 5 } : null,
  }))
  const voice: AudioClip = { id: 'voice-main', assetId: input.voiceAssetId, kind: 'voice', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: input.audioMs, volume: 1, muted: false }
  return {
    ...base, clips, audioClips: [voice], musicAssetId: input.musicAssetId, musicVolume: 0.12, duckMusic: true, subtitles: true, fadeMs: 150,
    hookText: input.script.scenes[0].onScreenText || null, hookMs: HOOK_MS, editedManually: true,
  }
}
