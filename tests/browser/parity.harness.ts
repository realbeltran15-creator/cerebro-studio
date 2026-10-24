/** Browser side of the engine-vs-browser parity test: the same montage, the same media files, played and exported by the editor's own code. */
import { EditorPlayer, blobResolver } from '@/lib/editor/player'
import { fastExport } from '@/lib/editor/fast-export'
import { parseComposition } from '@/lib/editor/composition'
import type { KindOf } from '@/lib/editor/scene'
import { SAMPLES, TONES, tone } from '../render/parity-project'

declare global { interface Window { runParity: (manifest: Record<string, { kind: 'image' | 'video' | 'audio'; url: string }>, composition: unknown) => Promise<{ preview: number[][]; exported: number[][]; tones: Record<string, number>; mime: string | null; seconds: number }> } }

window.runParity = async (manifest, raw) => {
  const comp = parseComposition(raw)!
  const media = new Map<string, { kind: 'image' | 'video' | 'audio'; blob: Blob }>()
  for (const [id, m] of Object.entries(manifest)) media.set(id, { kind: m.kind, blob: await (await fetch(m.url)).blob() })
  const kindOf: KindOf = id => media.get(id)?.kind ?? null
  const W = 1280, H = 720
  const urls = blobResolver(media)
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const p = new EditorPlayer({ canvas, resolveUrl: urls.resolve, kindOf, output: 'stream' })
  p.setComposition(comp)
  const g = canvas.getContext('2d')!
  const preview: number[][] = []
  for (const [t, x, y] of SAMPLES) {
    p.seek(t); await p.preload(t)
    await new Promise(r => setTimeout(r, 150)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const d = g.getImageData(Math.floor(W * x), Math.floor(H * y), 1, 1).data
    preview.push([d[0], d[1], d[2]])
  }
  p.destroy()
  const t0 = performance.now()
  const res = await fastExport({ composition: comp, resolveUrl: urls.resolve, kindOf, canvas: document.createElement('canvas') })
  const seconds = (performance.now() - t0) / 1000
  urls.revoke()
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(res.blob)
  await new Promise<void>((ok, bad) => { v.onloadeddata = () => ok(); v.onerror = () => bad(new Error('cannot decode the export')) })
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const g2 = c2.getContext('2d')!
  const exported: number[][] = []
  for (const [t, x, y] of SAMPLES) {
    v.currentTime = t / 1000; await new Promise(r => (v.onseeked = r))
    g2.drawImage(v, 0, 0, W, H)
    const d = g2.getImageData(Math.floor(W * x), Math.floor(H * y), 1, 1).data
    exported.push([d[0], d[1], d[2]])
  }
  const ac = new AudioContext()
  const buf = await ac.decodeAudioData(await res.blob.arrayBuffer()); await ac.close()
  const ch = buf.getChannelData(0)
  const tones: Record<string, number> = {}
  for (const [name, f, a, b] of TONES) tones[name] = tone(ch, buf.sampleRate, f, a, b)
  return { preview, exported, tones, mime: res.mimeType, seconds }
}
