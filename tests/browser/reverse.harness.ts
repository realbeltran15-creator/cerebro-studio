/** Harness for the reverse-video check: the editor's real player and fast exporter driven from a page. */
import { EditorPlayer } from '@/lib/editor/player'
import { fastExport } from '@/lib/editor/fast-export'
import { parseComposition } from '@/lib/editor/composition'
import type { KindOf } from '@/lib/editor/scene'

type Manifest = Record<string, { kind: 'image' | 'video' | 'audio'; url: string }>
declare global { interface Window { M: Record<string, (...a: never[]) => unknown> } }
let manifest: Manifest = {}
const kindOf: KindOf = id => manifest[id]?.kind ?? null
const resolveUrl = async (id: string) => manifest[id].url
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** Mean colour (r, g, b) of the centre of the picture. */
const mean = (c: HTMLCanvasElement): [number, number, number] => { const d = c.getContext('2d')!.getImageData(Math.floor(c.width / 2) - 8, Math.floor(c.height / 2) - 8, 16, 16).data; const s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2] } const n = d.length / 4; return [s[0] / n, s[1] / n, s[2] / n] }

window.M = {
  /** Whole montage through the real fast exporter; returns the MP4 as base64 plus what the export reported. */
  exportFile: (async (m: Manifest, raw: unknown, fps: number) => {
    manifest = m
    const t0 = performance.now()
    let peakHeap = 0, maxReaders = 0, refreshes = 0
    const res = await fastExport({ composition: parseComposition(raw)!, resolveUrl, kindOf, canvas: document.createElement('canvas'), fps, testMp4Vp9: true, onTelemetry: t => { peakHeap = Math.max(peakHeap, t.heapMb ?? 0); maxReaders = Math.max(maxReaders, t.readers); refreshes += t.urlRefreshes } })
    const bytes = new Uint8Array(await res.blob!.arrayBuffer())
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { b64: btoa(bin), bytes: bytes.length, seconds: (performance.now() - t0) / 1000, encoded: res.encoded, peakHeap, maxReaders, refreshes }
  }) as never,
  /** The preview: seek to each time and read back the picture. */
  previewAt: (async (m: Manifest, raw: unknown, times: number[]) => {
    manifest = m
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; document.body.appendChild(canvas)
    const errors: string[] = []
    const p = new EditorPlayer({ canvas, resolveUrl, kindOf, output: 'speakers', onError: e => errors.push(e) })
    p.setComposition(parseComposition(raw)!)
    const out: Array<[number, number, number]> = []
    for (const t of times) { p.seek(t); await p.preload(t); await sleep(120); out.push(mean(canvas)) }
    p.destroy()
    return { rgb: out, errors }
  }) as never,
  /** The preview while playing: picture level against the clock, sampled every 40 ms. */
  previewPlay: (async (m: Manifest, raw: unknown, fromMs: number, forMs: number) => {
    manifest = m
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; document.body.appendChild(canvas)
    const errors: string[] = []
    const p = new EditorPlayer({ canvas, resolveUrl, kindOf, output: 'speakers', onError: e => errors.push(e) })
    p.setComposition(parseComposition(raw)!)
    p.seek(fromMs); await p.preload(fromMs)
    p.play()
    const samples: Array<{ t: number; rgb: [number, number, number]; waiting: boolean }> = []
    const end = performance.now() + forMs
    while (performance.now() < end) { await sleep(40); samples.push({ t: Math.round(p.state.timeMs), rgb: mean(canvas), waiting: p.state.waiting }) }
    p.pause(); p.destroy()
    return { samples, errors }
  }) as never,
}
