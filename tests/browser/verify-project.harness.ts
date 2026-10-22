/**
 * Phase 12 verification project: two videos at once (main + overlay), three photos, two music tracks, a voice, an effect, a title,
 * subtitles, transitions and volume automation. It is previewed with the editor's player and exported with both exporters, and the
 * exported pictures and sound are compared with the preview at the same instants.
 */
import { EditorPlayer, blobResolver } from '@/lib/editor/player'
import { renderComposition } from '@/lib/editor/renderer'
import { fastExport } from '@/lib/editor/fast-export'
import { emptyComposition, type Composition } from '@/lib/editor/composition'
import { addAudioClip, addClip, addTextClip, updateClip } from '@/lib/editor/timeline'
import { addOverlay, addTrack } from '@/lib/editor/tracks'
import type { KindOf } from '@/lib/editor/scene'

declare global { interface Window { runVerify: (which: 'fast' | 'realtime') => Promise<unknown>; runPlayback: () => Promise<unknown> } }

function wav(seconds: number, freq: number, rate = 48000) {
  const n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / rate) * 0.4 * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}
async function image(color: string) {
  const oc = new OffscreenCanvas(960, 540); const x = oc.getContext('2d')!; x.fillStyle = color; x.fillRect(0, 0, 960, 540)
  return oc.convertToBlob({ type: 'image/png' })
}
/** A 4-second VP8+Opus video of one colour with a tone (recorded live). */
async function video(color: string, freq: number) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360
  const g = c.getContext('2d')!
  const ac = new AudioContext(); const osc = ac.createOscillator(); osc.frequency.value = freq; const gain = ac.createGain(); gain.gain.value = 0.4
  const dest = ac.createMediaStreamDestination(); osc.connect(gain); gain.connect(dest); osc.start()
  const stream = c.captureStream(30); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))
  const r = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' }); const parts: Blob[] = []
  r.ondataavailable = e => parts.push(e.data); r.start()
  const t0 = performance.now()
  await new Promise<void>(res => { const f = () => { g.fillStyle = color; g.fillRect(0, 0, 640, 360); if (performance.now() - t0 < 4300) requestAnimationFrame(f); else res() }; f() })
  r.stop(); await new Promise(res => (r.onstop = res)); osc.stop(); await ac.close()
  return new Blob(parts, { type: 'video/webm' })
}

let media: Map<string, { kind: 'image' | 'video' | 'audio'; blob: Blob }> | null = null
async function prepare() {
  if (media) return media
  const [red, blue, yellow, green, magenta] = await Promise.all([image('#d02020'), image('#2040e0'), image('#e0d020'), video('#00c800', 440), video('#c800c8', 660)])
  media = new Map<string, { kind: 'image' | 'video' | 'audio'; blob: Blob }>([
    ['red', { kind: 'image', blob: red }], ['blue', { kind: 'image', blob: blue }], ['yellow', { kind: 'image', blob: yellow }],
    ['green', { kind: 'video', blob: green }], ['magenta', { kind: 'video', blob: magenta }],
    ['m1', { kind: 'audio', blob: wav(16, 110) }], ['m2', { kind: 'audio', blob: wav(16, 165) }], ['vo', { kind: 'audio', blob: wav(3, 330) }], ['fx', { kind: 'audio', blob: wav(0.5, 880) }],
  ])
  return media
}
const kindOf: KindOf = id => media?.get(id)?.kind ?? null

/** 13 s: red (dissolve) → green video (wipe) → blue (slide) → yellow; magenta video overlay 4.5–8.5 s top right; title; subtitles; music × 2, voice, effect. */
function project(): Composition {
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
  return c
}

// Instants and points compared (away from transitions): [t, x, y] as fractions of the frame.
const SAMPLES: Array<[number, number, number]> = [[1200, 0.5, 0.6], [4000, 0.3, 0.6], [5500, 0.3, 0.6], [5500, 0.75, 0.3], [8000, 0.75, 0.3], [11000, 0.5, 0.5], [12000, 0.4, 0.6], [2800, 0.5, 0.6], [6800, 0.2, 0.6], [6800, 0.9, 0.6], [9800, 0.85, 0.6]]
const W = 1280, H = 720

