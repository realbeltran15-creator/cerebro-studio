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
import { refreshingSourceOptions, type RefreshStats } from './refreshing-source'
import { clipStarts, exportPlan, projectDurationMs, type Composition } from './composition'
import { drawOps, type DrawSource } from './draw'
import { audioTrackFactors, audioVoices, busLevels, frameAt, videoVoices as videoVoicesOf, voiceGainAt, voiceWindows, type Bus, type KindOf, type VisualOp, type Voice } from './scene'

export class FastExportUnsupported extends Error {}
export type ExportStage = 'preparar' | 'abrir-codificador' | 'audio' | 'vídeo' | 'cerrar-archivo'
/** The stage an export error happened in (set by fastExport), or undefined. */
export const exportStageOf = (e: unknown): ExportStage | undefined => (e as { stage?: ExportStage } | null)?.stage

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

/** A snapshot of the real state of an export, every ~2 s: separates what was RENDERED from what was ENCODED and handed to the destination. */
export type ExportTelemetry = {
  stage: ExportStage; frame: number; totalFrames: number; renderedMs: number; totalMs: number
  /** Bytes the muxer has handed to the destination so far (encoded data). */
  encodedBytes: number
  /** JS heap in MB (Chromium only; null elsewhere). */
  heapMb: number | null
  openInputs: number; readers: number
  urlRefreshes: number; urlRetries: number; lastUrlError: string | null
  wallMs: number
}

