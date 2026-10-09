import type { Manifest } from './types'

/**
 * Render 100 % en el navegador (sin servidor de render): canvas 1080×1920 + Web Audio → MediaRecorder.
 * Se graba en tiempo real, así que dura lo mismo que el Short y la pestaña debe seguir visible.
 */

export type RenderedVideo = { blob: Blob; mime: string; ext: 'mp4' | 'webm'; seconds: number }

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) ?? null
}

// ---------- Música libre procedural (sin material de terceros) ----------

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)
const PROGRESSIONS = [
  [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am F C G
  [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], // Dm Bb F C
]

export async function buildMusic(seed: number, seconds: number): Promise<AudioBuffer> {
  const sr = 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr)
  const rand = rng(seed)
  const prog = PROGRESSIONS[seed % PROGRESSIONS.length]
  const master = ctx.createGain()
  master.gain.value = 0.5
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = 1400
  master.connect(lp).connect(ctx.destination)
  const bar = 4
  for (let t = 0, i = 0; t < seconds; t += bar, i++) {
    const chord = prog[i % prog.length]
    const notes = [...chord.map(n => hz(n)), hz(chord[0] - 12)]
    notes.forEach((f, k) => {
      const o = ctx.createOscillator()
      o.type = k === 3 ? 'sine' : 'triangle'
      o.frequency.value = f
      o.detune.value = (rand() - 0.5) * 12
      const g = ctx.createGain()
      const peak = k === 3 ? 0.35 : 0.2
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(peak, t + 1.2)
      g.gain.setValueAtTime(peak, t + bar - 1.2)
      g.gain.linearRampToValueAtTime(0, t + bar + 0.6)
      o.connect(g).connect(master)
      o.start(t); o.stop(t + bar + 0.7)
    })
  }
  return ctx.startRendering()
}

// ---------- Dibujo de un fotograma ----------

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w } else line = test
  }
  if (line) lines.push(line)
  return lines
}

function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string) {
  ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(0,0,0,0.92)'; ctx.lineJoin = 'round'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
}

export function drawFrame(ctx: CanvasRenderingContext2D, m: Manifest, images: CanvasImageSource[], t: number) {
  const { width: W, height: H } = m
  const scene = m.scenes.find(s => t >= s.start && t < s.end) ?? m.scenes[m.scenes.length - 1]
  const img = images[scene.index] as (CanvasImageSource & { width?: number; height?: number }) | undefined
  ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W, H)
  if (img) {
    const iw = (img as HTMLImageElement).naturalWidth || (img.width as number)
    const ih = (img as HTMLImageElement).naturalHeight || (img.height as number)
    const p = Math.min(1, Math.max(0, (t - scene.start) / Math.max(scene.end - scene.start, 0.1)))
    const zoom = 1.04 + 0.1 * (scene.index % 2 ? 1 - p : p) // Ken Burns suave
    const scale = Math.max(W / iw, H / ih) * zoom
    ctx.drawImage(img, (W - iw * scale) / 2, (H - ih * scale) / 2, iw * scale, ih * scale)
  }
  const grad = ctx.createLinearGradient(0, H * 0.45, 0, H)
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.65)')
  ctx.fillStyle = grad; ctx.fillRect(0, H * 0.45, W, H * 0.55)

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'

  // Hook + dato principal visibles desde el primer fotograma. El dato va resaltado aunque el ajuste de línea lo parta.
  if (t < m.hook.overlay_until) {
    ctx.font = '900 118px system-ui, "Segoe UI", Arial, sans-serif'
    const words = m.hook.text.toUpperCase().split(' ').filter(Boolean)
    const datum = m.hook.key_datum.toUpperCase().split(' ').filter(Boolean)
    const hl = new Set<number>()
    for (let i = 0; i + datum.length <= words.length && datum.length; i++) {
      if (datum.every((d, k) => words[i + k].replace(/[¿?¡!.,]/g, '') === d.replace(/[¿?¡!.,]/g, ''))) datum.forEach((_, k) => hl.add(i + k))
    }
    const lines: { w: string; hl: boolean }[][] = []
    let cur: { w: string; hl: boolean }[] = []
    words.forEach((w, i) => {
      const test = [...cur, { w, hl: hl.has(i) }].map(x => x.w).join(' ')
      if (ctx.measureText(test).width > W - 140 && cur.length) { lines.push(cur); cur = [] }
      cur.push({ w, hl: hl.has(i) })
    })
    if (cur.length) lines.push(cur)
    const lineH = 136
    const top = H * 0.2 - ((lines.length - 1) * lineH) / 2
    const space = ctx.measureText(' ').width
    ctx.textAlign = 'left'
    lines.forEach((line, li) => {
      const widths = line.map(x => ctx.measureText(x.w).width)
      let x = (W - (widths.reduce((a, b) => a + b, 0) + space * (line.length - 1))) / 2
      line.forEach((word, wi) => { outlinedText(ctx, word.w, x, top + li * lineH, word.hl ? '#ffd84a' : '#ffffff'); x += widths[wi] + space })
    })
    ctx.textAlign = 'center'
  }

  // Subtítulos (trozos de ≤4 palabras).
  const cap = scene.captions.find(c => t >= c.start && t < c.end)
  if (cap) {
    ctx.font = '800 92px system-ui, "Segoe UI", Arial, sans-serif'
    const lines = wrapLines(ctx, cap.text, W - 160)
    lines.forEach((line, i) => outlinedText(ctx, line, W / 2, H * 0.72 + i * 108, '#ffffff'))
  }

  ctx.font = '600 34px system-ui, Arial, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillText('Umbral del Hito · contenido generado con IA', W / 2, H - 70)
}

