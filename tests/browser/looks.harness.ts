/** Browser side of the looks comparison: the editor's own player draws the frame at each time; a 32×18 grid of pixels is returned. */
import { EditorPlayer, blobResolver } from '@/lib/editor/player'
import { parseComposition } from '@/lib/editor/composition'
import type { KindOf } from '@/lib/editor/scene'

declare global { interface Window { runLooks: (manifest: Record<string, { kind: 'image' | 'video' | 'audio'; url: string }>, composition: unknown, times: number[]) => Promise<number[][][]> } }
window.runLooks = async (manifest, raw, times) => {
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
  const out: number[][][] = []
  for (const t of times) {
    p.seek(t); await p.preload(t)
    await new Promise(r => setTimeout(r, 250)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const d = g.getImageData(0, 0, W, H).data, grid: number[][] = []
    for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) { const i = ((y * 40 + 20) * W + x * 40 + 20) * 4; grid.push([d[i], d[i + 1], d[i + 2]]) }
    out.push(grid)
  }
  p.destroy(); urls.revoke()
  return out
}
