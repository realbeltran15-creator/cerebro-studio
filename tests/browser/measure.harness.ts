/** Measurement harness: the editor's own player and fast exporter, driven from the page so a Node script can sample memory, traffic and disk. */
import { EditorPlayer } from '@/lib/editor/player'
import { fastExport } from '@/lib/editor/fast-export'
import { parseComposition } from '@/lib/editor/composition'
import { saveLocalDraft, saveLocalHistory } from '@/lib/editor/local-draft'
import type { KindOf } from '@/lib/editor/scene'
import { openDriveSink } from '@/lib/ingest/drive-stream'
import { uploadToDrive } from '@/lib/ingest/drive-upload'

type Manifest = Record<string, { kind: 'image' | 'video' | 'audio'; url: string }>
declare global { interface Window { M: Record<string, (...a: never[]) => unknown> } }
let player: EditorPlayer | null = null
let manifest: Manifest = {}
const kindOf: KindOf = id => manifest[id]?.kind ?? null
const resolveUrl = async (id: string) => manifest[id].url
const heap = () => { const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory; return m ? m.usedJSHeapSize : -1 }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))


const toLocalDrive = ((url: string, init?: RequestInit) => fetch(String(url).replace('https://www.googleapis.com', ''), init)) as typeof fetch
/** Browser storage in use by this site (what navigator.storage.estimate() reports) sampled while `fn` runs: the peak above the starting point. */
async function withStorageProbe<T>(fn: () => Promise<T>) {
  const base = (await navigator.storage.estimate()).usage ?? 0
  let peak = 0, peakHeap = 0, stop = false
  const loop = (async () => { while (!stop) { const u = (await navigator.storage.estimate()).usage ?? 0; peak = Math.max(peak, u - base); peakHeap = Math.max(peakHeap, heap()); await sleep(150) } })()
  const value = await fn()
  stop = true; await loop
  const end = (await navigator.storage.estimate()).usage ?? 0
  return { value, peakStorageAboveBase: peak, peakHeap, storageAfterAboveBase: end - base }
}
async function opfsTempBytes() {
  const root = await navigator.storage.getDirectory(); let n = 0
  for await (const [, h] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) if (h.kind === 'file') n += (await (h as FileSystemFileHandle).getFile()).size
  return n
}

