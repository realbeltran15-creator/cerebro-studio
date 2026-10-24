/**
 * Offline render engine: turns a montage (the editor's Composition JSON) into an MP4 without a browser.
 * Runs in Node with FFmpeg and a canvas (@napi-rs/canvas). Nothing here costs money; it runs on any computer that has FFmpeg.
 *
 * It does NOT re-implement the montage: it calls the same pure functions the editor's player and exporters use —
 * `frameAt` (what is on screen at each instant), `drawOps` (how it is painted), `audioVoices`/`videoVoices`/`voiceGainAt`
 * (what is heard and how loud) — so pictures and levels come from the same code as the preview.
 *
 * Long videos (90 min and more):
 *  - The timeline is cut into segments (at clip starts, at most MAX_SEGMENT_S long). Each segment is fingerprinted from the exact
 *    drawing instructions of its frames (ids removed, files identified by size+mtime), so identical segments — a scene that repeats,
 *    a still image that stays on screen — are rendered ONCE and reused.
 *  - Finished segments are kept in the work folder; running again resumes where it stopped (an interrupted segment is redone).
 *  - Sound is mixed in 10 s chunks (never the whole soundtrack in memory) and encoded to AAC.
 *  - Everything is joined without re-encoding.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, createWriteStream, existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { clipStarts, exportPlan, projectDurationMs, type Composition } from '../editor/composition'
import { drawOps, type DrawSource } from '../editor/draw'
import { audioTrackFactors, audioVoices, busLevels, frameAt, videoVoices as videoVoicesOf, voiceGainAt, voiceWindows, type Bus, type KindOf, type Op, type VisualOp, type Voice } from '../editor/scene'

const execFileP = promisify(execFile)
export const SR = 48_000
const AUDIO_CHUNK_MS = 10_000
export const MAX_SEGMENT_S = 60

export type AssetFile = { path: string; kind: 'video' | 'image' | 'audio' }
export type RenderEvent =
  | { phase: 'plan'; totalFrames: number; segments: number; unique: number; reused: number; cached: number }
  | { phase: 'video'; doneFrames: number; totalFrames: number; segment: number; segments: number; fps: number }
  | { phase: 'audio'; doneMs: number; totalMs: number }
  | { phase: 'mux' }
  | { phase: 'done'; output: string; seconds: number }
export type RenderOptions = {
  composition: Composition
  assets: Record<string, AssetFile>
  /** Final file (.mp4). */
  output: string
  /** Folder for segments and the mixed sound: keep it to resume or to reuse segments in the next render. */
  workDir: string
  fps?: number
  /** Constant-quality factor of x264 (lower = better and bigger). The export's bitrate is used as a ceiling. */
  crf?: number
  preset?: string
  /** Only render [fromMs, toMs) — for a quick fidelity check of a part of a long montage. */
  rangeMs?: { from: number; to: number }
  onEvent?: (e: RenderEvent) => void
  signal?: AbortSignal
  ffmpeg?: string
  ffprobe?: string
  /** Extra font files to register (the editor's text uses system fonts that a server may not have). */
  fontFiles?: string[]
}

type Probe = { width: number; height: number; durationSec: number; hasAudio: boolean; channels: number }
const ABORT = () => new DOMException('Cancelado', 'AbortError')

