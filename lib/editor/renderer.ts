import { applyGainPlan, musicGainPlan } from './audio-plan'
import { audioStartMs, captionChunks, clipStarts, formatSize, totalDurationMs, videoBitrateFor, type Composition, type TextOverlay } from './composition'

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
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, w: number, h: number, zoom: number, focusX = 0.5, focusY = 0.5) {
  const scale = Math.max(w / sw, h / sh) * zoom
  const dw = sw * scale, dh = sh * scale
  // focusX/focusY pick which part of a larger (or zoomed) source stays in frame (0 = left/top edge, 1 = right/bottom).
  ctx.drawImage(src, (w - dw) * focusX, (h - dh) * focusY, dw, dh)
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

function drawText(ctx: CanvasRenderingContext2D, t: TextOverlay, w: number, h: number) {
  const size = Math.round(Math.min(w, h) * (t.sizePct / 100) * 1.6)
  ctx.save()
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const lines = wrap(ctx, t.content, w * 0.86)
  const lineH = size * 1.15
  const blockH = lines.length * lineH
  const top = t.position === 'top' ? h * 0.1 : t.position === 'center' ? (h - blockH) / 2 : h * 0.72 - blockH
  ctx.lineWidth = Math.max(3, size * 0.1); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#fff'
  lines.forEach((l, i) => { const y = top + i * lineH + lineH / 2; ctx.strokeText(l, w / 2, y); ctx.fillText(l, w / 2, y) })
  ctx.restore()
}

type ClipVideo = { el: HTMLVideoElement; url: string; gain: GainNode }

export async function renderComposition(opts: RenderOptions): Promise<RenderResult> {
  const { composition, canvas, media, record, onProgress, signal } = opts
  const { width, height } = formatSize[composition.format]
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite dibujar en canvas.')

  const total = totalDurationMs(composition)
  const starts = clipStarts(composition)
  const audioClips = (composition.audioClips ?? []).filter(a => !a.muted)

  // Decode everything up front so playback never waits on the network.
  // Images are shared by asset; every video clip gets its own element so trims, splits and
  // duplicates of the same source play independently, each with its own audio gain.
  const images = new Map<string, ImageBitmap>()
  const videos = new Map<string, ClipVideo>()
  const audio = new AudioContext()
  const out = record ? audio.createMediaStreamDestination() : null
  const master = audio.createGain()
  master.connect(out ?? audio.destination)
  const buffers = new Map<string, AudioBuffer>()
  const decode = async (id: string | null) => {
    if (!id || buffers.has(id)) return
    const src = media.get(id)
    if (src) buffers.set(id, await audio.decodeAudioData(await src.blob.arrayBuffer()))
  }
  const cleanup = () => { videos.forEach(v => { v.el.pause(); URL.revokeObjectURL(v.url) }); images.forEach(b => b.close()) }
  try {
    for (const clip of composition.clips) {
      const src = clip.visualAssetId ? media.get(clip.visualAssetId) : undefined
      if (src?.kind === 'image' && !images.has(clip.visualAssetId!)) {
        const loaded = await loadVisual(src)
        if (loaded.kind === 'image') images.set(clip.visualAssetId!, loaded.bitmap)
      } else if (src?.kind === 'video') {
        const loaded = await loadVisual(src)
        if (loaded.kind === 'video') {
          loaded.el.muted = false
          const gain = audio.createGain()
          gain.gain.value = clip.muted ? 0 : clip.volume ?? 1
          audio.createMediaElementSource(loaded.el).connect(gain)
          gain.connect(master)
          videos.set(clip.id, { el: loaded.el, url: loaded.url, gain })
        }
      }
      await decode(clip.voiceAssetId)
    }
    await decode(composition.musicAssetId)
    for (const a of audioClips) await decode(a.assetId)
  } catch (error) {
    cleanup(); await audio.close()
    throw error instanceof Error ? error : new Error('No se pudieron preparar los recursos.')
  }
  if (signal?.aborted) { cleanup(); await audio.close(); return { blob: null, mimeType: null, durationMs: 0 } }

  // Audio graph: voices at their offsets; music looped underneath, ducked while a voice plays.
  // Small lead so every source can be scheduled before playback starts; it shows as a brief black frame.
  const t0 = audio.currentTime + 0.1
  const sources: AudioScheduledSourceNode[] = []
  const voiceWindows: Array<{ start: number; end: number }> = []
  composition.clips.forEach((clip, i) => {
    const buf = clip.voiceAssetId ? buffers.get(clip.voiceAssetId) : undefined
    if (!buf) return
    const node = audio.createBufferSource()
    node.buffer = buf
    node.connect(master)
    const start = t0 + starts[i] / 1000, dur = Math.min(buf.duration, clip.durationMs / 1000)
    node.start(start, 0, dur)
    voiceWindows.push({ start, end: start + dur })
    sources.push(node)
  })
  for (const a of audioClips) {
    const buf = buffers.get(a.assetId)
    if (!buf) continue
    const startMs = audioStartMs(composition, a)
    if (startMs >= total) continue
    const offset = Math.min(a.trimInMs / 1000, buf.duration)
    const dur = Math.min(a.durationMs / 1000, buf.duration - offset, (total - startMs) / 1000)
    if (dur <= 0) continue
    const node = audio.createBufferSource()
    node.buffer = buf
    const gain = audio.createGain()
    gain.gain.value = a.volume
    node.connect(gain); gain.connect(master)
    const start = t0 + startMs / 1000
    node.start(start, offset, dur)
    if (a.kind === 'voice') voiceWindows.push({ start, end: start + dur })
    sources.push(node)
  }
  const musicBuf = composition.musicAssetId ? buffers.get(composition.musicAssetId) : undefined
  if (musicBuf) {
    const node = audio.createBufferSource()
    node.buffer = musicBuf; node.loop = true
    const gain = audio.createGain()
    const end = t0 + total / 1000
    applyGainPlan(gain.gain, musicGainPlan({ base: composition.musicVolume, t0, end, duck: composition.duckMusic, voices: voiceWindows }))
    node.connect(gain); gain.connect(master)
    node.start(t0); node.stop(end + 0.1)
    sources.push(node)
  }

  let recorder: MediaRecorder | null = null
  let videoTrack: CanvasCaptureMediaStreamTrack | null = null
  const chunks: Blob[] = []
  const mimeType = record ? pickMimeType() : null
  if (record) {
    if (!mimeType || !out) { cleanup(); await audio.close(); throw new Error('Este navegador no puede grabar vídeo WebM. Usa Chrome, Edge o Firefox de escritorio.') }
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
  let activeClipId: string | null = null
  const last = composition.clips.length - 1

  await new Promise<void>(resolve => {
    const frame = () => {
      const now = (audio.currentTime - t0) * 1000
      if (signal?.aborted || now >= total) { resolve(); return }
      onProgress?.(Math.max(now, 0), total)
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height)
      if (now >= 0) {
        let i = starts.findIndex((s, k) => now >= s && now < s + composition.clips[k].durationMs)
        if (i < 0) i = last
        const clip = composition.clips[i]
        const local = now - starts[i]
        const progress = local / clip.durationMs
        const zoom = clip.zoom ?? 1
        const video = videos.get(clip.id)
        if (activeClipId !== clip.id) {
          if (activeClipId) videos.get(activeClipId)?.el.pause()
          activeClipId = clip.id
          if (video) { video.el.currentTime = (clip.trimInMs ?? 0) / 1000; void video.el.play() }
        }
        if (video) {
          // A clip longer than the rest of its source loops back to the trim point.
          const trimIn = (clip.trimInMs ?? 0) / 1000
          if (video.el.ended || (video.el.duration && video.el.currentTime >= video.el.duration - 0.04)) { video.el.currentTime = trimIn; void video.el.play() }
          drawCover(ctx, video.el, video.el.videoWidth || width, video.el.videoHeight || height, width, height, zoom, clip.focusX, clip.focusY)
        } else {
          const bitmap = clip.visualAssetId ? images.get(clip.visualAssetId) : undefined
          if (bitmap) drawCover(ctx, bitmap, bitmap.width, bitmap.height, width, height, zoom * (clip.motion === 'kenburns' ? 1 + 0.08 * progress : 1), clip.focusX, clip.focusY)
        }
        if (clip.text) drawText(ctx, clip.text, width, height)
        const cap = captions[i].find(c => local >= c.startMs && local < c.endMs)
        if (cap) drawCaption(ctx, cap.text, width, height)
        if (composition.hookText && now < (composition.hookMs ?? 3000)) {
          const hookMs = composition.hookMs ?? 3000
          drawHook(ctx, composition.hookText, width, height, Math.min(1, (hookMs - now) / 400))
        }
        // Fade through black at clip boundaries, except where a cut was chosen.
        const fade = composition.fadeMs
        if (fade > 0) {
          const fadeIn = i === 0 || composition.clips[i - 1].transition !== 'cut'
          const fadeOut = i === last || clip.transition !== 'cut'
          const edge = Math.min(fadeIn ? local : Infinity, fadeOut ? clip.durationMs - local : Infinity)
          if (edge < fade) { ctx.fillStyle = `rgba(0,0,0,${1 - edge / fade})`; ctx.fillRect(0, 0, width, height) }
        }
      }
      videoTrack?.requestFrame()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  videos.forEach(v => v.el.pause())
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
  cleanup()
  return { blob, mimeType, durationMs: total }
}
