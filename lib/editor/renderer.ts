import { applyGainPlan, musicGainPlan } from './audio-plan'
import { audioStartMs, clipCaptions, clipStarts, formatSize, totalDurationMs, videoBitrateFor, type CaptionStyle, type Composition, type TextOverlay } from './composition'
import { BLENDS, textFrame, transitionFrame, type TextFrame } from './motion'

/**
 * Browser renderer: draws the composition on a canvas, mixes audio with WebAudio and,
 * when recording, captures both with MediaRecorder into an MP4 file (WebM where the browser cannot record MP4).
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

import { ensureWebmDuration } from './webm-duration'

export type RenderResult = { blob: Blob | null; mimeType: string | null; durationMs: number }

type LoadedVisual = { kind: 'image'; bitmap: ImageBitmap } | { kind: 'video'; el: HTMLVideoElement; url: string }

export function recordingSupported() {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

/**
 * MP4 (H.264 + AAC) first: it is what Instagram Reels requires and what every platform and player
 * accepts. Chrome/Edge 126+ and Safari record MP4 natively; Firefox falls back to WebM.
 */
export const MP4_CANDIDATES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2']
export const WEBM_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

export function pickMimeType(supports: (t: string) => boolean = t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
  // Explicit H.264 MP4 first; plain "video/mp4" (codec chosen by the browser, may not be H.264) only as a last resort.
  return [...MP4_CANDIDATES, ...WEBM_CANDIDATES, 'video/mp4'].find(supports) ?? null
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

function drawCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, style: CaptionStyle = 'box', progress = 0) {
  if (style !== 'box') return drawBoldCaption(ctx, text, w, h, style === 'karaoke' ? progress : null)
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

/** Index of the word being spoken at `progress` (0..1) of a cue, weighting each word by its length (a fair stand-in for speech timing). */
export function activeWordIndex(words: string[], progress: number) {
  const weights = words.map(w => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length))
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < words.length; i++) { acc += weights[i]; if (progress * total < acc) return i }
  return Math.max(0, words.length - 1)
}