window.M = {
  open: (async (m: Manifest, raw: unknown) => {
    manifest = m
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540; document.body.appendChild(canvas)
    player = new EditorPlayer({ canvas, resolveUrl, kindOf, output: 'speakers' })
    const t0 = performance.now()
    player.setComposition(parseComposition(raw)!)
    await player.preload(0)
    return { ms: Math.round(performance.now() - t0), heap: heap() }
  }) as never,
  seek: (async (t: number) => { const t0 = performance.now(); player!.seek(t); await player!.preload(t); return { ms: Math.round(performance.now() - t0), heap: heap() } }) as never,
  play: (async (ms: number) => { player!.play(); await sleep(ms); const s = player!.state; player!.pause(); return { t: Math.round(s.timeMs), waiting: s.waiting, heap: heap() } }) as never,
  heap: (() => heap()) as never,
  idb: (async (raw: unknown) => {
    const c = parseComposition(raw)!
    const before = (await navigator.storage.estimate()).usage ?? 0
    await saveLocalDraft({ jobId: 'measure', composition: c, savedAt: new Date().toISOString(), baseUpdatedAt: null })
    await saveLocalHistory({ jobId: 'measure', past: Array.from({ length: 30 }, () => c), future: [], present: c })
    const after = (await navigator.storage.estimate()).usage ?? 0
    return { json: JSON.stringify(c).length, before, after }
  }) as never,
  /** Same export, written progressively to a file in the origin-private file system (same writable API as a file chosen with showSaveFilePicker). */
  exportToFile: (async (m: Manifest, raw: unknown, name: string) => {
    manifest = m
    const peak = { heap: 0 }
    const timer = setInterval(() => { peak.heap = Math.max(peak.heap, heap()) }, 200)
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(name, { create: true })
    const w = await handle.createWritable()
    const t0 = performance.now()
    const res = await fastExport({ composition: parseComposition(raw)!, resolveUrl, kindOf, canvas: document.createElement('canvas'), sink: w as never })
    clearInterval(timer)
    const f = await handle.getFile()
    return { seconds: (performance.now() - t0) / 1000, bytes: res.bytes, fileSize: f.size, mime: res.mimeType, peakHeap: peak.heap, blobNull: res.blob === null }
  }) as never,
  /** Full disk: the destination refuses writes after `limit` bytes (QuotaExceededError). The export must fail cleanly and commit nothing. */
  exportQuota: (async (m: Manifest, raw: unknown, name: string, limit: number) => {
    manifest = m
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(name, { create: true })
    const real = await handle.createWritable()
    let written = 0
    const sink = new WritableStream({
      write: async (chunk: { data: Uint8Array; position: number }) => { written += chunk.data.byteLength; if (written > limit) throw new DOMException('No space left', 'QuotaExceededError'); await real.write(chunk as never) },
      close: () => real.close(), abort: r => real.abort(r),
    })
    let error = ''
    try { await fastExport({ composition: parseComposition(raw)!, resolveUrl, kindOf, canvas: document.createElement('canvas'), sink: sink as never }) } catch (e) { error = (e as Error).name }
    const f = await handle.getFile()
    return { error, committedBytes: f.size, writtenBeforeFailure: written }
  }) as never,
  /** Aborted export: the writable is discarded; reports whether a file was left behind. */
  exportAbort: (async (m: Manifest, raw: unknown, name: string) => {
    manifest = m
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(name, { create: true })
    const w = await handle.createWritable()
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 1500)
    let error = ''
    try { await fastExport({ composition: parseComposition(raw)!, resolveUrl, kindOf, canvas: document.createElement('canvas'), sink: w as never, signal: ac.signal }) } catch (e) { error = (e as Error).name }
    const f = await handle.getFile()
    return { error, sizeAfterAbort: f.size }
  }) as never,
  /** Fragmented MP4 sent to the (simulated) Drive WHILE it is rendered: no temporary file anywhere. */
  exportToDriveDirect: (async (m: Manifest, raw: unknown, fps?: number) => {
    manifest = m
    const t0 = performance.now()
    const probe = await withStorageProbe(async () => {
      const sink = await openDriveSink({ name: 'direct.mp4', mimeType: 'video/mp4', token: 'test', folderId: 'F', fetchImpl: toLocalDrive })
      const res = await fastExport({ composition: parseComposition(raw)!, resolveUrl, kindOf, canvas: document.createElement('canvas'), sink: sink.writable as never, fragmented: true, fps, testMp4Vp9: true })
      const up = await sink.result
      return { res, up, stats: sink.stats() }
    })
    const { res, up, stats } = probe.value
    return { seconds: (performance.now() - t0) / 1000, bytes: res.bytes, uploaded: up.size, peakStorageAboveBase: probe.peakStorageAboveBase, storageAfterAboveBase: probe.storageAfterAboveBase, opfsLeft: await opfsTempBytes(), peakHeap: probe.peakHeap, peakBuffered: stats.peakBufferedBytes, blocks: stats.blocks, retries: stats.retries, encoded: res.encoded }
  }) as never,
  /** The previous way: whole file to a temporary file of this browser (origin-private storage), then uploaded from it, then deleted. */
  exportToDriveViaTemp: (async (m: Manifest, raw: unknown) => {
    manifest = m
    const t0 = performance.now()
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle('cerebro-export-measure.mp4', { create: true })
    let tempPeak = 0
    const probe = await withStorageProbe(async () => {
      const w = await handle.createWritable()
      const res = await fastExport({ composition: parseComposition(raw)!, resolveUrl, kindOf, canvas: document.createElement('canvas'), sink: w as never, testMp4Vp9: true })
      tempPeak = (await handle.getFile()).size
      const up = await uploadToDrive(await handle.getFile(), { name: 'viatemp.mp4', mimeType: 'video/mp4', token: 'test', folderId: 'F', fetchImpl: toLocalDrive })
      await root.removeEntry('cerebro-export-measure.mp4')
      return { res, up }
    })
    return { seconds: (performance.now() - t0) / 1000, bytes: probe.value.res.bytes, uploaded: probe.value.up.size, tempFilePeakBytes: tempPeak, peakStorageAboveBase: probe.peakStorageAboveBase, storageAfterAboveBase: probe.storageAfterAboveBase, opfsLeft: await opfsTempBytes(), peakHeap: probe.peakHeap }
  }) as never,
  /** One export per setting, to a throw-away sink: proves each quality option really changes what is encoded. */
  exportEncoded: (async (m: Manifest, raw: unknown) => {
    manifest = m
    const t0 = performance.now()
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle('quality.mp4', { create: true })
    const w = await handle.createWritable()
    const res = await fastExport({ composition: parseComposition(raw)!, resolveUrl, kindOf, canvas: document.createElement('canvas'), sink: w as never })
    const f = await handle.getFile()
    const buf = new Uint8Array(await f.arrayBuffer())
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    await root.removeEntry('quality.mp4')
    return { seconds: (performance.now() - t0) / 1000, bytes: res.bytes, encoded: res.encoded, b64: btoa(bin) }
  }) as never,
  export: (async (m: Manifest, raw: unknown) => {
    manifest = m
    const peak = { heap: 0 }
    const timer = setInterval(() => { peak.heap = Math.max(peak.heap, heap()) }, 200)
    const t0 = performance.now()
    const res = await fastExport({ composition: parseComposition(raw)!, resolveUrl, kindOf, canvas: document.createElement('canvas') })
    clearInterval(timer)
    return { seconds: (performance.now() - t0) / 1000, bytes: res.bytes, mime: res.mimeType, peakHeap: peak.heap }
  }) as never,
}