export async function renderProject(o: RenderOptions) {
  const started = Date.now()
  const ffmpeg = o.ffmpeg ?? 'ffmpeg', ffprobe = o.ffprobe ?? 'ffprobe'
  const fps = o.fps ?? 30
  const c = o.composition
  const plan = exportPlan(c)
  const W = plan.width, H = plan.height
  const fullTotal = projectDurationMs(c)
  const range = o.rangeMs ?? { from: 0, to: fullTotal }
  const frameMs = 1000 / fps
  const f0 = Math.floor(range.from / frameMs), f1 = Math.max(f0 + 1, Math.ceil(Math.min(range.to, fullTotal) / frameMs))
  const kindOf: KindOf = id => o.assets[id]?.kind ?? null
  const starts = clipStarts(c)
  await fs.mkdir(path.join(o.workDir, 'segments'), { recursive: true })
  await fs.mkdir(path.dirname(path.resolve(o.output)), { recursive: true })
  if (o.signal?.aborted) throw ABORT()

  // ---- Files: identity (for the fingerprints) and probes.
  const sig = new Map<string, string>()
  const probes = new Map<string, Probe>()
  for (const [id, a] of Object.entries(o.assets)) {
    const st = await fs.stat(a.path).catch(() => null)
    if (st) sig.set(id, `${path.basename(a.path)}:${st.size}:${Math.round(st.mtimeMs)}`)
  }
  const probe = async (assetId: string): Promise<Probe> => {
    const hit = probes.get(assetId); if (hit) return hit
    const a = o.assets[assetId]
    if (!a || !existsSync(a.path)) throw new Error(`Falta el archivo del material ${assetId}.`)
    const { stdout } = await execFileP(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', a.path], { maxBuffer: 32 << 20 })
    const j = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; channels?: number; width?: number; height?: number; side_data_list?: Array<{ rotation?: number }>; tags?: { rotate?: string } }>; format?: { duration?: string } }
    const v = j.streams?.find(s => s.codec_type === 'video')
    let w = v?.width ?? 0, h = v?.height ?? 0
    const rot = Math.abs(Number(v?.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0)) % 180
    if (rot === 90) [w, h] = [h, w]
    const p = { width: w, height: h, durationSec: Number(j.format?.duration) || 0, hasAudio: !!j.streams?.some(s => s.codec_type === 'audio'), channels: j.streams?.find(s => s.codec_type === 'audio')?.channels ?? 0 }
    probes.set(assetId, p); return p
  }

  // ---- Plan: segments and fingerprints.
  const bounds = new Set<number>([f0, f1])
  for (const s of starts) { const f = Math.ceil(s / frameMs); if (f > f0 && f < f1) bounds.add(f) }
  const cuts = [...bounds].sort((a, b) => a - b)
  const maxFrames = Math.round(MAX_SEGMENT_S * fps)
  const segs: Array<{ from: number; to: number; hash: string }> = []
  const opsAt = (f: number) => frameAt(c, Math.min(f * frameMs, fullTotal - 1), kindOf, starts)
  // Numbers are rounded to 1e-5: the same scene drawn at another position of the timeline differs only by floating-point noise.
  const finger = (ops: Op[]) => JSON.stringify(ops, (k, v) => (k === 'id' || k === 'slot' ? undefined : k === 'assetId' ? sig.get(v as string) ?? v : typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v))
  const settings = `v1|${W}x${H}|${fps}|${o.crf ?? 20}|${o.preset ?? 'veryfast'}|${plan.wantedBps}`
  for (let i = 0; i + 1 < cuts.length; i++) {
    for (let a = cuts[i]; a < cuts[i + 1]; a += maxFrames) {
      const b = Math.min(cuts[i + 1], a + maxFrames)
      const h = createHash('sha1'); h.update(settings); h.update(`|${b - a}|`)
      for (let f = a; f < b; f++) h.update(finger(opsAt(f)))
      segs.push({ from: a, to: b, hash: h.digest('hex').slice(0, 24) })
    }
    if (o.signal?.aborted) throw ABORT()
  }
  const segFile = (hash: string) => path.join(o.workDir, 'segments', `${hash}.ts`)
  const uniqueHashes = [...new Set(segs.map(s => s.hash))]
  const cached = uniqueHashes.filter(h => existsSync(segFile(h))).length
  o.onEvent?.({ phase: 'plan', totalFrames: f1 - f0, segments: segs.length, unique: uniqueHashes.length, reused: segs.length - uniqueHashes.length, cached })

  // ---- Canvas and fonts.
  const cv = await import('@napi-rs/canvas')
  for (const f of o.fontFiles ?? []) cv.GlobalFonts.registerFromPath(f)
  const canvas = cv.createCanvas(W, H)
  const g = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  const images = new Map<string, Awaited<ReturnType<typeof cv.loadImage>>>()
  const image = async (assetId: string) => images.get(assetId) ?? (images.set(assetId, await cv.loadImage(o.assets[assetId].path)), images.get(assetId)!)

  // ---- Video segments.
  const doneSegs = new Set(uniqueHashes.filter(h => existsSync(segFile(h))))
  let doneFrames = 0
  const total = f1 - f0
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si]
    if (doneSegs.has(s.hash)) { doneFrames += s.to - s.from; o.onEvent?.({ phase: 'video', doneFrames, totalFrames: total, segment: si + 1, segments: segs.length, fps: 0 }); continue }
    if (o.signal?.aborted) throw ABORT()
    const tmp = `${segFile(s.hash)}.part`
    const enc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', o.preset ?? 'veryfast', '-crf', String(o.crf ?? 20),
      '-maxrate', String(plan.wantedBps), '-bufsize', String(plan.wantedBps * 2), '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0', '-bf', '2',
      '-profile:v', 'high', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-an', '-f', 'mpegts', tmp], { stdio: ['pipe', 'ignore', 'pipe'] })
    let encErr = ''
    enc.stderr!.on('data', d => { encErr += String(d) })
    const encDone = new Promise<void>((res, rej) => { enc.on('close', code => (code === 0 ? res() : rej(new Error(`FFmpeg (codificador) terminó con código ${code}: ${encErr.slice(-400)}`)))) })
    encDone.catch(() => undefined)
    const readers = new Map<string, VideoReader>()
    let prevKey = '', prevBuf: Buffer | null = null
    const t0 = Date.now()
    try {
      for (let f = s.from; f < s.to; f++) {
        if (o.signal?.aborted) throw ABORT()
        const ops = opsAt(f)
        // Nothing changed since the previous frame (a still picture, a held frame): the same pixels again, no drawing and no decoding.
        const key = finger(ops)
        if (key === prevKey && prevBuf) {
          if (!enc.stdin!.write(prevBuf)) await new Promise<void>(r => enc.stdin!.once('drain', () => r()))
          continue
        }
        const srcs = new Map<VisualOp, DrawSource | null>()
        for (const op of ops) {
          if (op.type !== 'visual') continue
          if (op.media === 'image') { const im = await image(op.assetId); srcs.set(op, { src: im as unknown as CanvasImageSource, width: im.width, height: im.height }) }
          else {
            let r = readers.get(op.slot)
            if (!r) { r = new VideoReader({ ffmpeg, file: o.assets[op.assetId].path, probe: await probe(op.assetId), fps, outW: W, cv }); readers.set(op.slot, r) }
            srcs.set(op, await r.frame(op.sourceMs, op.rate))
          }
        }
        drawOps(g, ops, W, H, op => srcs.get(op) ?? null)
        const buf = canvas.data()
        prevKey = key; prevBuf = Buffer.from(buf)
        if (!enc.stdin!.write(prevBuf)) await new Promise<void>(r => enc.stdin!.once('drain', () => r()))
        const n = f - s.from + 1
        if (n % 30 === 0) o.onEvent?.({ phase: 'video', doneFrames: doneFrames + n, totalFrames: total, segment: si + 1, segments: segs.length, fps: n / Math.max(0.001, (Date.now() - t0) / 1000) })
      }
      enc.stdin!.end()
      await encDone
      await fs.rename(tmp, segFile(s.hash))
      doneSegs.add(s.hash)
    } catch (e) {
      enc.kill('SIGKILL'); await fs.rm(tmp, { force: true }).catch(() => undefined); throw e
    } finally { for (const r of readers.values()) r.close() }
    doneFrames += s.to - s.from
    o.onEvent?.({ phase: 'video', doneFrames, totalFrames: total, segment: si + 1, segments: segs.length, fps: (s.to - s.from) / Math.max(0.001, (Date.now() - t0) / 1000) })
  }

  // ---- Sound.
  const audioFile = path.join(o.workDir, `audio-${createHash('sha1').update(JSON.stringify({ v: 1, r: [f0, f1], c: audioKey(c), s: [...sig.entries()] })).digest('hex').slice(0, 16)}.m4a`)
  if (!existsSync(audioFile)) await mixAudio({ c, o, kindOf, probe, out: audioFile, fromMs: f0 * frameMs, toMs: Math.min(fullTotal, f1 * frameMs), ffmpeg, total: fullTotal })

  // ---- Join without re-encoding.
  o.onEvent?.({ phase: 'mux' })
  const list = path.join(o.workDir, 'concat.txt')
  await fs.writeFile(list, segs.map(s => `file '${segFile(s.hash).replace(/'/g, "'\\''")}'`).join('\n'))
  const tmpOut = `${path.resolve(o.output)}.part.mp4`
  await execFileP(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', audioFile, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', tmpOut], { maxBuffer: 16 << 20 })
  await fs.rename(tmpOut, path.resolve(o.output))
  const seconds = (Date.now() - started) / 1000
  o.onEvent?.({ phase: 'done', output: o.output, seconds })
  return { output: o.output, seconds, width: W, height: H, fps, segments: segs.length, unique: uniqueHashes.length, durationMs: (f1 - f0) * frameMs }
}

