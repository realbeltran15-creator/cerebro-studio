/**
 * Fast export: renders the montage frame by frame, as fast as the computer can decode and encode, instead of playing it in real time.
 * Same frame description (scene.ts), same drawing (draw.ts) and the same voice levels (voiceGainAt) as the player and the real-time
 * exporter, so the picture and the mix match what the viewer shows.
 *
 * - Video: WebCodecs H.264 (MP4) or VP9 (WebM, where H.264 is not available) through Mediabunny (MPL-2.0); every video clip is decoded
 *   sequentially (each packet once), not seeked.
 * - Audio: mixed offline with OfflineAudioContext in 10-second chunks (never the whole soundtrack in memory) and encoded to AAC
 *   (native, or the LGPL WASM extension where the browser has no AAC encoder).
 * - Not used (the real-time exporter takes over) when the browser lacks WebCodecs H.264, when a file cannot be decoded here, or when a
 *   video with sound plays at another speed (the real-time path keeps its pitch; this one could not).
 */
import { clipStarts, exportPlan, projectDurationMs, type Composition } from './composition'
import { drawOps, type DrawSource } from './draw'
import { audioTrackFactors, audioVoices, busLevels, frameAt, videoVoices as videoVoicesOf, voiceGainAt, voiceWindows, type Bus, type KindOf, type VisualOp, type Voice } from './scene'

export class FastExportUnsupported extends Error {}

type MB = typeof import('mediabunny')
let mbPromise: Promise<MB> | null = null
const loadMb = () => (mbPromise ??= import('mediabunny'))
let aacReady: Promise<void> | null = null

const SR = 48_000
const CHUNK_MS = 10_000

/**
 * Whether this browser can export fast, and in what: MP4 (H.264 + AAC) where it can encode H.264 (Chrome, Edge, Safari), otherwise
 * WebM (VP9 + Opus, e.g. Firefox). Never throws.
 */
