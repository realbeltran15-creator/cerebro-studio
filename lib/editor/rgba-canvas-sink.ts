// Frame source for the fast exporter: decodes with Mediabunny's VideoSampleSink and copies each VideoFrame to RGBA with
// VideoFrame.copyTo + putImageData. Drawing a VideoFrame straight onto a canvas (what CanvasSink does) makes Chromium keep a
// converted image per frame until the GC runs: ≈500–690 MB native memory for 360 frames of 720p (measured, P5.21). This path
// measured +55 MB for the same frames and was ~1.7× faster. Rotated tracks are not handled here (caller falls back to CanvasSink).
type Sample = { timestamp: number; toVideoFrame(): VideoFrame; close(): void }
type SampleSinkLike = { samples(start?: number, end?: number): AsyncIterable<Sample> }
export type RgbaFrame = { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number }

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
  return new OffscreenCanvas(w, h)
}

export class RgbaCanvasSink {
  /** poolSize > 0 reuses that many canvases round-robin (the consumer must not hold more); 0 allocates one per frame. */
  constructor(private readonly samples: SampleSinkLike, private readonly poolSize = 0) {}

  async *canvases(start?: number, end?: number): AsyncGenerator<RgbaFrame, void, unknown> {
    const pool: Array<HTMLCanvasElement | OffscreenCanvas | undefined> = Array.from({ length: this.poolSize }, () => undefined)
    let next = 0, buf: Uint8ClampedArray | null = null, bw = 0, bh = 0
    for await (const s of this.samples.samples(start, end)) {
      const f = s.toVideoFrame()
      try {
        const w = f.visibleRect?.width ?? f.displayWidth, h = f.visibleRect?.height ?? f.displayHeight
        if (!buf || bw !== w || bh !== h) { buf = new Uint8ClampedArray(w * h * 4); bw = w; bh = h }
        await f.copyTo(buf, { format: 'RGBA' })
        let canvas = this.poolSize > 0 ? pool[next] : undefined
        if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = makeCanvas(w, h); if (this.poolSize > 0) pool[next] = canvas }
        if (this.poolSize > 0) next = (next + 1) % this.poolSize
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
        ctx.putImageData(new ImageData(buf as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
        yield { canvas, timestamp: s.timestamp }
      } finally { f.close(); s.close() }
    }
  }
}
