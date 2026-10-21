import { renderComposition } from '@/lib/editor/renderer'
import { emptyComposition, parseComposition, type Transition } from '@/lib/editor/composition'

async function img(color: string) { const oc = new OffscreenCanvas(1600, 900); const x = oc.getContext('2d')!; x.fillStyle = color; x.fillRect(0, 0, 1600, 900); return oc.convertToBlob({ type: 'image/png' }) }

/** Renders red → blue with the given transition (1 s inside a 2 s clip) and samples the frame halfway through it (no recording). */
;(window as any).runMotion = async (kind: Transition) => {
  const media = new Map<string, any>([['red', { kind: 'image', blob: await img('#ff0000') }], ['blue', { kind: 'image', blob: await img('#0000ff') }]])
  const base = emptyComposition('sb', 'Transición')
  base.fadeMs = 1000; base.subtitles = false
  base.clips = [
    { id: 'a', sceneId: 'a', position: 1, narration: null, visualAssetId: 'red', voiceAssetId: null, durationMs: 2000, motion: 'none', transition: kind, text: { content: 'ABCDEFGHIJ', position: 'center', sizePct: 8, animation: 'typewriter' } },
    { id: 'b', sceneId: 'b', position: 2, narration: null, visualAssetId: 'blue', voiceAssetId: null, durationMs: 1500, motion: 'none' },
  ]
  const comp = parseComposition(JSON.parse(JSON.stringify(base)))!
  const canvas = document.createElement('canvas')
  const px = (x: number, y = 0.15) => { const d = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data; return [d[0], d[1], d[2]] }
  const s: Record<string, number[]> = {}
  await renderComposition({ composition: comp, canvas, media, record: false, onProgress: t => {
    if (!s.before && t > 400 && t < 800) s.before = px(0.5)
    if (!s.left && t > 1450 && t < 1560) { s.left = px(0.1); s.mid = px(0.5); s.right = px(0.9) }
    if (!s.after && t > 2500 && t < 3000) s.after = px(0.5)
  } })
  return s
}

/** Pans right across an image whose left half is red and right half blue; a yellow title sits on the text track for the first second. */
;(window as any).runCamera = async () => {
  const oc = new OffscreenCanvas(1600, 900); const x = oc.getContext('2d')!
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, 800, 900); x.fillStyle = '#0000ff'; x.fillRect(800, 0, 800, 900)
  const media = new Map<string, any>([['split', { kind: 'image', blob: await oc.convertToBlob({ type: 'image/png' }) }]])
  const base = emptyComposition('sb', 'Cámara')
  base.fadeMs = 0; base.subtitles = false
  base.clips = [{ id: 'a', sceneId: 'a', position: 1, narration: null, visualAssetId: 'split', voiceAssetId: null, durationMs: 2500, motion: 'none', camera: { kind: 'pan_right', amount: 0.5 } }]
  base.textClips = [{ id: 't', content: 'TÍTULO', startMs: 0, durationMs: 1000, position: 'top', sizePct: 12, color: '#ffff00', font: 'condensed', animation: 'none' }]
  const comp = parseComposition(JSON.parse(JSON.stringify(base)))!
  const canvas = document.createElement('canvas')
  const ctx = () => canvas.getContext('2d')!
  const px = (fx: number, fy: number) => { const d = ctx().getImageData(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy), 1, 1).data; return [d[0], d[1], d[2]] }
  const yellow = () => { const d = ctx().getImageData(0, 0, canvas.width, Math.floor(canvas.height * 0.3)).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] > 200 && d[k + 1] > 200 && d[k + 2] < 80) n++; return n }
  const s: Record<string, unknown> = {}
  await renderComposition({ composition: comp, canvas, media, record: false, onProgress: t => {
    if (s.start === undefined && t > 150 && t < 500) { s.start = px(0.62, 0.6); s.title = yellow() }
    if (s.end === undefined && t > 2150 && t < 2450) { s.end = px(0.38, 0.6); s.titleGone = yellow() }
  } })
  return s
}

function tone(seconds: number, freq: number, rate = 22050) {
  const n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / rate) * 0.4 * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}

/** Voice (220 Hz) and music (440 Hz) for 4 s; the music has an automation point that takes it to 0 from 2 s. Returns each tone's energy per half. */
;(window as any).runMix = async (mix: unknown) => {
  const media = new Map<string, any>([['vo', { kind: 'audio', blob: tone(4.5, 220) }], ['mu', { kind: 'audio', blob: tone(4.5, 440) }], ['black', { kind: 'image', blob: await (() => { const oc = new OffscreenCanvas(64, 36); oc.getContext('2d')!.fillRect(0, 0, 64, 36); return oc.convertToBlob({ type: 'image/png' }) })() }]])
  const base = emptyComposition('sb', 'Mezcla')
  base.fadeMs = 0; base.subtitles = false; base.duckMusic = false
  base.clips = [{ id: 'a', sceneId: 'a', position: 1, narration: null, visualAssetId: 'black', voiceAssetId: null, durationMs: 4000, motion: 'none' }]
  base.audioClips = [
    { id: 'v', assetId: 'vo', kind: 'voice', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 4000, volume: 1, muted: false },
    { id: 'm', assetId: 'mu', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 4000, volume: 1, muted: false, envelope: [{ atMs: 1800, gain: 1 }, { atMs: 2000, gain: 0 }] },
  ]
  base.mix = mix as never
  const comp = parseComposition(JSON.parse(JSON.stringify(base)))!
  const res = await renderComposition({ composition: comp, canvas: document.createElement('canvas'), media, record: true })
  const ab = await new AudioContext().decodeAudioData(await res.blob!.arrayBuffer()), ch = ab.getChannelData(0), rate = ab.sampleRate
  const g = (a: number, b: number, f: number) => { const k = 2 * Math.cos(2 * Math.PI * f / rate); let s1 = 0, s2 = 0; for (let i = Math.floor(a * rate); i < Math.floor(b * rate); i++) { const s0 = ch[i] + k * s1 - s2; s2 = s1; s1 = s0 } return Math.round(Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / ((b - a) * rate) * 1000) / 1000 }
  return { voice: [g(0.4, 1.6, 220), g(2.4, 3.6, 220)], music: [g(0.4, 1.6, 440), g(2.4, 3.6, 440)] }
}