export async function fastExport(opts: {
  composition: Composition
  resolveUrl: (assetId: string, refresh?: boolean) => Promise<string>
  kindOf: KindOf
  onProgress?: (doneMs: number, totalMs: number) => void
  /** Real-state snapshots (frames, encoded bytes, memory, open files, URL renewals) every ~2 s. */
  onTelemetry?: (t: ExportTelemetry) => void
  signal?: AbortSignal
  fps?: number
  /** Only a SCREEN for a small live preview. The frames are always drawn on a private canvas, so the page can never resize, hide or redraw the one being encoded. */
  canvas?: HTMLCanvasElement
  /**
   * Write the finished file here AS IT IS PRODUCED (a FileSystemWritableFileStream from the File System Access API, or any seekable
   * WritableStream) instead of building it in memory. Nothing is kept in memory but the encoder's working set; `blob` is then null.
   * Cancelling or failing aborts the stream, so a half-written file is never committed.
   */
  sink?: WritableStream<{ type: 'write'; data: Uint8Array; position: number }>
  /**
   * Produce a fragmented MP4 (fMP4): the file only ever grows at its end (no seek back to patch an index), so it can be sent to a
   * destination that accepts sequential bytes only (Google Drive's resumable upload) while it is being rendered. Needs `sink` and MP4
   * (a WebM fallback is not append-only here and is refused). The cost: some editing programs and old players handle fMP4 less well
   * than a classic MP4; browsers, VLC, Drive, YouTube and phones play it.
   */
  fragmented?: boolean
  /** TESTS ONLY: use VP9 inside the MP4 container (a test browser without an H.264 encoder can then still exercise the MP4 / fragmented / AAC path). */
  testMp4Vp9?: boolean
  /** Where the export is (for logs and error messages): 'abrir-codificador', 'audio', 'vídeo', 'cerrar-archivo'. */
  onStage?: (stage: ExportStage, detail?: string) => void
}): Promise<{ blob: Blob | null; bytes: number; mimeType: string; durationMs: number; encoded: { width: number; height: number; fps: number; videoBps: number; audioBps: number; videoCodec: string; audioCodec: string; container: 'mp4' | 'webm'; fragmented: boolean } }> {
  let stage: ExportStage = 'preparar'
  const at = (st: ExportStage, detail?: string) => { stage = st; opts.onStage?.(st, detail) }
  const c = opts.composition
  const plan = exportPlan(c)
  const fps = opts.fps ?? plan.fps
  const total = projectDurationMs(c)
  const mb = await loadMb()
  const sup = opts.testMp4Vp9 ? ((await mb.canEncodeVideo('vp9', { width: plan.width, height: plan.height })) ? { ok: true, container: 'mp4' as const } : { ok: false, reason: 'Sin VP9.' }) : await fastExportSupported(plan.width, plan.height)
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
  const urlStats: RefreshStats = { refreshes: 0, retries: 0, lastError: null }
  let frameNo = 0
  const opened = new Map<string, Promise<Opened>>()
  const touched = new Map<string, number>()
  const open = (assetId: string) => {
    touched.set(assetId, frameNo)
    if (!opened.has(assetId)) opened.set(assetId, (async () => {
      const url = await opts.resolveUrl(assetId)
      const source = url.startsWith('blob:') || url.startsWith('data:') ? new mb.BlobSource(await (await fetch(url)).blob()) : new mb.CustomSource(refreshingSourceOptions(assetId, opts.resolveUrl, urlStats))
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
    if (!o.video) throw new FastExportUnsupported(`Un vídeo del montaje no tiene imagen legible.${urlStats.lastError ? ` (${urlStats.lastError})` : ''}`)
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
  if (opts.fragmented && !(mp4 && opts.sink)) throw new FastExportUnsupported('El envío directo necesita MP4 y un destino de escritura; este navegador exporta WebM.')
  if (mp4) await ensureAac(mb)
  const canvas = document.createElement('canvas')
  canvas.width = plan.width; canvas.height = plan.height
  const screen = opts.canvas ?? null
  const screenCtx = screen?.getContext('2d') ?? null
  const g = canvas.getContext('2d')
  if (!g) throw new Error('El navegador no permite dibujar en canvas.')
  // Streaming to a file cannot hold the index (moov) in memory: it is written at the end, by seeking back (fastStart false), unless
  // the output is fragmented (then it is append-only and the index travels with every fragment).
  let streamed = 0
  // The destination is only CLOSED (= declared a complete file) after a successful finalize(). mediabunny's output.cancel() closes its
  // target too: forwarding that close would tell Drive / the disk "the file is complete" for a failed export (an empty one, or worse a
  // truncated one) and the closing error would hide the real cause. After a failure the sink is aborted instead, with the real error.
  let finalized = false
  let sinkWriter: WritableStreamDefaultWriter<{ type: 'write'; data: Uint8Array; position: number }> | null = null
  if (opts.sink) sinkWriter = opts.sink.getWriter()
  const counting = sinkWriter ? new WritableStream<{ type: 'write'; data: Uint8Array<ArrayBuffer>; position: number }>({
    write: async chunk => { await sinkWriter!.write(chunk); streamed = Math.max(streamed, chunk.position + chunk.data.byteLength) },
    close: () => finalized ? sinkWriter!.close() : undefined,
    abort: reason => sinkWriter!.abort(reason),
  }) : null
  const target = counting ? new mb.StreamTarget(counting, { chunked: true, chunkSize: 8 * 1024 * 1024 }) : new mb.BufferTarget()
  const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat(opts.fragmented ? { fastStart: 'fragmented', minimumFragmentDuration: 2 } : { fastStart: counting ? false : 'in-memory' }) : new mb.WebMOutputFormat(), target })
  const videoSource = new mb.CanvasSource(canvas, { codec: mp4 && !opts.testMp4Vp9 ? 'avc' : 'vp9', bitrate: plan.videoBps, keyFrameInterval: 2 })
  const audioSource = new mb.AudioBufferSource({ codec: mp4 ? 'aac' : 'opus', bitrate: plan.audioBps })
  output.addVideoTrack(videoSource, { frameRate: fps })
  output.addAudioTrack(audioSource)
  at('abrir-codificador')
  await output.start()

  const frameMs = 1000 / fps
  const wall0 = performance.now()
  let lastTele = 0
  const emitTele = (renderedMs: number) => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    opts.onTelemetry?.({ stage, frame: frameNo, totalFrames, renderedMs, totalMs: total, encodedBytes: streamed, heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null, openInputs: opened.size, readers: readers.size, urlRefreshes: urlStats.refreshes, urlRetries: urlStats.retries, lastUrlError: urlStats.lastError, wallMs: Math.round(performance.now() - wall0) })
  }
  const totalFrames = Math.max(1, Math.ceil(total / frameMs))
  try {
    for (let a = 0; a < total; a += CHUNK_MS) {
      if (opts.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
      const b = Math.min(total, a + CHUNK_MS)
      at('audio', `${Math.round(a / 1000)} s`)
      await audioSource.add(await mixChunk(a, b))
      at('vídeo', `${Math.round(a / 1000)} s`)
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
        if (frameNo % fps === 0) {
          for (const [slot, r] of readers) if (frameNo - r.usedAt > fps * 3) closeReader(slot)
          // A file nobody has read for ~20 s (and with no live reader) is closed: its read cache and decoder state are released. A long
          // montage touches hundreds of files; keeping every one open grew memory without bound. Reopening later only re-reads the header.
          const busy = new Set([...readers.values()].map(r => r.assetId))
          for (const [id, at] of touched) if (frameNo - at > fps * 20 && !busy.has(id)) { touched.delete(id); const p = opened.get(id); opened.delete(id); void p?.then(o => o.input.dispose?.(), () => undefined) }
        }
        if (opts.onTelemetry && performance.now() - lastTele >= 2000) { lastTele = performance.now(); emitTele(t) }
        if (frameNo % 5 === 0) opts.onProgress?.(t, total)
        if (screenCtx && screen && frameNo % (fps * 2) === 0) { try { screenCtx.drawImage(canvas, 0, 0, screen.width, screen.height) } catch { /* the preview is optional */ } }
      }
    }
    finalized = true
    at('cerrar-archivo')
    await output.finalize()
  } catch (e) {
    if (e && typeof e === 'object' && !('stage' in e)) try { (e as { stage?: ExportStage }).stage = stage } catch { /* frozen error */ }
    await output.cancel().catch(() => undefined)
    // A half-written file must never be committed: aborting the writable discards its swap file and leaves any earlier file untouched.
    if (sinkWriter) await sinkWriter.abort(e).catch(() => undefined)
    throw e
  } finally {
    for (const slot of [...readers.keys()]) closeReader(slot)
    for (const p of opened.values()) void p.then(o => o.input.dispose?.(), () => undefined)
    for (const p of images.values()) void p.then(bm => bm.close(), () => undefined)
  }
  opts.onProgress?.(total, total)
  const mime = mp4 ? 'video/mp4;codecs=avc1,mp4a.40.2' : 'video/webm;codecs=vp9,opus'
  const encoded = { width: plan.width, height: plan.height, fps, videoBps: plan.videoBps, audioBps: plan.audioBps, videoCodec: mp4 && !opts.testMp4Vp9 ? 'avc' : 'vp9', audioCodec: mp4 ? 'aac' : 'opus', container: (mp4 ? 'mp4' : 'webm') as 'mp4' | 'webm', fragmented: !!opts.fragmented }
  if (counting) {
    if (!streamed) throw new Error('La exportación rápida no produjo ningún archivo.')
    return { blob: null, bytes: streamed, mimeType: mime, durationMs: total, encoded }
  }
  const data = (target as InstanceType<MB['BufferTarget']>).buffer ? new Uint8Array((target as InstanceType<MB['BufferTarget']>).buffer!) : new Uint8Array()
  if (!data.length) throw new Error('La exportación rápida no produjo ningún archivo.')
  return { blob: new Blob([data as BlobPart], { type: mp4 ? 'video/mp4' : 'video/webm' }), bytes: data.length, mimeType: mime, durationMs: total, encoded }

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
