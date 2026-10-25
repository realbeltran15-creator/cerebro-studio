/** Measurement harness: the editor's own player and fast exporter, driven from the page so a Node script can sample memory, traffic and disk. */
import { EditorPlayer } from '@/lib/editor/player'
import { fastExport } from '@/lib/editor/fast-export'
import { parseComposition } from '@/lib/editor/composition'
import { saveLocalDraft, saveLocalHistory } from '@/lib/editor/local-draft'
import type { KindOf } from '@/lib/editor/scene'

type Manifest = Record<string, { kind: 'image' | 'video' | 'audio'; url: string }>
declare global { interface Window { M: Record<string, (...a: never[]) => unknown> } }
let player: EditorPlayer | null = null
let manifest: Manifest = {}
const kindOf: KindOf = id => manifest[id]?.kind ?? null
const resolveUrl = async (id: string) => manifest[id].url
const heap = () => { const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory; return m ? m.usedJSHeapSize : -1 }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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