async function previewSamples() {
  const m = await prepare()
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const urls = blobResolver(m)
  const p = new EditorPlayer({ canvas, resolveUrl: urls.resolve, kindOf, output: 'stream' })
  p.setComposition(project())
  const g = canvas.getContext('2d')!
  const out: number[][] = []
  for (const [t, x, y] of SAMPLES) {
    p.seek(t); await p.preload(t)
    await new Promise(r => setTimeout(r, 120)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const d = g.getImageData(Math.floor(W * x), Math.floor(H * y), 1, 1).data
    out.push([d[0], d[1], d[2]])
  }
  p.destroy(); urls.revoke()
  return out
}

async function framesOf(blob: Blob) {
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob)
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('cannot decode the export')) })
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!
  const out: number[][] = []
  for (const [t, x, y] of SAMPLES) {
    v.currentTime = t / 1000
    await new Promise(r => (v.onseeked = r))
    g.drawImage(v, 0, 0, W, H)
    const d = g.getImageData(Math.floor(W * x), Math.floor(H * y), 1, 1).data
    out.push([d[0], d[1], d[2]])
  }
  const duration = Number.isFinite(v.duration) ? v.duration : null
  URL.revokeObjectURL(v.src)
  return { out, duration, size: [v.videoWidth, v.videoHeight] }
}

/** Energy of a tone (Goertzel) in [fromMs, toMs) of a mono mix. */
function tone(samples: Float32Array, rate: number, freq: number, fromMs: number, toMs: number) {
  const a = Math.floor(fromMs / 1000 * rate), b = Math.min(samples.length, Math.floor(toMs / 1000 * rate))
  const k = 2 * Math.cos(2 * Math.PI * freq / rate)
  let s1 = 0, s2 = 0
  for (let i = a; i < b; i++) { const s0 = samples[i] + k * s1 - s2; s2 = s1; s1 = s0 }
  const n = Math.max(1, b - a)
  return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / n
}
async function audioOf(blob: Blob) {
  const ac = new AudioContext()
  const buf = await ac.decodeAudioData(await blob.arrayBuffer())
  await ac.close()
  const ch = buf.getChannelData(0)
  const t = (f: number, a: number, b: number) => Math.round(tone(ch, buf.sampleRate, f, a, b) * 1e4) / 1e4
  return {
    music1_before_voice: t(110, 300, 1300), music1_under_voice: t(110, 1900, 2900), voice: t(330, 1900, 2900), voice_after: t(330, 3500, 4500),
    music1_after_automation: t(110, 6500, 7500), music2: t(165, 6500, 7500), music2_before: t(165, 4000, 5500),
    sfx: t(880, 9050, 9450), sfx_before: t(880, 8000, 8800), video_main: t(440, 3600, 4400), video_main_after: t(440, 7600, 8400), video_overlay: t(660, 5000, 8000), video_overlay_before: t(660, 3500, 4300),
  }
}

window.runVerify = async (which) => {
  const m = await prepare()
  const preview = await previewSamples()
  const urls = blobResolver(m)
  const canvas = document.createElement('canvas')
  const t0 = performance.now()
  let res: { blob: Blob | null; mimeType: string | null; durationMs: number }
  try {
    res = which === 'fast'
      ? await fastExport({ composition: project(), resolveUrl: urls.resolve, kindOf, canvas })
      : await renderComposition({ composition: project(), canvas, media: m, record: true })
  } finally { urls.revoke() }
  const seconds = (performance.now() - t0) / 1000
  const frames = await framesOf(res.blob!)
  const audio = await audioOf(res.blob!)
  return { preview, exported: frames.out, duration: frames.duration, size: frames.size, mime: res.mimeType, seconds, audio }
}

window.runPlayback = async () => {
  const m = await prepare()
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
  const urls = blobResolver(m)
  const p = new EditorPlayer({ canvas, resolveUrl: urls.resolve, kindOf })
  p.setComposition(project())
  p.seek(9500); await p.preload(9500)
  p.play()
  await new Promise(r => setTimeout(r, 1500))
  p.pause()
  const after = p.state.timeMs
  p.skip(-10_000)
  const back = p.state.timeMs
  p.destroy(); urls.revoke()
  return { after, back }
}