/** Shorts-style captions: big, uppercase, outlined; with `progress` the spoken word is highlighted. */
function drawBoldCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, progress: number | null) {
  const size = Math.round(Math.min(w, h) * (w < h ? 0.075 : 0.06))
  ctx.save()
  ctx.font = `900 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  const active = progress === null ? -1 : activeWordIndex(words, progress)
  const lines = wrap(ctx, words.join(' '), w * 0.86)
  const lineH = size * 1.2
  const centerY = h * (w < h ? 0.68 : 0.8)
  const top = centerY - ((lines.length - 1) * lineH) / 2
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, size * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  let index = 0
  lines.forEach((line, li) => {
    const lw = line.split(' ')
    let x = (w - ctx.measureText(line).width) / 2
    const y = top + li * lineH
    for (const word of lw) {
      ctx.strokeText(word, x, y)
      ctx.fillStyle = index === active ? '#ffd23f' : '#fff'
      ctx.fillText(word, x, y)
      x += ctx.measureText(`${word} `).width
      index++
    }
  })
  ctx.restore()
}

function drawText(ctx: CanvasRenderingContext2D, t: TextOverlay, w: number, h: number, f: TextFrame = { alpha: 1, scale: 1, offsetY: 0, visibleChars: null }) {
  if (f.alpha <= 0) return
  const size = Math.round(Math.min(w, h) * (t.sizePct / 100) * 1.6)
  ctx.save()
  ctx.globalAlpha = f.alpha
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  // Lines are laid out on the full text so a typewriter animation never re-wraps while typing.
  const lines = wrap(ctx, t.content, w * 0.86)
  const lineH = size * 1.15
  const blockH = lines.length * lineH
  const top = (t.position === 'top' ? h * 0.1 : t.position === 'center' ? (h - blockH) / 2 : h * 0.72 - blockH) + f.offsetY * h
  if (f.scale !== 1) { const cy = top + blockH / 2; ctx.translate(w / 2, cy); ctx.scale(f.scale, f.scale); ctx.translate(-w / 2, -cy) }
  ctx.lineWidth = Math.max(3, size * 0.1); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#fff'
  let budget = f.visibleChars ?? Infinity
  lines.forEach((l, i) => {
    if (budget <= 0) return
    const shown = budget >= l.length ? l : l.slice(0, budget)
    budget -= l.length + 1
    const y = top + i * lineH + lineH / 2
    // Typed text keeps its final position: measure the full line and draw the visible part from its left edge.
    if (shown !== l) { const x = w / 2 - ctx.measureText(l).width / 2; ctx.textAlign = 'left'; ctx.strokeText(shown, x, y); ctx.fillText(shown, x, y); ctx.textAlign = 'center' }
    else { ctx.strokeText(l, w / 2, y); ctx.fillText(l, w / 2, y) }
  })
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
    if (!mimeType || !out) { cleanup(); await audio.close(); throw new Error('Este navegador no puede grabar vídeo. Usa Chrome, Edge, Safari o Firefox de escritorio.') }
    // Frames are pushed explicitly after each draw: with automatic capture, static images can leave
    // the encoder holding an earlier frame (e.g. mid-fade) for a long stretch.
    const stream = canvas.captureStream(0)
    videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    out.stream.getAudioTracks().forEach(t => stream.addTrack(t))
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoBitrateFor(total), audioBitsPerSecond: 128_000 })
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    recorder.start(1000)
  }

  const captions = composition.clips.map(c => (composition.subtitles ? clipCaptions(c) : []))
  let activeClipId: string | null = null
  const last = composition.clips.length - 1
  /** Next-clip videos already seeked to their trim point for a blending transition. */
  const primed = new Set<string>()
  const drawVisual = (k: number, progress: number) => {
    const c = composition.clips[k]
    const zoom = c.zoom ?? 1
    const v = videos.get(c.id)
    if (v) { drawCover(ctx, v.el, v.el.videoWidth || width, v.el.videoHeight || height, width, height, zoom, c.focusX, c.focusY); return }
    const bitmap = c.visualAssetId ? images.get(c.visualAssetId) : undefined
    if (bitmap) drawCover(ctx, bitmap, bitmap.width, bitmap.height, width, height, zoom * (c.motion === 'kenburns' ? 1 + 0.08 * progress : 1), c.focusX, c.focusY)
  }

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
        const video = videos.get(clip.id)
        if (activeClipId !== clip.id) {
          if (activeClipId) videos.get(activeClipId)?.el.pause()
          activeClipId = clip.id
          if (video) { if (!primed.has(clip.id)) video.el.currentTime = (clip.trimInMs ?? 0) / 1000; primed.delete(clip.id); void video.el.play() }
        }
        if (video) {
          // A clip longer than the rest of its source loops back to the trim point.
          const trimIn = (clip.trimInMs ?? 0) / 1000
          if (video.el.ended || (video.el.duration && video.el.currentTime >= video.el.duration - 0.04)) { video.el.currentTime = trimIn; void video.el.play() }
        }
        const fade = composition.fadeMs
        const kind = clip.transition ?? 'fade'
        const blending = fade > 0 && i < last && BLENDS.has(kind) && clip.durationMs - local < fade
        const tf = blending ? transitionFrame(kind, 1 - (clip.durationMs - local) / fade) : null
        ctx.save()
        if (tf && tf.aScale !== 1) { ctx.translate(width / 2, height / 2); ctx.scale(tf.aScale, tf.aScale); ctx.translate(-width / 2, -height / 2) }
        drawVisual(i, progress)
        ctx.restore()
        if (tf) {
          // The incoming clip is drawn from its first frame (a video waits paused at its trim point and starts playing when its turn comes).
          const next = composition.clips[i + 1]
          const nv = videos.get(next.id)
          if (nv && !primed.has(next.id)) { nv.el.currentTime = (next.trimInMs ?? 0) / 1000; primed.add(next.id) }
          ctx.save()
          ctx.globalAlpha = tf.bAlpha
          if (tf.bReveal < 1) { ctx.beginPath(); ctx.rect(0, 0, width * tf.bReveal, height); ctx.clip() }
          if (tf.bOffsetX) ctx.translate(width * tf.bOffsetX, 0)
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height)
          drawVisual(i + 1, 0)
          ctx.restore()
        }
        if (clip.text) drawText(ctx, clip.text, width, height, textFrame(clip.text.animation, local, clip.durationMs, clip.text.content.length))
        const cap = captions[i].find(c => local >= c.startMs && local < c.endMs)
        if (cap) drawCaption(ctx, cap.text, width, height, composition.captionStyle ?? 'box', (local - cap.startMs) / Math.max(1, cap.endMs - cap.startMs))
        if (composition.hookText && now < (composition.hookMs ?? 3000)) {
          const hookMs = composition.hookMs ?? 3000
          drawHook(ctx, composition.hookText, width, height, Math.min(1, (hookMs - now) / 400))
        }
        // Fade through black at clip boundaries where «fundido a negro» was chosen (and at the very start and end).
        if (fade > 0) {
          const fadeIn = i === 0 || (composition.clips[i - 1].transition ?? 'fade') === 'fade'
          const fadeOut = i === last || kind === 'fade'
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
    blob = signal?.aborted ? null : await ensureWebmDuration(new Blob(chunks, { type: (recorder?.mimeType || mimeType || 'video/webm').split(';')[0] }), total)
  }
  onProgress?.(total, total)
  await audio.close()
  cleanup()
  return { blob, mimeType: recorder?.mimeType || mimeType, durationMs: total }
}