export async function fastExportSupported(width = 1280, height = 720): Promise<{ ok: boolean; container?: 'mp4' | 'webm'; reason?: string }> {
  try {
    if (typeof VideoEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return { ok: false, reason: 'Este navegador no tiene WebCodecs.' }
    const mb = await loadMb()
    if (await mb.canEncodeVideo('avc', { width, height })) return { ok: true, container: 'mp4' }
    if (await mb.canEncodeVideo('vp9', { width, height }) && await mb.canEncodeAudio('opus')) return { ok: true, container: 'webm' }
    return { ok: false, reason: 'Este navegador no codifica vídeo con WebCodecs.' }
  } catch { return { ok: false, reason: 'No se pudo comprobar el codificador.' } }
}

async function ensureAac(mb: MB) {
  if (typeof AudioEncoder !== 'undefined' && await mb.canEncodeAudio('aac').catch(() => false)) return
  aacReady ??= import('@mediabunny/aac-encoder').then(m => { m.registerAacEncoder() })
  await aacReady
}

type Opened = { input: InstanceType<MB['Input']>; video: Awaited<ReturnType<InstanceType<MB['Input']>['getPrimaryVideoTrack']>>; audio: Awaited<ReturnType<InstanceType<MB['Input']>['getPrimaryAudioTrack']>>; duration: number }

export async function fastExport(opts: {
  composition: Composition
  resolveUrl: (assetId: string) => Promise<string>
  kindOf: KindOf
  onProgress?: (doneMs: number, totalMs: number) => void
  signal?: AbortSignal
  fps?: number
  canvas?: HTMLCanvasElement
}): Promise<{ blob: Blob; mimeType: string; durationMs: number }> {
  const c = opts.composition
  const fps = opts.fps ?? 30
  const plan = exportPlan(c)
  const total = projectDurationMs(c)
  const mb = await loadMb()
  const sup = await fastExportSupported(plan.width, plan.height)
  if (!sup.ok) throw new FastExportUnsupported(sup.reason)
  const starts = clipStarts(c)
  const factors = audioTrackFactors(c)
  const levels = busLevels(c)

  // The videos' own sound, as voices (with the transitions' crossfades), decoded like any other sound.
  const videoVoices = videoVoicesOf(c, opts.kindOf)
  if (videoVoices.some(v => Math.abs(v.rate - 1) > 0.001)) throw new FastExportUnsupported('Hay vídeos con sonido a otra velocidad: se exporta en tiempo real para mantener el tono de su audio.')
  const voices: Array<Voice & { rate: number; trimSec: number }> = [...audioVoices(c).map(v => ({ ...v, rate: 1, trimSec: v.loop ? 0 : v.sourceStartMs / 1000 })), ...videoVoices]
  const windows = voiceWindows(voices)

  // ---- Open every file once.
  const opened = new Map<string, Promise<Opened>>()
  const open = (assetId: string) => {
    if (!opened.has(assetId)) opened.set(assetId, (async () => {
      const url = await opts.resolveUrl(assetId)
      const source = url.startsWith('blob:') || url.startsWith('data:') ? new mb.BlobSource(await (await fetch(url)).blob()) : new mb.UrlSource(url)
      const input = new mb.Input({ source, formats: mb.ALL_FORMATS })
      const [video, audio] = await Promise.all([input.getPrimaryVideoTrack().catch(() => null), input.getPrimaryAudioTrack().catch(() => null)])
      if (video && !(await video.canDecode())) throw new FastExportUnsupported('Un vídeo del montaje no se puede decodificar aquí (códec no compatible con WebCodecs).')
      if (audio && !(await audio.canDecode())) throw new FastExportUnsupported('El audio de un archivo no se puede decodificar aquí.')
      const duration = await input.computeDuration().catch(() => Infinity)
      return { input, video, audio, duration }
    })())
    return opened.get(assetId)!
  }
  const images = new Map<string, Promise<ImageBitmap>>()
  const image = (assetId: string) => {
    if (!images.has(assetId)) images.set(assetId, (async () => createImageBitmap(await (await fetch(await opts.resolveUrl(assetId))).blob()))())
    return images.get(assetId)!
  }

  // ---- Sequential readers, one per video layer (clip or overlay): frames are decoded in order, each packet once.
  type Frame = { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number }
  type Reader = { assetId: string; it: AsyncGenerator<Frame, void, unknown>; cur: Frame | null; nxt: Frame | null; ended: boolean; last: number; usedAt: number }
  const readers = new Map<string, Reader>()
  const newReader = async (slot: string, assetId: string, ts: number) => {
    const o = await open(assetId)
    if (!o.video) throw new FastExportUnsupported('Un vídeo del montaje no tiene imagen legible.')
    const sink = new mb.CanvasSink(o.video)
    const it = sink.canvases(Math.max(0, ts - 0.25)) as AsyncGenerator<Frame, void, unknown>
    const first = await it.next(), second = first.done ? first : await it.next()
    const r: Reader = { assetId, it, cur: first.done ? null : first.value, nxt: second.done ? null : second.value, ended: !!second.done, last: ts, usedAt: 0 }
    readers.set(slot, r)
    return r
  }
  const closeReader = (slot: string) => { const r = readers.get(slot); if (r) { void r.it.return(undefined); readers.delete(slot) } }
  const trimOf = (op: VisualOp) => (op.slot.startsWith('ov:') ? (c.overlays ?? []).find(o => `ov:${o.id}` === op.slot)?.trimInMs ?? 0 : c.clips.find(k => k.id === op.slot)?.trimInMs ?? 0) / 1000
  async function videoFrame(op: VisualOp, frameNo: number): Promise<DrawSource | null> {
    const o = await open(op.assetId)
    let ts = op.sourceMs / 1000
    if (Number.isFinite(o.duration) && o.duration > 0 && ts >= o.duration - 0.001) { const trim = trimOf(op); const span = Math.max(0.1, o.duration - trim); ts = trim + ((ts - trim) % span) }
    let r = readers.get(op.slot)
    // Going back (a loop, or a held frame before the clip plays) starts a new reader from there.
    if (r && (r.assetId !== op.assetId || ts < r.last - 1e-4)) { closeReader(op.slot); r = undefined }
    r ??= await newReader(op.slot, op.assetId, ts)
    r.usedAt = frameNo
    r.last = ts
    while (r.nxt && r.nxt.timestamp <= ts + 1e-6) {
      r.cur = r.nxt
      const n = await r.it.next()
      r.nxt = n.done ? null : n.value
    }
    return r.cur ? { src: r.cur.canvas as CanvasImageSource, width: r.cur.canvas.width, height: r.cur.canvas.height } : null
  }

  // ---- Output.
  const mp4 = sup.container === 'mp4'
  if (mp4) await ensureAac(mb)
  const canvas = opts.canvas ?? document.createElement('canvas')
  canvas.width = plan.width; canvas.height = plan.height
  const g = canvas.getContext('2d')
  if (!g) throw new Error('El navegador no permite dibujar en canvas.')
  const target = new mb.BufferTarget()
  const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(), target })
  const videoSource = new mb.CanvasSource(canvas, { codec: mp4 ? 'avc' : 'vp9', bitrate: plan.videoBps, keyFrameInterval: 2 })
  const audioSource = new mb.AudioBufferSource({ codec: mp4 ? 'aac' : 'opus', bitrate: plan.audioBps })
  output.addVideoTrack(videoSource, { frameRate: fps })
  output.addAudioTrack(audioSource)
  await output.start()

  const frameMs = 1000 / fps
  const totalFrames = Math.max(1, Math.ceil(total / frameMs))
  let frameNo = 0
  try {
    for (let a = 0; a < total; a += CHUNK_MS) {
      if (opts.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
      const b = Math.min(total, a + CHUNK_MS)
      await audioSource.add(await mixChunk(a, b))
      // Video frames whose time falls inside this chunk.
      for (; frameNo < totalFrames && frameNo * frameMs < b; frameNo++) {
        if (opts.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
        const t = frameNo * frameMs
        const ops = frameAt(c, Math.min(t, total - 1), opts.kindOf, starts)
        const srcs = new Map<VisualOp, DrawSource | null>()
        for (const op of ops) {
          if (op.type !== 'visual') continue
          srcs.set(op, op.media === 'image' ? await image(op.assetId).then(bm => ({ src: bm, width: bm.width, height: bm.height })) : await videoFrame(op, frameNo))
        }
        drawOps(g, ops, plan.width, plan.height, op => srcs.get(op) ?? null)
        await videoSource.add(t / 1000, frameMs / 1000)
        // Readers not used for a few seconds are closed (their decoder and frames released).
        if (frameNo % fps === 0) for (const [slot, r] of readers) if (frameNo - r.usedAt > fps * 3) closeReader(slot)
        if (frameNo % 5 === 0) opts.onProgress?.(t, total)
      }
    }
    await output.finalize()
  } catch (e) {
    await output.cancel().catch(() => undefined)
    throw e
  } finally {
    for (const slot of [...readers.keys()]) closeReader(slot)
    for (const p of opened.values()) void p.then(o => o.input.dispose?.(), () => undefined)
    for (const p of images.values()) void p.then(bm => bm.close(), () => undefined)
  }
  opts.onProgress?.(total, total)
  const data = target.buffer ? new Uint8Array(target.buffer) : new Uint8Array()
  if (!data.length) throw new Error('La exportación rápida no produjo ningún archivo.')
  return mp4
    ? { blob: new Blob([data as BlobPart], { type: 'video/mp4' }), mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', durationMs: total }
    : { blob: new Blob([data as BlobPart], { type: 'video/webm' }), mimeType: 'video/webm;codecs=vp9,opus', durationMs: total }

  /** The mix of [a, b) ms, rendered offline with the same levels the player applies. */
  async function mixChunk(a: number, b: number): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.round((b - a) / 1000 * SR)), SR)
    const master = ctx.createGain(); master.connect(ctx.destination)
    const buses = Object.fromEntries((['video', 'voice', 'music', 'sfx'] as const).map(k => { const n = ctx.createGain(); n.gain.value = levels[k]; n.connect(master); return [k, n] })) as Record<Bus, GainNode>
    for (const v of voices) {
      if (v.endMs <= a || v.startMs >= b) continue
      const o = await open(v.assetId)
      if (!o.audio) continue
      const sink = new mb.AudioBufferSink(o.audio)
      const gain = ctx.createGain()
      const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null
      if (pan) { pan.pan.value = v.pan; gain.connect(pan); pan.connect(buses[v.bus]) } else gain.connect(buses[v.bus])
      // Level every 20 ms, smoothed like the player does.
      const factor = factors.get(v.trackId) ?? 1
      const from = Math.max(a, v.startMs), to = Math.min(b, v.endMs)
      let prev = voiceGainAt(v, from, windows, total) * factor
      gain.gain.setValueAtTime(prev, (from - a) / 1000)
      for (let t = from + 20; t < to; t += 20) {
        const lv = voiceGainAt(v, t, windows, total) * factor
        if (lv !== prev) gain.gain.setTargetAtTime(lv, (t - a) / 1000, lv < prev ? 0.03 : 0.06)
        prev = lv
      }
      gain.gain.setValueAtTime(0, Math.min((b - a) / 1000, (to - a) / 1000))
      // Source stretches: the file from where this part of the voice starts; looping voices wrap at the end of the file.
      const segs: Array<{ srcFrom: number; srcTo: number; at: number }> = []
      const dur = Number.isFinite(o.duration) && o.duration > 0 ? o.duration : Infinity
      let t = from
      while (t < to - 1) {
        let src = v.sourceStartMs / 1000 + (t - v.startMs) / 1000 * v.rate
        const span = dur - v.trimSec
        if (src >= dur - 0.0005) { if (!(v.loop || v.bus === 'video') || !Number.isFinite(span) || span <= 0.05) break; src = v.trimSec + ((src - v.trimSec) % span) }
        const left = Math.min((to - t) / 1000 * v.rate, dur - src)
        if (left <= 0.0005) break
        segs.push({ srcFrom: src, srcTo: src + left, at: (t - a) / 1000 })
        t += left / v.rate * 1000
      }
      for (const sg of segs) {
        for await (const wb of sink.buffers(Math.max(0, sg.srcFrom - 0.05), sg.srcTo)) {
          const node = ctx.createBufferSource()
          node.buffer = wb.buffer
          node.playbackRate.value = v.rate
          const when = sg.at + (wb.timestamp - sg.srcFrom) / v.rate
          const offset = when < 0 ? -when * v.rate : 0
          const until = sg.at + (sg.srcTo - sg.srcFrom) / v.rate
          if (offset >= wb.buffer.duration || when >= until) continue
          node.connect(gain)
          const startAt = Math.max(0, when)
          node.start(startAt, offset, Math.max(0, Math.min(wb.buffer.duration - offset, (until - startAt) * v.rate)))
        }
      }
    }
    return ctx.startRendering()
  }
}
