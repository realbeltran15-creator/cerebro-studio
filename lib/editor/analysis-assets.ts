import { startAnalysis, type AnalysisHandle, type ProgressFn } from './analysis-client'
import type { AnalysisResult } from './media-analysis'
import { signedUrl } from './client'

/**
 * Waveform + beats of the audio assets used in the editor. An asset never changes once stored, so its analysis is kept: in memory for the session and
 * in IndexedDB (this browser only) so reopening the editor does not decode again. It reads the file through its signed URL with HTTP range requests
 * (only the parts needed), or downloads it when the host does not allow that.
 */
export type AssetAnalysis = Pick<AnalysisResult, 'durationMs' | 'waveform' | 'beats'>
const DB = 'cerebro-editor-analysis', STORE = 'assets', VERSION = 'v1'
const memory = new Map<string, Promise<AssetAnalysis>>()
const live = new Map<string, AnalysisHandle>()

const openDb = () => new Promise<IDBDatabase | null>(resolve => {
  try {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); r.onblocked = () => resolve(null)
  } catch { resolve(null) }
})
async function idbGet(key: string): Promise<AssetAnalysis | null> {
  const db = await openDb(); if (!db) return null
  return new Promise(resolve => { try { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => resolve((q.result as AssetAnalysis | undefined) ?? null); q.onerror = () => resolve(null) } catch { resolve(null) } })
}
async function idbPut(key: string, value: AssetAnalysis) {
  const db = await openDb(); if (!db) return
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key) } catch { /* storage full or blocked: the analysis still works, it is just not kept */ }
}

/** Only two analyses run at once; the rest wait their turn (a project can have dozens of audio clips). */
let running = 0
const waiting: Array<() => void> = []
const slot = async () => { if (running >= 2) await new Promise<void>(r => waiting.push(r)); running++ }
const release = () => { running--; waiting.shift()?.() }

export function analyzeAsset(assetId: string, onProgress?: ProgressFn): Promise<AssetAnalysis> {
  const key = `${assetId}:${VERSION}`
  const cached = memory.get(key)
  if (cached) return cached
  const p = (async () => {
    const stored = await idbGet(key)
    if (stored?.waveform) return stored
    await slot()
    try {
      const url = await signedUrl(assetId)
      const wants = { waveform: { bucketsPerSecond: 50 }, beats: true }
      let h = startAnalysis({ kind: 'url', url }, wants, onProgress)
      live.set(key, h)
      let result: AssetAnalysis
      try { result = await h.promise } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e
        // Range requests refused or blocked: download the file once and read it locally.
        const blob = await (await fetch(url)).blob()
        h = startAnalysis({ kind: 'blob', blob }, wants, onProgress); live.set(key, h)
        result = await h.promise
      }
      const slim = { durationMs: result.durationMs, waveform: result.waveform, beats: result.beats }
      void idbPut(key, slim)
      return slim
    } finally { live.delete(key); release() }
  })()
  memory.set(key, p)
  p.catch(() => memory.delete(key))   // a failed analysis may be tried again later
  return p
}

export function cancelAssetAnalysis(assetId: string) { live.get(`${assetId}:${VERSION}`)?.cancel() }
