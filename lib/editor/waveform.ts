/**
 * Real waveforms: the peak amplitude of the audio, measured from the decoded samples (never drawn from a pattern).
 * Streaming by design: decoded chunks are pushed one at a time, so a two-hour file never needs to be in memory as samples.
 * The result is one byte per bucket (0-255 of the loudest absolute sample in that bucket), cheap to keep and to ship from a Worker.
 */
export type Waveform = {
  bucketsPerSecond: number
  durationMs: number
  /** Loudest |sample| per bucket, 0-255 (255 = full scale). */
  peaks: Uint8Array
}

export class PeakBuilder {
  private readonly peaks: number[] = []
  private frame = 0
  constructor(private readonly sampleRate: number, readonly bucketsPerSecond = 50) {
    if (!(sampleRate > 0) || !(bucketsPerSecond > 0)) throw new Error('sampleRate and bucketsPerSecond must be positive')
  }
  /** One chunk of planar channels (all the same length). The loudest channel wins in each bucket, so a hard-panned sound still shows. */
  push(channels: Float32Array[]) {
    const n = channels[0]?.length ?? 0
    for (let i = 0; i < n; i++) {
      const b = Math.floor((this.frame + i) * this.bucketsPerSecond / this.sampleRate)
      let v = 0
      for (const ch of channels) { const a = Math.abs(ch[i]); if (a > v) v = a }
      if (b >= this.peaks.length) { while (this.peaks.length < b) this.peaks.push(0); this.peaks.push(v) } else if (v > this.peaks[b]) this.peaks[b] = v
    }
    this.frame += n
  }
  get seconds() { return this.frame / this.sampleRate }
  finish(): Waveform {
    const out = new Uint8Array(this.peaks.length)
    for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.round(this.peaks[i] * 255))
    return { bucketsPerSecond: this.bucketsPerSecond, durationMs: Math.round(this.seconds * 1000), peaks: out }
  }
}

/** Peaks of [fromMs, toMs) condensed to `columns` values 0..1 (the loudest bucket under each column). Empty ranges give zeros. */
export function waveformColumns(w: Waveform, fromMs: number, toMs: number, columns: number): number[] {
  const cols = Math.max(1, Math.floor(columns))
  const out = new Array<number>(cols).fill(0)
  if (toMs <= fromMs) return out
  const a = fromMs / 1000 * w.bucketsPerSecond, span = (toMs - fromMs) / 1000 * w.bucketsPerSecond
  for (let c = 0; c < cols; c++) {
    const lo = Math.max(0, Math.floor(a + span * c / cols)), hi = Math.min(w.peaks.length, Math.max(lo + 1, Math.ceil(a + span * (c + 1) / cols)))
    let m = 0
    for (let i = lo; i < hi; i++) if (w.peaks[i] > m) m = w.peaks[i]
    out[c] = m / 255
  }
  return out
}

/** Closed SVG path (mirrored around the middle line) for columns 0..1; `width` and `height` are the drawing box in px. */
export function waveformPath(cols: number[], width: number, height: number): string {
  if (!cols.length) return ''
  const mid = height / 2, step = width / cols.length
  const top = cols.map((v, i) => `${(i * step).toFixed(1)},${(mid - Math.max(0.5, v * mid)).toFixed(1)}`)
  const bottom = cols.map((v, i) => `${(i * step).toFixed(1)},${(mid + Math.max(0.5, v * mid)).toFixed(1)}`).reverse()
  return `M${top.join(' L')} L${bottom.join(' L')} Z`
}