// ---------- Render ----------

export async function renderShort(
  m: Manifest,
  images: CanvasImageSource[],
  voice: ArrayBuffer,
  onProgress: (fraction: number) => void,
): Promise<RenderedVideo> {
  const mime = pickMime()
  if (!mime) throw new Error('Este navegador no puede grabar vídeo (MediaRecorder). Usa Chrome, Edge o Safari actualizados.')

  const canvas = document.createElement('canvas')
  canvas.width = m.width; canvas.height = m.height
  const ctx = canvas.getContext('2d')!
  const audio = new AudioContext()
  await audio.resume()
  const voiceBuffer = await audio.decodeAudioData(voice.slice(0))
  const music = await buildMusic(m.music.seed, m.duration)

  const dest = audio.createMediaStreamDestination()
  const voiceSrc = audio.createBufferSource(); voiceSrc.buffer = voiceBuffer
  const musicSrc = audio.createBufferSource(); musicSrc.buffer = music
  const voiceGain = audio.createGain(); voiceGain.gain.value = 1
  const musicGain = audio.createGain(); musicGain.gain.value = 0.13 // la música nunca tapa la voz
  voiceSrc.connect(voiceGain).connect(dest)
  musicSrc.connect(musicGain).connect(dest)

  const stream = canvas.captureStream(m.fps)
  dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr))
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>(res => { recorder.onstop = () => res() })

  drawFrame(ctx, m, images, 0)
  recorder.start(500)
  const t0 = performance.now() + 120
  voiceSrc.start(audio.currentTime + 0.12); musicSrc.start(audio.currentTime + 0.12)

  await new Promise<void>(resolve => {
    const tick = () => {
      const t = Math.max(0, (performance.now() - t0) / 1000)
      drawFrame(ctx, m, images, Math.min(t, m.duration - 0.001))
      onProgress(Math.min(1, t / m.duration))
      if (t >= m.duration) resolve(); else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  recorder.stop()
  await stopped
  stream.getTracks().forEach(tr => tr.stop())
  await audio.close()
  const type = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm'
  return { blob: new Blob(chunks, { type }), mime: type, ext: type === 'video/mp4' ? 'mp4' : 'webm', seconds: m.duration }
}
