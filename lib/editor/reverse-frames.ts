/**
 * Reverse frame reader: serves the frames of a video backwards without ever holding the whole video in memory.
 *
 * Video codecs only decode forwards (a frame depends on earlier ones), so going backwards is done in WINDOWS: decode a short stretch
 * [start, end) forwards from its keyframe, keep only that stretch's frames, hand them out from the last to the first, and when the playhead
 * leaves the window decode the stretch just before it (the old window is dropped). Memory is bounded by the window size
 * (`maxFrames`, derived from a byte budget), however long the video or the clip is. Used by the preview player and the exporter, so what
 * is shown is what is exported.
 */
export type RevFrame = { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number }
/** The part of a mediabunny CanvasSink the reader uses (a fake in tests). */
export type FrameSink = { canvases(start?: number, end?: number): AsyncIterable<RevFrame> }

type Win = { from: number; to: number; frames: RevFrame[] }

/** How many frames fit a byte budget (never fewer than 6, so a window always spans a few frames; never more than 90). */
export const framesForBudget = (width: number, height: number, budgetBytes: number) => Math.min(90, Math.max(6, Math.floor(budgetBytes / Math.max(1, width * height * 4))))

export class ReverseFrameReader {
  private win: Win | null = null
  private next: Win | null = null
  private loading: Promise<Win> | null = null
  private loadingTo = Infinity
  private closed = false
  /** Windows decoded so far and frames decoded in total (diagnostics: shows the cost of going backwards). */
  stats = { windows: 0, framesDecoded: 0, peakFrames: 0 }

  /** `forward`: the playhead walks forwards through the source (variable speed ramps): windows are loaded ahead instead of behind. */
  constructor(private sink: FrameSink, private fps: number, private maxFrames: number, private lookahead = true, private forward = false) {}

  private span() { return this.maxFrames / Math.max(1, this.fps) }

  private find(w: Win | null, ts: number): RevFrame | null {
    if (!w || ts < w.from || ts >= w.to || !w.frames.length) return null
    // Last frame whose start is <= ts.
    let lo = 0, hi = w.frames.length - 1, ans = -1
    while (lo <= hi) { const m = (lo + hi) >> 1; if (w.frames[m].timestamp <= ts) { ans = m; lo = m + 1 } else hi = m - 1 }
    return ans >= 0 ? w.frames[ans] : w.frames[0]
  }

  /** The frame shown at `ts` (seconds) if it is already decoded, else null. Also keeps the window just before it on its way. */
  peek(ts: number): RevFrame | null {
    let f = this.find(this.win, ts)
    if (!f) { f = this.find(this.next, ts); if (f) { this.win = this.next; this.next = null } }
    if (f && this.lookahead && this.win) {
      if (this.forward) { if (ts > this.win.from + this.span() * 0.5) this.prefetchForward(this.win.to) }
      else if (ts < this.win.from + this.span() * 0.5) this.prefetch(this.win.from)
    }
    return f
  }

  /** Starts decoding the window that ends at `to` in the background (no-op when one is already there or on its way). */
  private prefetch(to: number) {
    if (this.closed || to <= 0 || this.next?.to === to || this.loadingTo <= to + 1e-6 && this.loading) return
    void this.load(to + 1 / Math.max(1, this.fps)).then(w => { if (!this.closed) this.next = w }, () => undefined)
  }

  /** Starts decoding the window that begins at `from` (forward mode). */
  private prefetchForward(from: number) {
    if (this.closed || this.next?.from != null && Math.abs(this.next.from - (from - 1 / Math.max(1, this.fps))) < 1e-6 || this.loading) return
    const start = Math.max(0, from - 1 / Math.max(1, this.fps))
    void this.load(start + this.span(), start).then(w => { if (!this.closed) this.next = w }, () => undefined)
  }

  private load(to: number, startAt?: number): Promise<Win> {
    const start = startAt ?? Math.max(0, to - this.span())
    this.loadingTo = to
    const p = (async () => {
      const frames: RevFrame[] = []
      for await (const f of this.sink.canvases(start, to)) {
        if (this.closed) break
        frames.push(f)
        this.stats.framesDecoded++
      }
      this.stats.windows++
      this.stats.peakFrames = Math.max(this.stats.peakFrames, frames.length)
      return { from: start, to, frames } as Win
    })()
    this.loading = p
    void p.finally(() => { if (this.loading === p) { this.loading = null; this.loadingTo = Infinity } })
    return p
  }

  /** The frame shown at `ts` (seconds); decodes the window that holds it when needed. */
  async get(ts: number): Promise<RevFrame | null> {
    const hit = this.peek(ts)
    if (hit) return hit
    // If a window ending at/after ts is on its way, wait for it; otherwise start one that covers ts.
    if (this.forward) {
      const start = Math.max(0, ts - 1 / Math.max(1, this.fps))
      const covering = this.loading && this.loadingTo - this.span() <= ts + 1e-6 && this.loadingTo > ts + 1e-6
      const w = covering ? await this.loading! : await this.load(start + this.span(), start)
      if (this.closed) return null
      this.win = w
      const f = this.find(w, ts)
      if (f && this.lookahead && ts > w.from + this.span() * 0.5) this.prefetchForward(w.to)
      return f
    }
    const end = ts + 2 / Math.max(1, this.fps)
    const w = this.loading && this.loadingTo >= end - 1e-6 && this.loadingTo - this.span() <= ts ? await this.loading : await this.load(end)
    if (this.closed) return null
    this.win = w
    const f = this.find(w, ts)
    if (f && this.lookahead && ts < w.from + this.span() * 0.5) this.prefetch(w.from)
    return f
  }

  close() { this.closed = true; this.win = null; this.next = null }
}
