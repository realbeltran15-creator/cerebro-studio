import { AnalysisAbortError, analyzeSource, type AnalysisResult, type AnalysisSource, type AnalysisWants } from './media-analysis'

/**
 * Starts a media analysis in a Web Worker (the editor does not freeze on long videos) and falls back to the main thread, in small slices that give
 * the browser a turn every 20 ms, when workers are not available. Returns a cancel function; cancelling rejects with an AbortError.
 */
export type AnalysisHandle = { promise: Promise<AnalysisResult>; cancel: () => void }
export type ProgressFn = (fraction: number, stage: 'audio' | 'video') => void

export function startAnalysis(source: AnalysisSource, wants: AnalysisWants, onProgress?: ProgressFn): AnalysisHandle {
  const ctl = new AbortController()
  const mainThread = () => analyzeSource(source, wants, { onProgress, signal: ctl.signal, yieldEveryMs: 20 })
  let worker: Worker | null = null
  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    if (typeof Worker === 'undefined') { mainThread().then(resolve, reject); return }
    try { worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }) } catch { mainThread().then(resolve, reject); return }
    let started = false
    const w = worker
    w.onmessage = e => {
      started = true
      const m = e.data as { type: string; fraction?: number; stage?: 'audio' | 'video'; result?: AnalysisResult; aborted?: boolean; message?: string }
      if (m.type === 'progress') onProgress?.(m.fraction ?? 0, m.stage ?? 'audio')
      else if (m.type === 'done') { w.terminate(); resolve(m.result!) }
      else if (m.type === 'error') { w.terminate(); reject(m.aborted ? new AnalysisAbortError() : new Error(m.message)) }
    }
    // A worker that cannot even start (blocked by the browser or the host) must not leave the analysis hanging: do it on the main thread instead.
    w.onerror = ev => { ev.preventDefault?.(); w.terminate(); if (started || ctl.signal.aborted) reject(new Error('El análisis en segundo plano falló.')); else mainThread().then(resolve, reject) }
    w.postMessage({ type: 'run', source, wants })
  })
  return { promise, cancel: () => { ctl.abort(); worker?.postMessage({ type: 'cancel' }) } }
}
