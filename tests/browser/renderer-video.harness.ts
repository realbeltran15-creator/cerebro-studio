import { renderComposition } from '@/lib/editor/renderer'
import { emptyComposition, parseComposition } from '@/lib/editor/composition'
import { toManual } from '@/lib/editor/timeline'

function wav(seconds: number, freq: number, rate = 22050) {
  const n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / rate) * 0.5 * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}
/** Records a video whose background colour encodes the source second, with a sine tone as audio. */
async function video(colors: string[], freq: number, split?: [string, string]) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360
  const x = c.getContext('2d')!, stream = c.captureStream(30)
  const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.frequency.value = freq; o.connect(d); o.start()
  d.stream.getAudioTracks().forEach(t => stream.addTrack(t))
  const r = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' }), parts: Blob[] = []
  r.ondataavailable = e => parts.push(e.data); r.start()
  const t0 = performance.now()
  await new Promise<void>(res => { const f = () => { const t = performance.now() - t0; if (split) { x.fillStyle = split[0]; x.fillRect(0, 0, 320, 360); x.fillStyle = split[1]; x.fillRect(320, 0, 320, 360) } else { x.fillStyle = colors[Math.min(Math.floor(t / 1000), colors.length - 1)]; x.fillRect(0, 0, 640, 360) } if (t < colors.length * 1000 + 150) requestAnimationFrame(f); else res() }; f() })
  r.stop(); await new Promise(res => (r.onstop = res)); await ac.close()
  return new Blob(parts, { type: 'video/webm' })
}
async function img(color: string) { const oc = new OffscreenCanvas(1600, 900); const x = oc.getContext('2d')!; x.fillStyle = color; x.fillRect(0, 0, 1600, 900); return oc.convertToBlob({ type: 'image/png' }) }

;(window as any).runTest = async () => {
  const media = new Map<string, any>([
    ['img', { kind: 'image', blob: await img('#c0392b') }],
    ['vidA', { kind: 'video', blob: await video(['#300000', '#00c800', '#0064c8', '#c8c800'], 440) }],
    ['vidB', { kind: 'video', blob: await video(['#000', '#000', '#000'], 880, ['#ff00ff', '#00ffff']) }],
    ['voice', { kind: 'audio', blob: wav(1.6, 220) }],
  ])
  const base = emptyComposition('sb', 'Mixto')
  base.fadeMs = 250
  base.clips = [
    { id: 'c1', sceneId: 's1', position: 1, narration: null, visualAssetId: 'img', voiceAssetId: 'voice', durationMs: 2000, motion: 'none', text: { content: 'TITULO', position: 'center', sizePct: 8 } },
    { id: 'c2', sceneId: 's2', position: 2, narration: 'subtitulo del clip de video', visualAssetId: 'vidA', voiceAssetId: null, durationMs: 2000, motion: 'none', trimInMs: 1000, volume: 1, transition: 'cut' },
    { id: 'c3', sceneId: 's3', position: 3, narration: null, visualAssetId: 'vidA', voiceAssetId: null, durationMs: 2000, motion: 'none', trimInMs: 3000 },
    { id: 'c4', sceneId: 's4', position: 4, narration: null, visualAssetId: 'vidB', voiceAssetId: null, durationMs: 2000, motion: 'none', muted: true, zoom: 1.5, focusX: 0 },
  ]
  const comp = parseComposition(JSON.parse(JSON.stringify(toManual(base, { voice: 1600 }))))!
  const canvas = document.createElement('canvas')
  const samples: Record<string, any> = {}
  const px = (y = 0.5) => { const d = canvas.getContext('2d')!.getImageData(canvas.width * 0.5, canvas.height * y, 1, 1).data; return [d[0], d[1], d[2]] }
  const white = (y0: number, y1: number) => { const d = canvas.getContext('2d')!.getImageData(0, canvas.height * y0, canvas.width, canvas.height * (y1 - y0)).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] > 235 && d[k + 1] > 235 && d[k + 2] > 235) n++; return n }
  const res = await renderComposition({ composition: comp, canvas, media, record: true, onProgress: t => {
    if (!samples.c1 && t > 900 && t < 1200) { samples.c1 = px(0.2); samples.textCenter = white(0.4, 0.6) }
    if (!samples.c2 && t > 2500 && t < 2800) { samples.c2 = px(0.3); samples.caption = white(0.8, 0.95) }
    if (!samples.c3 && t > 4500 && t < 4800) samples.c3 = px(0.3)
    if (!samples.c4 && t > 6900 && t < 7100) samples.c4 = px(0.5)
    if (samples.cutEdge === undefined && t > 3960 && t < 4040) samples.cutEdge = px(0.3)
    if (samples.fadeEdge === undefined && t > 1970 && t < 2030) samples.fadeEdge = px(0.3)
  } })
  const blob = res.blob!
  const ab = await new AudioContext().decodeAudioData(await blob.arrayBuffer()), ch = ab.getChannelData(0), rate = ab.sampleRate
  const g = (a: number, b: number, f: number) => { const k = 2 * Math.cos(2 * Math.PI * f / rate); let s1 = 0, s2 = 0; for (let i = Math.floor(a * rate); i < Math.floor(b * rate); i++) { const s0 = ch[i] + k * s1 - s2; s2 = s1; s1 = s0 } return Math.round(Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / ((b - a) * rate) * 1000) / 1000 }
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob)
  await new Promise(r => (v.onloadedmetadata = r)); if (!Number.isFinite(v.duration)) { v.currentTime = 1e9; await new Promise(r => (v.ondurationchange = r)) }
  return { samples, duration: Math.round(v.duration * 100) / 100, size: [v.videoWidth, v.videoHeight], audio: {
    voice220_clip1: g(0.3, 1.5, 220), voice220_clip3: g(4.3, 5.7, 220),
    video440_clip2: g(2.3, 3.7, 440), video440_clip1: g(0.3, 1.5, 440),
    video880_clip4_muted: g(6.3, 7.7, 880) } }
}
