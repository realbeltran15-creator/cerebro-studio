import { renderComposition } from '@/lib/editor/renderer'
import { emptyComposition, parseComposition, type Transition } from '@/lib/editor/composition'

async function img(color: string) { const oc = new OffscreenCanvas(1600, 900); const x = oc.getContext('2d')!; x.fillStyle = color; x.fillRect(0, 0, 1600, 900); return oc.convertToBlob({ type: 'image/png' }) }

/** Renders red → blue with the given transition (1 s inside a 2 s clip) and samples the frame halfway through it (no recording). */
;(window as any).runMotion = async (kind: Transition) => {
  const media = new Map<string, any>([['red', { kind: 'image', blob: await img('#ff0000') }], ['blue', { kind: 'image', blob: await img('#0000ff') }]])
  const base = emptyComposition('sb', 'Transición')
  base.fadeMs = 1000; base.subtitles = false
  base.clips = [
    { id: 'a', sceneId: 'a', position: 1, narration: null, visualAssetId: 'red', voiceAssetId: null, durationMs: 2000, motion: 'none', transition: kind, text: { content: 'ABCDEFGHIJ', position: 'center', sizePct: 8, animation: 'typewriter' } },
    { id: 'b', sceneId: 'b', position: 2, narration: null, visualAssetId: 'blue', voiceAssetId: null, durationMs: 1500, motion: 'none' },
  ]
  const comp = parseComposition(JSON.parse(JSON.stringify(base)))!
  const canvas = document.createElement('canvas')
  const px = (x: number, y = 0.15) => { const d = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data; return [d[0], d[1], d[2]] }
  const s: Record<string, number[]> = {}
  await renderComposition({ composition: comp, canvas, media, record: false, onProgress: t => {
    if (!s.before && t > 400 && t < 800) s.before = px(0.5)
    if (!s.left && t > 1450 && t < 1560) { s.left = px(0.1); s.mid = px(0.5); s.right = px(0.9) }
    if (!s.after && t > 2500 && t < 3000) s.after = px(0.5)
  } })
  return s
}
