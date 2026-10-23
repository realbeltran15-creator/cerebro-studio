/**
 * Real-time player for a montage: plays, pauses, seeks to any millisecond and steps frame by frame without rendering the whole video.
 * It draws with the same frame description (scene.ts) and the same canvas code (draw.ts) as the exporter, and mixes the same voices.
 *
 * Media is streamed, not downloaded: every visible clip gets its own <video> element pointed at a (signed) URL, and every sound its own
 * <audio> element, routed through Web Audio for volume automation, pan, ducking, track mute/solo and the mixer buses. Only what is
 * playing now or within the next second exists; the rest is released, so a 4-hour project costs the same memory as a 1-minute one.
 */
import { projectDurationMs, type Composition } from './composition'
import { drawOps, type DrawSource } from './draw'
import { audioTrackFactors, audioVoices, busLevels, frameAt, voiceGainAt, voiceWindows, type Bus, type KindOf, type Op, type VisualOp, type Voice } from './scene'
import { clipStarts } from './composition'

export type LoopRange = { startMs: number; endMs: number }
export type PlayerState = { playing: boolean; timeMs: number; durationMs: number; waiting: boolean; rate: number; volume: number; muted: boolean; loop: LoopRange | null }
export type PlayerInit = {
  canvas: HTMLCanvasElement
  /** Playable URL of an asset; `refresh` asks for a new one (an expired signed URL). */
  resolveUrl: (assetId: string, refresh?: boolean) => Promise<string>
  kindOf: KindOf
  /** speakers = preview; stream = export (nothing is heard; `stream` carries the mix). */
  output?: 'speakers' | 'stream'
  onTime?: (ms: number) => void
  onState?: (s: PlayerState) => void
  onError?: (message: string) => void
  frameRate?: number
}

type Slot = {
  el: HTMLMediaElement
  assetId: string
  gain: GainNode
  pan: StereoPannerNode | null
  node: MediaElementAudioSourceNode | null
  lastUsed: number
  bus: Bus
  failed: boolean
  retried: number
}

const LOOKAHEAD_MS = 1200
const EVICT_AFTER_MS = 15_000
const MAX_VIDEO_SLOTS = 12
const MAX_AUDIO_SLOTS = 24

export class EditorPlayer {
  private comp: Composition | null = null
  private starts: number[] = []
  private voices: Voice[] = []
  private windows: Array<{ start: number; end: number }> = []
  private factors = new Map<string, number>()
  private durationMs = 0
  private t = 0
  private playing = false
  private waiting = false
  private waitingSince = 0
  private rate = 1
  private volume = 1
  private muted = false
  private loopRange: LoopRange | null = null
  private anchorWall = 0
  private anchorT = 0
  private raf = 0
  private drawQueued = false
  private destroyed = false
  private exporting: { onFrame?: (t: number) => void; onStall?: (stalled: boolean) => void; done: () => void } | null = null
  private videos = new Map<string, Slot>()
  private audios = new Map<string, Slot>()
  private images = new Map<string, { bitmap: ImageBitmap | null; promise: Promise<void>; failed: boolean; lastUsed: number }>()
  private urls = new Map<string, Promise<string>>()
  readonly ctx: AudioContext
  private master: GainNode
  private monitor: GainNode | null = null
  private dest: MediaStreamAudioDestinationNode | null = null
  private buses: Record<Bus, GainNode>
  private g: CanvasRenderingContext2D
  private lastOps: Op[] = []
  private lastStateKey = ''

  constructor(private init: PlayerInit) {
    const g = init.canvas.getContext('2d')
    if (!g) throw new Error('El navegador no permite dibujar en canvas.')
    this.g = g
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    if (init.output === 'stream') { this.dest = this.ctx.createMediaStreamDestination(); this.master.connect(this.dest) }
    else { this.monitor = this.ctx.createGain(); this.master.connect(this.monitor); this.monitor.connect(this.ctx.destination) }
    this.buses = Object.fromEntries((['video', 'voice', 'music', 'sfx'] as const).map(k => { const n = this.ctx.createGain(); n.connect(this.master); return [k, n] })) as Record<Bus, GainNode>
  }