/** The parts of a montage that decide its sound (a change in the picture alone does not redo the mix). */
function audioKey(c: Composition) {
  return JSON.stringify({ a: c.audioClips, m: c.musicAssetId, mv: c.musicVolume, d: c.duckMusic, mix: c.mix, tr: c.tracks, ov: (c.overlays ?? []).map(o => [o.assetId, o.startMs, o.durationMs, o.trimInMs, o.speed, o.volume, o.muted, o.trackId]),
    cl: c.clips.map(k => [k.visualAssetId, k.voiceAssetId, k.durationMs, k.trimInMs, k.speed, k.volume, k.muted, k.transition, k.transitionMs]), f: c.fadeMs, e: c.exportSettings?.resolution })
}

// ---------------------------------------------------------------- picture from video files
class VideoReader {
  private proc: ChildProcess | null = null
  private chunks: Buffer[] = []
  private buffered = 0
  private ended = false
  private wake: (() => void) | null = null
  private lastMs = -1e9
  private step = 0
  private readonly w: number; private readonly h: number; private readonly frameBytes: number
  private readonly canvas: { getContext(t: '2d'): { putImageData(d: unknown, x: number, y: number): void }; width: number; height: number }
  private has = false
  private eof = false
  constructor(private o: { ffmpeg: string; file: string; probe: Probe; fps: number; outW: number; cv: typeof import('@napi-rs/canvas') }) {
    // Decoded no larger than 1.5× the output width (a 4K file is not carried around at full size).
    const maxW = Math.round(o.outW * 1.5)
    const scale = Math.min(1, maxW / Math.max(1, o.probe.width))
    this.w = Math.max(2, Math.round(o.probe.width * scale / 2) * 2); this.h = Math.max(2, Math.round(o.probe.height * scale / 2) * 2)
    this.frameBytes = this.w * this.h * 4
    this.canvas = o.cv.createCanvas(this.w, this.h) as unknown as VideoReader['canvas']
  }
  close() { this.proc?.kill('SIGKILL'); this.proc = null }
  private start(sourceMs: number, rate: number) {
    this.close(); this.chunks = []; this.buffered = 0; this.ended = false; this.eof = false
    const vf = `${rate !== 1 ? `setpts=PTS/${rate},` : ''}fps=${this.o.fps},scale=${this.w}:${this.h}`
    const p = spawn(this.o.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', (sourceMs / 1000).toFixed(3), '-i', this.o.file, '-an', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { stdio: ['ignore', 'pipe', 'ignore'] })
    p.stdout!.on('data', (d: Buffer) => { this.chunks.push(d); this.buffered += d.length; if (this.buffered > this.frameBytes * 6) p.stdout!.pause(); this.wake?.() })
    p.on('close', () => { this.ended = true; this.wake?.() })
    this.proc = p; this.step = rate * 1000 / this.o.fps; this.lastMs = sourceMs - this.step
  }
  private async nextRaw(): Promise<Buffer | null> {
    while (this.buffered < this.frameBytes) {
      if (this.ended) return null
      await new Promise<void>(r => { this.wake = r; setTimeout(r, 2000) })
    }
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
    const frame = all.subarray(0, this.frameBytes)
    const rest = all.subarray(this.frameBytes)
    this.chunks = rest.length ? [rest] : []; this.buffered = rest.length
    this.proc?.stdout?.resume()
    return Buffer.from(frame)
  }
  /** The picture at `sourceMs`: the next decoded frame when playing on, the same one when held, a new start when it jumped or the speed changed. */
  async frame(sourceMs: number, rate: number): Promise<DrawSource | null> {
    const step = rate * 1000 / this.o.fps
    if (this.proc && Math.abs(step - this.step) > 1e-6) this.close()
    if (!this.proc) this.start(sourceMs, rate)
    let d = sourceMs - this.lastMs
    if (this.has && Math.abs(d) < step * 0.5) return this.out()
    if (this.eof && d > 0) return this.out()
    if (d < 0 || d > step * 1.5) { this.start(sourceMs, rate); d = step }
    const raw = await this.nextRaw()
    if (raw) {
      this.lastMs += this.step
      ;(this.canvas.getContext('2d') as unknown as CanvasRenderingContext2D).putImageData(new this.o.cv.ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length), this.w, this.h) as unknown as ImageData, 0, 0)
      this.has = true
    } else this.eof = true
    return this.has ? this.out() : null
  }
  private out(): DrawSource { return { src: this.canvas as unknown as CanvasImageSource, width: this.w, height: this.h } }
}

