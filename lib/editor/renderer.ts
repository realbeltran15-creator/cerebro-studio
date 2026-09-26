import { captionChunks, clipStarts, formatSize, totalDurationMs, videoBitrateFor, type Composition } from './composition'

/**
 * Browser renderer: draws the composition on a canvas, mixes audio with WebAudio and,
 * when recording, captures both with MediaRecorder into a WebM file.
 * Runs in real time and uses the audio clock as the timeline clock, so the tab must stay visible.
 */

export type MediaSource = { kind: 'image' | 'video' | 'audio'; blob: Blob }

export type RenderOptions = {
  composition: Composition
  canvas: HTMLCanvasElement
  /** Returns the media for an asset id (already downloaded). */
  media: Map<string, MediaSource>
  record: boolean
  onProgress?: (elapsedMs: number, totalMs: number) => void
  signal?: AbortSignal
}

export type RenderResult = { blob: Blob | null; mimeType: string | null; durationMs: number }

type LoadedVisual = { kind: 'image'; bitmap: ImageBitmap } | { kind: 'video'; el: HTMLVideoElement; url: string }

export function recordingSupported() {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

export function pickMimeType() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? null
}

async function loadVisual(source: MediaSource): Promise<LoadedVisual> {
  if (source.kind === 'image') return { kind: 'image', bitmap: await createImageBitmap(source.blob) }
  const url = URL.createObjectURL(source.blob)
  const el = document.createElement('video')
  el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = url
  await new Promise<void>((resolve, reject) => {
    el.oncanplay = () => resolve()
    el.onerror = () => reject(new Error('No se pudo decodificar un vídeo del montaje.'))
  })
  return { kind: 'video', el, url }
}

/** Draws source covering the frame, with an optional slow zoom (Ken Burns) driven by progress 0..1. */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, w: number, h: number, zoom: number, focusX = 0.5) {
  const scale = Math.max(w / sw, h / sh) * zoom
  const dw = sw * scale, dh = sh * scale
  // focusX picks which part of a wider source stays in frame (0 = left edge, 1 = right edge).
  ctx.drawImage(src, (w - dw) * focusX, (h - dh) / 2, dw, dh)
}