  /** The mix as a stream (export mode). */
  get stream() { return this.dest?.stream ?? null }
  get state(): PlayerState { return { playing: this.playing, timeMs: this.t, durationMs: this.durationMs, waiting: this.waiting, rate: this.rate, volume: this.volume, muted: this.muted, loop: this.loopRange } }
  get frameMs() { return 1000 / (this.init.frameRate ?? 30) }
  /** Size of the picture being drawn (the preview canvas). */
  get width() { return this.init.canvas.width }
  get height() { return this.init.canvas.height }

  setComposition(c: Composition) {
    this.comp = c
    this.starts = clipStarts(c)
    this.voices = audioVoices(c)
    this.windows = voiceWindows(this.voices)
    this.factors = audioTrackFactors(c)
    this.durationMs = projectDurationMs(c)
    const levels = busLevels(c)
    for (const k of Object.keys(this.buses) as Bus[]) this.buses[k].gain.setTargetAtTime(levels[k], this.ctx.currentTime, 0.02)
    if (this.t > this.durationMs) this.t = this.durationMs
    if (!this.playing) this.requestDraw()
    this.emitState()
  }

  // ---------- Transport ----------
  play() {
    if (!this.comp || this.destroyed) return
    void this.ctx.resume().catch(() => undefined)
    if (this.t >= this.durationMs - 1) this.t = this.loopRange?.startMs ?? 0
    this.playing = true
    this.anchorWall = performance.now(); this.anchorT = this.t
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
    this.emitState()
  }
  pause() {
    if (!this.playing) return
    this.t = this.clock()
    this.playing = false
    this.waiting = false
    cancelAnimationFrame(this.raf)
    this.pauseAll()
    this.requestDraw()
    this.emitState()
  }
  toggle() { if (this.playing) this.pause(); else this.play() }
  stop() { this.pause(); this.seek(this.loopRange?.startMs ?? 0) }
  seek(ms: number) {
    this.t = Math.max(0, Math.min(Number.isFinite(ms) ? ms : 0, this.durationMs))
    if (this.playing) { this.anchorWall = performance.now(); this.anchorT = this.t; this.resyncAll() }
    else this.requestDraw()
    this.init.onTime?.(this.t)
    this.emitState()
  }
  skip(deltaMs: number) { this.seek(this.clock() + deltaMs) }
  /** One frame forward or back (pauses first). */
  step(frames: number) { if (this.playing) this.pause(); this.seek(Math.round((this.t + frames * this.frameMs) / this.frameMs) * this.frameMs) }
  setRate(r: number) {
    const now = this.clock()
    this.rate = Math.min(4, Math.max(0.25, r))
    this.anchorWall = performance.now(); this.anchorT = now
    if (this.playing) this.resyncAll()
    this.emitState()
  }
  setVolume(v: number) { this.volume = Math.min(1, Math.max(0, v)); this.applyMonitor(); this.emitState() }
  setMuted(m: boolean) { this.muted = m; this.applyMonitor(); this.emitState() }
  setLoop(r: LoopRange | null) { this.loopRange = r && r.endMs - r.startMs >= 100 ? r : null; this.emitState() }
  private applyMonitor() { this.monitor?.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02) }

  /**
   * Plays the whole montage once from the start at normal speed, for recording. Resolves at the end (or when aborted).
   * While a clip is still loading the clock stops and `onStall(true)` lets the recorder pause, so the file never skips or desyncs.
   */
  async playForExport(opts: { onFrame?: (t: number) => void; onStall?: (stalled: boolean) => void; signal?: AbortSignal }) {
    if (!this.comp) return
    this.rate = 1; this.loopRange = null
    this.seek(0)
    await this.preload(0)
    await new Promise<void>(resolve => {
      const done = () => { this.exporting = null; resolve() }
      this.exporting = { onFrame: opts.onFrame, onStall: opts.onStall, done }
      opts.signal?.addEventListener('abort', () => { this.pause(); done() }, { once: true })
      if (opts.signal?.aborted) { done(); return }
      this.play()
    })
  }

  /** Waits until the media needed at `t` can be drawn (used before export and by tests). */
  async preload(t: number, timeoutMs = 20_000) {
    const until = performance.now() + timeoutMs
    for (;;) {
      if (!this.comp) return
      const ops = frameAt(this.comp, t, this.init.kindOf, this.starts)
      const missing = this.prepare(ops, t, false)
      if (!missing) return
      if (performance.now() > until) throw new Error('Un recurso del montaje no se pudo cargar a tiempo.')
      await new Promise(r => setTimeout(r, 50))
    }
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    for (const s of [...this.videos.values(), ...this.audios.values()]) this.release(s)
    this.videos.clear(); this.audios.clear()
    for (const im of this.images.values()) im.bitmap?.close()
    this.images.clear()
    void this.ctx.close().catch(() => undefined)
  }

  // ---------- Clock and frame loop ----------
  private clock() {
    if (!this.playing || this.waiting) return this.t
    return this.anchorT + (performance.now() - this.anchorWall) * this.rate
  }

  private tick = () => {
    if (!this.playing || this.destroyed || !this.comp) return
    let t = this.clock()
    const end = this.loopRange && !this.exporting ? this.loopRange.endMs : this.durationMs
    if (t >= end) {
      if (this.loopRange && !this.exporting) { t = this.loopRange.startMs; this.t = t; this.anchorWall = performance.now(); this.anchorT = t; this.resyncAll() }
      else {
        this.t = this.durationMs
        this.draw(frameAt(this.comp, Math.max(0, this.durationMs - 1), this.init.kindOf, this.starts))
        this.init.onTime?.(this.t)
        const ex = this.exporting
        this.pause()
        ex?.done()
        return
      }
    }
    this.t = t
    const ops = frameAt(this.comp, t, this.init.kindOf, this.starts)
    let missing = this.prepare(ops, t, true)
    // The preview never hangs on a slow file: after a few seconds it plays on without it. The export waits longer, then fails clearly.
    if (missing && this.waiting && performance.now() - this.waitingSince > (this.exporting ? 30_000 : 4000)) {
      if (this.exporting) { this.init.onError?.('Un archivo del montaje no carga: revisa tu conexión o vuelve a vincularlo.'); const ex = this.exporting; this.pause(); ex.done(); return }
      missing = false
    }
    if (missing && !this.waiting) {
      this.waitingSince = performance.now()
      // Freeze: nothing advances until the media is there.
      this.waiting = true
      this.pauseAll()
      this.exporting?.onStall?.(true)
      this.emitState()
    } else if (!missing && this.waiting) {
      this.waiting = false
      this.anchorWall = performance.now(); this.anchorT = t
      this.exporting?.onStall?.(false)
      this.emitState()
    }
    if (!this.waiting) {
      this.syncAudio(t)
      this.draw(ops)
      this.exporting?.onFrame?.(t)
    }
    this.init.onTime?.(t)
    this.evict()
    this.raf = requestAnimationFrame(this.tick)
  }

  private requestDraw() {
    if (this.drawQueued || this.destroyed) return
    this.drawQueued = true
    requestAnimationFrame(() => {
      this.drawQueued = false
      if (!this.comp || this.playing) return
      const ops = frameAt(this.comp, Math.min(this.t, Math.max(0, this.durationMs - 1)), this.init.kindOf, this.starts)
      const missing = this.prepare(ops, this.t, false)
      this.waiting = missing
      // Paused at the very start, a montage that opens with a fade from black would show a black viewer: the still shown there is the
      // first picture (playing and exporting still start from black).
      this.draw(this.t < 1 ? ops.filter((o, i) => !(i > 0 && o.type === 'fill' && o.alpha > 0.99)) : ops)
      this.emitState()
    })
  }

  private draw(ops: Op[]) {
    const { width, height } = this.init.canvas
    this.lastOps = ops
    drawOps(this.g, ops, width, height, op => this.sourceOf(op))
  }

  /** The ops of the frame on screen (for the viewer's handles). */
  get currentOps() { return this.lastOps }
  /** Natural size of a layer's picture, when known. */
  sourceSize(op: VisualOp) { const s = this.sourceOf(op); return s ? { width: s.width, height: s.height } : null }

  private sourceOf(op: VisualOp): DrawSource | null {
    if (op.media === 'image') {
      const im = this.images.get(op.assetId)
      return im?.bitmap ? { src: im.bitmap, width: im.bitmap.width, height: im.bitmap.height } : null
    }
    const s = this.videos.get(op.slot)
    const v = s?.el as HTMLVideoElement | undefined
    if (!v || v.readyState < 2 || !v.videoWidth) return null
    return { src: v, width: v.videoWidth, height: v.videoHeight }
  }

  // ---------- Media ----------
  private url(assetId: string, refresh = false) {
    if (refresh || !this.urls.has(assetId)) this.urls.set(assetId, this.init.resolveUrl(assetId, refresh))
    return this.urls.get(assetId)!
  }

  /** Makes sure every layer at `t` (and what comes next) has its media; positions videos. Returns true when something is not ready yet. */
  private prepare(ops: Op[], t: number, live: boolean): boolean {
    let missing = false
    const now = performance.now()
    const active = new Set<string>()
    for (const op of ops) {
      if (op.type !== 'visual') continue
      if (op.media === 'image') { if (!this.image(op.assetId)) missing = true; continue }
      active.add(op.slot)
      const s = this.videoSlot(op)
      s.lastUsed = now
      if (s.failed) continue
      const v = s.el as HTMLVideoElement
      if (v.readyState < 1) { missing = true; continue }
      let want = op.sourceMs / 1000
      // A clip longer than what is left of its source loops back to where it starts (as the exporter always did).
      if (Number.isFinite(v.duration) && v.duration > 0 && want >= v.duration - 0.04) { const trim = this.trimOf(op); const span = Math.max(0.1, v.duration - trim); want = trim + ((want - trim) % span) }
      const playNow = live && op.live && this.playing
      const level = playNow ? op.volume * (this.factors.get(op.trackId) ?? 1) : 0
      s.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.015)
      if (playNow) {
        const rate = op.rate * this.rate
        if (Math.abs(v.playbackRate - rate) > 0.001) v.playbackRate = rate
        const tol = 0.25 * Math.max(1, rate)
        if (v.paused) { if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want; void v.play().catch(() => undefined) }
        else if (Math.abs(v.currentTime - want) > tol) v.currentTime = want
        if (v.seeking || v.readyState < 2) missing = true
      } else {
        if (!v.paused) v.pause()
        if (Math.abs(v.currentTime - want) > 0.5 / (this.init.frameRate ?? 30)) { v.currentTime = want; missing = true }
        else if (v.seeking || v.readyState < 2) missing = true
      }
    }
    // Videos not on screen any more stop (and are released later).
    for (const [slot, s] of this.videos) if (!active.has(slot) && !(s.el as HTMLVideoElement).paused) { s.el.pause(); s.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01) }
    // Prepare what comes next: the layers one second ahead are created and positioned on their first frame.
    if (this.comp) {
      const ahead = frameAt(this.comp, Math.min(this.durationMs - 1, t + LOOKAHEAD_MS * this.rate), this.init.kindOf, this.starts)
      for (const op of ahead) {
        if (op.type !== 'visual') continue
        if (op.media === 'image') { this.image(op.assetId); continue }
        if (active.has(op.slot)) continue
        const s = this.videoSlot(op)
        s.lastUsed = now
        const v = s.el as HTMLVideoElement
        const startAt = Math.max(0, (op.sourceMs - LOOKAHEAD_MS * op.rate * this.rate) / 1000)
        if (v.readyState >= 1 && v.paused && !v.seeking && Math.abs(v.currentTime - startAt) > 0.3) v.currentTime = startAt
      }
    }
    // Sounds about to start are loaded too.
    if (!live) return missing
    for (const voice of this.voices) {
      if (voice.startMs > t && voice.startMs - t < LOOKAHEAD_MS * 1.5 * this.rate) this.audioSlot(voice).lastUsed = now
    }
    return missing || this.audioMissing(t)
  }

  private trimOf(op: VisualOp) {
    const c = this.comp
    if (!c) return 0
    if (op.slot.startsWith('ov:')) return ((c.overlays ?? []).find(o => `ov:${o.id}` === op.slot)?.trimInMs ?? 0) / 1000
    return ((c.clips.find(k => k.id === op.slot)?.trimInMs) ?? 0) / 1000
  }

  private audioMissing(t: number) {
    for (const v of this.voices) {
      if (t < v.startMs || t >= v.endMs) continue
      const s = this.audios.get(v.key)
      if (!s || s.failed) continue
      if (s.el.readyState < 2 || s.el.seeking) return true
    }
    return false
  }

  private image(assetId: string): boolean {
    let im = this.images.get(assetId)
    if (!im) {
      const entry = { bitmap: null as ImageBitmap | null, failed: false, lastUsed: performance.now(), promise: Promise.resolve() }
      entry.promise = (async () => {
        try {
          const r = await fetch(await this.url(assetId), { cache: 'force-cache' })
          if (!r.ok) throw new Error(String(r.status))
          entry.bitmap = await createImageBitmap(await r.blob())
        } catch { entry.failed = true; this.init.onError?.('Una imagen del montaje no se pudo cargar.') }
        if (!this.playing) this.requestDraw()
      })()
      this.images.set(assetId, entry)
      im = entry
    }
    im.lastUsed = performance.now()
    return !!im.bitmap || im.failed
  }

  private makeSlot(el: HTMLMediaElement, assetId: string, bus: Bus, withPan: boolean): Slot {
    el.preload = 'auto'
    ;(el as HTMLVideoElement).playsInline = true
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    const pan = withPan && typeof this.ctx.createStereoPanner === 'function' ? this.ctx.createStereoPanner() : null
    const slot: Slot = { el, assetId, gain, pan, node: null, lastUsed: performance.now(), bus, failed: false, retried: 0 }
    if (pan) { gain.connect(pan); pan.connect(this.buses[bus]) } else gain.connect(this.buses[bus])
    void this.url(assetId).then(u => {
      if (this.destroyed) return
      if (/^https?:/.test(u)) el.crossOrigin = 'anonymous'
      el.src = u
      try { slot.node = this.ctx.createMediaElementSource(el); slot.node.connect(gain) } catch { /* already connected */ }
    }, () => { slot.failed = true; this.init.onError?.('No se pudo acceder a un archivo del montaje.') })
    el.addEventListener('error', () => {
      // An expired signed URL: ask for a new one once and continue where it was.
      if (slot.retried < 2 && !this.destroyed) {
        slot.retried++
        const at = el.currentTime
        void this.url(assetId, true).then(u => { el.src = u; el.currentTime = at }, () => { slot.failed = true })
      } else { slot.failed = true; this.init.onError?.('Un archivo del montaje no se puede reproducir (¿falta o está dañado?).') }
    })
    // Files recorded by browsers (WebM) often say «duration: Infinity»; asking for the end makes the browser measure it.
    el.addEventListener('loadedmetadata', () => {
      if (el.duration === Infinity) {
        const back = el.currentTime
        const fix = () => { if (Number.isFinite(el.duration)) { el.removeEventListener('durationchange', fix); el.currentTime = back } }
        el.addEventListener('durationchange', fix)
        el.currentTime = 1e9
      }
    })
    const redraw = () => { if (!this.playing) this.requestDraw() }
    el.addEventListener('seeked', redraw)
    el.addEventListener('loadeddata', redraw)
    return slot
  }

  private videoSlot(op: VisualOp): Slot {
    let s = this.videos.get(op.slot)
    if (s && s.assetId !== op.assetId) { this.release(s); this.videos.delete(op.slot); s = undefined }
    if (!s) {
      s = this.makeSlot(document.createElement('video'), op.assetId, 'video', false)
      ;(s.el as HTMLVideoElement).muted = false
      this.videos.set(op.slot, s)
    }
    return s
  }

  private audioSlot(v: Voice): Slot {
    let s = this.audios.get(v.key)
    if (s && s.assetId !== v.assetId) { this.release(s); this.audios.delete(v.key); s = undefined }
    if (!s) {
      s = this.makeSlot(document.createElement('audio'), v.assetId, v.bus, true)
      this.audios.set(v.key, s)
      const at = v.sourceStartMs / 1000
      s.el.addEventListener('loadedmetadata', () => { if (s!.el.paused && s!.el.currentTime === 0 && at > 0) s!.el.currentTime = at }, { once: true })
    }
    if (s.pan && Math.abs(s.pan.pan.value - v.pan) > 0.001) s.pan.pan.value = v.pan
    return s
  }

  private syncAudio(t: number) {
    const now = this.ctx.currentTime
    const live = new Set<string>()
    for (const v of this.voices) {
      if (t < v.startMs || t >= v.endMs) continue
      const s = this.audioSlot(v)
      s.lastUsed = performance.now()
      if (s.failed || s.el.readyState < 1) continue
      live.add(v.key)
      let want = (v.sourceStartMs + (t - v.startMs)) / 1000
      const d = s.el.duration
      if (Number.isFinite(d) && d > 0) {
        if (v.loop) want = want % d
        else if (want >= d) { if (!s.el.paused) s.el.pause(); continue }
      }
      const level = voiceGainAt(v, t, this.windows, this.durationMs) * (this.factors.get(v.trackId) ?? 1)
      const cur = s.gain.gain.value
      s.gain.gain.setTargetAtTime(level, now, level < cur ? 0.03 : 0.06)
      const rate = this.rate
      if (Math.abs(s.el.playbackRate - rate) > 0.001) s.el.playbackRate = rate
      if (s.el.paused) { if (Math.abs(s.el.currentTime - want) > 0.03) s.el.currentTime = want; void s.el.play().catch(() => undefined) }
      else if (Math.abs(s.el.currentTime - want) > 0.2 * Math.max(1, rate)) s.el.currentTime = want
    }
    for (const [key, s] of this.audios) if (!live.has(key) && !s.el.paused) { s.el.pause(); s.gain.gain.setTargetAtTime(0, now, 0.01) }
  }

  private pauseAll() {
    for (const s of [...this.videos.values(), ...this.audios.values()]) { if (!s.el.paused) s.el.pause(); s.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01) }
  }

  private resyncAll() {
    // Positions are corrected on the next tick; pausing first avoids a burst of the old position.
    for (const s of this.audios.values()) if (!s.el.paused) s.el.pause()
  }

  private release(s: Slot) {
    try { s.el.pause(); s.el.removeAttribute('src'); s.el.load() } catch { /* ignore */ }
    try { s.node?.disconnect(); s.gain.disconnect(); s.pan?.disconnect() } catch { /* ignore */ }
  }

  private evictedAt = 0
  private evict() {
    const now = performance.now()
    if (now - this.evictedAt < 1000) return
    this.evictedAt = now
    const drop = (map: Map<string, Slot>, max: number) => {
      const old = [...map.entries()].filter(([, s]) => s.el.paused && now - s.lastUsed > EVICT_AFTER_MS)
      const extra = [...map.entries()].filter(([, s]) => s.el.paused).sort((a, b) => a[1].lastUsed - b[1].lastUsed).slice(0, Math.max(0, map.size - max))
      for (const [k, s] of [...old, ...extra]) { if (map.has(k)) { this.release(s); map.delete(k) } }
    }
    drop(this.videos, MAX_VIDEO_SLOTS); drop(this.audios, MAX_AUDIO_SLOTS)
    for (const [k, im] of this.images) if (now - im.lastUsed > 60_000 && this.images.size > 40) { im.bitmap?.close(); this.images.delete(k) }
  }

  private emitState() {
    const s = this.state
    const key = `${s.playing}|${s.waiting}|${s.rate}|${s.volume}|${s.muted}|${s.durationMs}|${s.loop?.startMs}|${s.loop?.endMs}|${this.playing ? '' : Math.round(s.timeMs)}`
    if (key === this.lastStateKey) return
    this.lastStateKey = key
    this.init.onState?.(s)
  }
}

/** URLs for media already in memory (tests, and exporting files that were just downloaded). */
export function blobResolver(media: Map<string, { blob: Blob }>) {
  const made = new Map<string, string>()
  const resolve = async (id: string) => {
    if (!made.has(id)) { const m = media.get(id); if (!m) throw new Error('missing'); made.set(id, URL.createObjectURL(m.blob)) }
    return made.get(id)!
  }
  return { resolve, revoke: () => { for (const u of made.values()) URL.revokeObjectURL(u); made.clear() } }
}
