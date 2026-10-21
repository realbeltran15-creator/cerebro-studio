import { AnalysisAbortError, analyzeSource, type AnalysisSource, type AnalysisWants } from './media-analysis'

/** Runs the media analysis off the main thread, so the editor stays responsive on long videos. One job at a time per worker. */
type InMsg = { type: 'run'; source: AnalysisSource; wants: AnalysisWants } | { type: 'cancel' }
const ctx = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<InMsg>) => void) | null }
let abort: AbortController | null = null

ctx.onmessage = async e => {
  const m = e.data
  if (m.type === 'cancel') { abort?.abort(); return }
  abort = new AbortController()
  let lastPct = -1
  try {
    const result = await analyzeSource(m.source, m.wants, {
      signal: abort.signal,
      onProgress: (f, stage) => { const pct = Math.floor(f * 100); if (pct !== lastPct) { lastPct = pct; ctx.postMessage({ type: 'progress', fraction: f, stage }) } },
    })
    ctx.postMessage({ type: 'done', result }, result.waveform ? [result.waveform.peaks.buffer as ArrayBuffer] : [])
  } catch (err) {
    ctx.postMessage({ type: 'error', aborted: err instanceof AnalysisAbortError, message: err instanceof Error ? err.message : 'No se pudo analizar el archivo.' })
  }
}
