import { OnsetBuilder, detectBeats, type BeatResult } from './beats'
import { PeakBuilder, type Waveform } from './waveform'

/**
 * Local media analysis for the editor: waveform, beats, loudness and frame differences measured from the real file.
 * It STREAMS: the container is read in pieces and decoded chunk by chunk, so a two-hour video never sits in memory as samples or frames, and the work
 * can run inside a Web Worker (see analysis.worker.ts) while the editor stays responsive. Nothing is uploaded and nothing costs money.
 */
export type AnalysisSource = { kind: 'blob'; blob: Blob } | { kind: 'url'; url: string }
export type AnalysisWants = {
  waveform?: { bucketsPerSecond?: number }
  beats?: boolean
  rms?: { windowMs?: number }
  /** Mean frame-to-frame difference sampled at `fps` on small frames (for shot detection). */
  frames?: { fps: number }
}
export type AnalysisResult = {
  durationMs: number
  hasAudio: boolean
  hasVideo: boolean
  width: number | null
  height: number | null
  waveform?: Waveform
  beats?: BeatResult
  rms?: number[]
  rmsWindowMs?: number
  diffs?: number[]
  fps?: number
}
export type AnalysisOptions = {
  onProgress?: (fraction: number, stage: 'audio' | 'video') => void
  signal?: AbortSignal
  /** On the main thread, give the browser a turn at least this often (ms). 0 = never (inside a Worker). */
  yieldEveryMs?: number
}

export class AnalysisAbortError extends Error { constructor() { super('Análisis cancelado.'); this.name = 'AbortError' } }
export class AnalysisUnsupportedError extends Error {}

const tick = () => new Promise<void>(r => setTimeout(r, 0))

export async function analyzeSource(src: AnalysisSource, wants: AnalysisWants, opts: AnalysisOptions = {}): Promise<AnalysisResult> {
  const mb = await import('mediabunny')
  const input = new mb.Input({ source: src.kind === 'blob' ? new mb.BlobSource(src.blob) : new mb.UrlSource(src.url), formats: mb.ALL_FORMATS })
  const abort = () => { if (opts.signal?.aborted) throw new AnalysisAbortError() }
  let lastYield = performance.now()
  const breathe = async () => { abort(); if (opts.yieldEveryMs && performance.now() - lastYield >= opts.yieldEveryMs) { await tick(); lastYield = performance.now() } }
  try {
    abort()
    let audio = await input.getPrimaryAudioTrack().catch(() => null)
    const video = await input.getPrimaryVideoTrack().catch(() => null)
    if (!audio && !video) throw new AnalysisUnsupportedError('No se pudo leer ningún audio ni vídeo de este archivo en este navegador.')
    if (audio && !(await audio.canDecode().catch(() => false))) audio = null
    const seconds = await input.computeDuration().catch(() => 0)
    const out: AnalysisResult = { durationMs: Math.round(seconds * 1000), hasAudio: Boolean(audio), hasVideo: Boolean(video), width: video?.displayWidth ?? null, height: video?.displayHeight ?? null }

    if (audio && (wants.waveform || wants.beats || wants.rms)) {
      const sr = audio.sampleRate
      const peaks = wants.waveform ? new PeakBuilder(sr, wants.waveform.bucketsPerSecond ?? 50) : null
      const onsets = wants.beats ? new OnsetBuilder(sr) : null
      const winMs = wants.rms?.windowMs ?? 50, win = Math.max(1, Math.round(sr * winMs / 1000))
      const rms: number[] = []
      let acc = 0, accN = 0
      const sink = new mb.AudioSampleSink(audio)
      for await (const sample of sink.samples()) {
        try {
          const n = sample.numberOfFrames, chans: Float32Array[] = []
          for (let ch = 0; ch < sample.numberOfChannels; ch++) { const a = new Float32Array(n); sample.copyTo(a, { planeIndex: ch, format: 'f32-planar' }); chans.push(a) }
          peaks?.push(chans); onsets?.push(chans)
          if (wants.rms) for (let i = 0; i < n; i++) {
            let v = 0; for (const ch of chans) v += ch[i]
            v /= chans.length; acc += v * v
            if (++accN === win) { rms.push(Math.sqrt(acc / accN)); acc = 0; accN = 0 }
          }
        } finally { sample.close() }
        if (seconds > 0) opts.onProgress?.(Math.min(1, sample.timestamp / seconds), 'audio')
        await breathe()
      }
      if (accN > 0 && wants.rms) rms.push(Math.sqrt(acc / accN))
      if (peaks) out.waveform = peaks.finish()
      if (onsets) out.beats = detectBeats(onsets.finish())
      if (wants.rms) { out.rms = rms; out.rmsWindowMs = winMs }
      // The container's duration can be missing in some files: fall back to what was actually decoded.
      if (!out.durationMs && peaks) out.durationMs = out.waveform!.durationMs
    }

    if (video && wants.frames) {
      const fps = wants.frames.fps, step = 1 / fps, W = 64, H = 36
      const sink = new mb.CanvasSink(video, { width: W, height: H, fit: 'fill' })
      const diffs: number[] = []
      let prev: Uint8ClampedArray | null = null, next = 0
      for await (const wrapped of sink.canvases()) {
        if (wrapped.timestamp + 1e-6 < next) continue
        next = wrapped.timestamp + step
        const ctx = wrapped.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
        if (!ctx) throw new AnalysisUnsupportedError('Este navegador no permite leer los fotogramas del vídeo.')
        const px = ctx.getImageData(0, 0, W, H).data
        if (prev) { let d = 0; for (let k = 0; k < px.length; k += 4) d += Math.abs(px[k] - prev[k]) + Math.abs(px[k + 1] - prev[k + 1]) + Math.abs(px[k + 2] - prev[k + 2]); diffs.push(d / (px.length / 4) / 765) }
        prev = new Uint8ClampedArray(px)
        if (seconds > 0) opts.onProgress?.(Math.min(1, wrapped.timestamp / seconds), 'video')
        await breathe()
      }
      out.diffs = diffs; out.fps = fps
    }
    return out
  } finally { input.dispose() }
}