function drawHook(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, alpha: number) {
  const size = Math.round(w * 0.075)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  const lines = wrap(ctx, text.toUpperCase(), w * 0.86)
  const lineH = size * 1.15
  const top = Math.round(h * 0.12)
  ctx.lineWidth = Math.max(4, size * 0.12); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#fff'
  lines.forEach((l, i) => { ctx.strokeText(l, w / 2, top + i * lineH); ctx.fillText(l, w / 2, top + i * lineH) })
  ctx.restore()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number) {
  const size = Math.round(Math.min(w, h) * 0.045)
  ctx.font = `600 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
  const lines = wrap(ctx, text, w * 0.84)
  const lineH = size * 1.25
  const boxH = lines.length * lineH + size * 0.6
  const bottom = h - Math.round(h * (w < h ? 0.18 : 0.07))
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  const boxW = Math.min(w * 0.9, Math.max(...lines.map(l => ctx.measureText(l).width)) + size * 1.2)
  ctx.fillRect((w - boxW) / 2, bottom - boxH, boxW, boxH)
  ctx.fillStyle = '#fff'
  lines.forEach((l, i) => ctx.fillText(l, w / 2, bottom - boxH + size * 0.3 + (i + 1) * lineH))
}

export async function renderComposition(opts: RenderOptions): Promise<RenderResult> {
  const { composition, canvas, media, record, onProgress, signal } = opts
  const { width, height } = formatSize[composition.format]
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite dibujar en canvas.')

  const total = totalDurationMs(composition)
  const starts = clipStarts(composition)

  // Decode everything up front so playback never waits on the network.
  const visuals = new Map<string, LoadedVisual>()
  const audio = new AudioContext()
  const buffers = new Map<string, AudioBuffer>()
  try {
    for (const clip of composition.clips) {
      if (clip.visualAssetId && !visuals.has(clip.visualAssetId)) {
        const src = media.get(clip.visualAssetId)
        if (src && src.kind !== 'audio') visuals.set(clip.visualAssetId, await loadVisual(src))
      }
      for (const id of [clip.voiceAssetId]) {
        if (id && !buffers.has(id)) {
          const src = media.get(id)
          if (src) buffers.set(id, await audio.decodeAudioData(await src.blob.arrayBuffer()))
        }
      }
    }
    if (composition.musicAssetId && !buffers.has(composition.musicAssetId)) {
      const src = media.get(composition.musicAssetId)
      if (src) buffers.set(composition.musicAssetId, await audio.decodeAudioData(await src.blob.arrayBuffer()))
    }
  } catch (error) {
    await audio.close()
    visuals.forEach(v => { if (v.kind === 'video') URL.revokeObjectURL(v.url) })
    throw error instanceof Error ? error : new Error('No se pudieron preparar los recursos.')
  }
  if (signal?.aborted) { await audio.close(); return { blob: null, mimeType: null, durationMs: 0 } }

  // Audio graph: voices at their clip offsets; music looped underneath, ducked while a voice plays.
  const out = record ? audio.createMediaStreamDestination() : null
  const master = audio.createGain()
  master.connect(out ?? audio.destination)
  // Small lead so every source can be scheduled before playback starts; it shows as a brief black frame.
  const t0 = audio.currentTime + 0.1
  const sources: AudioScheduledSourceNode[] = []
  composition.clips.forEach((clip, i) => {
    const buf = clip.voiceAssetId ? buffers.get(clip.voiceAssetId) : undefined
    if (!buf) return
    const node = audio.createBufferSource()
    node.buffer = buf
    node.connect(master)
    node.start(t0 + starts[i] / 1000, 0, Math.min(buf.duration, clip.durationMs / 1000))
    sources.push(node)
  })
  const musicBuf = composition.musicAssetId ? buffers.get(composition.musicAssetId) : undefined
  if (musicBuf) {
    const node = audio.createBufferSource()
    node.buffer = musicBuf; node.loop = true
    const gain = audio.createGain()
    const base = composition.musicVolume
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(base, t0 + 1)
    if (composition.duckMusic) composition.clips.forEach((clip, i) => {
      if (!clip.voiceAssetId || !buffers.get(clip.voiceAssetId)) return
      const s = t0 + starts[i] / 1000
      const e = s + Math.min(buffers.get(clip.voiceAssetId)!.duration, clip.durationMs / 1000)
      gain.gain.setTargetAtTime(base * 0.35, Math.max(s - 0.15, t0), 0.08)
      gain.gain.setTargetAtTime(base, e, 0.25)
    })
    const end = t0 + total / 1000
    gain.gain.setTargetAtTime(0, Math.max(end - 1.2, t0), 0.3)
    node.connect(gain); gain.connect(master)
    node.start(t0); node.stop(end + 0.1)
    sources.push(node)
  }

  let recorder: MediaRecorder | null = null
  let videoTrack: CanvasCaptureMediaStreamTrack | null = null
  const chunks: Blob[] = []
  const mimeType = record ? pickMimeType() : null
  if (record) {
    if (!mimeType || !out) throw new Error('Este navegador no puede grabar vídeo WebM. Usa Chrome, Edge o Firefox de escritorio.')
    // Frames are pushed explicitly after each draw: with automatic capture, static images can leave
    // the encoder holding an earlier frame (e.g. mid-fade) for a long stretch.
    const stream = canvas.captureStream(0)
    videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    out.stream.getAudioTracks().forEach(t => stream.addTrack(t))
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoBitrateFor(total), audioBitsPerSecond: 128_000 })
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    recorder.start(1000)
  }

  const captions = composition.clips.map(c => (composition.subtitles ? captionChunks(c.narration, c.durationMs) : []))
  let activeVideo: HTMLVideoElement | null = null

  await new Promise<void>(resolve => {
    const frame = () => {
      const now = (audio.currentTime - t0) * 1000
      if (signal?.aborted || now >= total) { resolve(); return }
      onProgress?.(Math.max(now, 0), total)
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height)
      if (now >= 0) {
        let i = starts.findIndex((s, k) => now >= s && now < s + composition.clips[k].durationMs)
        if (i < 0) i = composition.clips.length - 1
        const clip = composition.clips[i]
        const local = now - starts[i]
        const progress = local / clip.durationMs
        const visual = clip.visualAssetId ? visuals.get(clip.visualAssetId) : undefined
        if (visual?.kind === 'video') {
          if (activeVideo !== visual.el) {
            activeVideo?.pause()
            activeVideo = visual.el; visual.el.currentTime = 0; visual.el.loop = true; void visual.el.play()
          }
          drawCover(ctx, visual.el, visual.el.videoWidth || width, visual.el.videoHeight || height, width, height, 1, clip.focusX)
        } else {
          if (activeVideo) { activeVideo.pause(); activeVideo = null }
          if (visual?.kind === 'image') drawCover(ctx, visual.bitmap, visual.bitmap.width, visual.bitmap.height, width, height, clip.motion === 'kenburns' ? 1 + 0.08 * progress : 1, clip.focusX)
        }
        const cap = captions[i].find(c => local >= c.startMs && local < c.endMs)
        if (cap) drawCaption(ctx, cap.text, width, height)
        if (composition.hookText && now < (composition.hookMs ?? 3000)) {
          const hookMs = composition.hookMs ?? 3000
          drawHook(ctx, composition.hookText, width, height, Math.min(1, (hookMs - now) / 400))
        }
        // Fade through black at clip boundaries.
        const fade = composition.fadeMs
        if (fade > 0) {
          const edge = Math.min(local, clip.durationMs - local)
          if (edge < fade) { ctx.fillStyle = `rgba(0,0,0,${1 - edge / fade})`; ctx.fillRect(0, 0, width, height) }
        }
      }
      videoTrack?.requestFrame()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  ;(activeVideo as HTMLVideoElement | null)?.pause()
  sources.forEach(s => { try { s.stop() } catch { /* already stopped */ } })
  let blob: Blob | null = null
  if (recorder) {
    const stopped = new Promise<void>(r => { recorder!.onstop = () => r() })
    recorder.stop()
    await stopped
    blob = signal?.aborted ? null : new Blob(chunks, { type: mimeType ?? 'video/webm' })
  }
  onProgress?.(total, total)
  await audio.close()
  visuals.forEach(v => { if (v.kind === 'video') URL.revokeObjectURL(v.url); else v.bitmap.close() })
  return { blob, mimeType, durationMs: total }
}