// ---------------------------------------------------------------- sound
async function mixAudio(p: { c: Composition; o: RenderOptions; kindOf: KindOf; probe: (id: string) => Promise<Probe>; out: string; fromMs: number; toMs: number; ffmpeg: string; total: number }) {
  const { c, o, kindOf } = p
  const factors = audioTrackFactors(c), levels = busLevels(c)
  const voices: Array<Voice & { rate: number; trimSec: number }> = [...audioVoices(c).map(v => ({ ...v, rate: 1, trimSec: v.loop ? 0 : v.sourceStartMs / 1000 })), ...videoVoicesOf(c, kindOf)]
  const windows = voiceWindows(voices)
  const info = new Map<string, Probe | null>()
  for (const v of voices) if (!info.has(v.assetId)) info.set(v.assetId, o.assets[v.assetId] ? await p.probe(v.assetId).catch(() => null) : null)
  const tmp = `${p.out}.part`
  const enc = spawn(p.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-', '-c:a', 'aac', '-b:a', '128k', '-f', 'ipod', tmp], { stdio: ['pipe', 'ignore', 'pipe'] })
  let err = ''
  enc.stderr!.on('data', d => { err += String(d) })
  const done = new Promise<void>((res, rej) => enc.on('close', code => (code === 0 ? res() : rej(new Error(`FFmpeg (audio) terminó con código ${code}: ${err.slice(-300)}`)))))
  done.catch(() => undefined)
  try {
    for (let a = p.fromMs; a < p.toMs; a += AUDIO_CHUNK_MS) {
      if (o.signal?.aborted) throw ABORT()
      const b = Math.min(p.toMs, a + AUDIO_CHUNK_MS)
      const n = Math.max(1, Math.round((b - a) / 1000 * SR))
      const mix = new Float32Array(n * 2)
      for (const v of voices) {
        if (v.endMs <= a || v.startMs >= b) continue
        const pr = info.get(v.assetId)
        if (!pr?.hasAudio) continue
        const from = Math.max(a, v.startMs), to = Math.min(b, v.endMs)
        const factor = factors.get(v.trackId) ?? 1
        const level = levels[v.bus as Bus]
        // Level every 20 ms (the same function the player uses), linear in between.
        const steps = Math.ceil((to - from) / 20) + 1
        const gains = new Float32Array(steps)
        for (let i = 0; i < steps; i++) gains[i] = voiceGainAt(v, Math.min(to, from + i * 20), windows, p.total) * factor * level
        const dur = pr.durationSec > 0 ? pr.durationSec : Infinity
        let t = from
        while (t < to - 1) {
          let src = v.sourceStartMs / 1000 + (t - v.startMs) / 1000 * v.rate
          const span = dur - v.trimSec
          if (src >= dur - 0.0005) { if (!(v.loop || v.bus === 'video') || !Number.isFinite(span) || span <= 0.05) break; src = v.trimSec + ((src - v.trimSec) % span) }
          const left = Math.min((to - t) / 1000 * v.rate, dur - src)
          if (left <= 0.0005) break
          const mono = pr.channels === 1
          const pcm = await decode(p.ffmpeg, o.assets[v.assetId].path, src, left, v.rate, mono ? 1 : 2)
          const at0 = Math.round((t - a) / 1000 * SR)
          const at = (i: number) => at0 + i
          const ch = mono ? 1 : 2
          const frames = pcm.length / ch
          const pan = v.pan
          // Same pan law as the browser's StereoPanner: a mono file is placed with equal power (−3 dB at the centre); a stereo file passes through at the centre.
          const xm = (pan + 1) / 2, ml = Math.cos(xm * Math.PI / 2), mr = Math.sin(xm * Math.PI / 2)
          const xs = pan <= 0 ? pan + 1 : pan, gl = Math.cos(xs * Math.PI / 2), gr = Math.sin(xs * Math.PI / 2)
          for (let i = 0; i < frames && at(i) < n; i++) {
            const pos = (at(i)) / SR * 1000 + a - from
            const gi = pos / 20, i0 = Math.min(steps - 1, Math.max(0, Math.floor(gi))), i1 = Math.min(steps - 1, i0 + 1)
            const gain = gains[i0] + (gains[i1] - gains[i0]) * Math.min(1, Math.max(0, gi - i0))
            let l: number, r: number
            if (mono) { l = pcm[i] * ml; r = pcm[i] * mr }
            else { l = pcm[i * 2]; r = pcm[i * 2 + 1]; if (pan !== 0) { if (pan <= 0) { l = l + r * gl; r = r * gr } else { r = r + l * gr; l = l * gl } } }
            mix[at(i) * 2] += l * gain; mix[at(i) * 2 + 1] += r * gain
          }
          t += left / v.rate * 1000
        }
      }
      for (let i = 0; i < mix.length; i++) { const x = mix[i]; mix[i] = x > 1 ? 1 : x < -1 ? -1 : x }
      if (!enc.stdin!.write(Buffer.from(mix.buffer))) await new Promise<void>(r => enc.stdin!.once('drain', () => r()))
      o.onEvent?.({ phase: 'audio', doneMs: b - p.fromMs, totalMs: p.toMs - p.fromMs })
    }
    enc.stdin!.end(); await done
    await fs.rename(tmp, p.out)
  } catch (e) { enc.kill('SIGKILL'); await fs.rm(tmp, { force: true }).catch(() => undefined); throw e }
}

/** `seconds` of a file from `fromSec`, as 48 kHz stereo float, played at `rate` (the pitch follows the speed, like the player). */
async function decode(ffmpeg: string, file: string, fromSec: number, seconds: number, rate: number, channels: 1 | 2): Promise<Float32Array> {
  const af = `aresample=${SR}${rate !== 1 ? `,asetrate=${Math.round(SR * rate)},aresample=${SR}` : ''}`
  const { stdout } = await new Promise<{ stdout: Buffer }>((res, rej) => execFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', fromSec.toFixed(4), '-t', seconds.toFixed(4), '-i', file, '-vn', '-ac', String(channels), '-af', af, '-f', 'f32le', '-ar', String(SR), '-'],
    { encoding: 'buffer', maxBuffer: 1 << 29 }, (e, out) => (e ? rej(e) : res({ stdout: out }))))
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length - (stdout.length % (4 * channels))))
}
export { createWriteStream }
