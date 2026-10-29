import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { drawVisual, setLayerFactory } from '@/lib/editor/draw'
import { parseFx } from '@/lib/editor/composition'
import type { VisualOp } from '@/lib/editor/scene'

const W = 40, H = 40
const base = { type: 'visual', slot: 's', assetId: 'a', media: 'image', fit: 'cover', trackId: 'main', sourceMs: 0, rate: 1, live: true, volume: 0, zoom: 1, focusX: 0.5, focusY: 0.5, box: null, rotation: 0, alpha: 1, crop: null, filters: null, scale: 1, offsetX: 0, offsetY: 0, revealX: 1, revealY: 1, revealFrom: 'left', blur: 0, backdrop: false } as unknown as VisualOp
const src = (color: string, half?: string) => { const c = createCanvas(W, H); const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, W, H); if (half) { g.fillStyle = half; g.fillRect(0, 0, W / 2, H) } return { src: c as unknown as CanvasImageSource, width: W, height: H } }
const px = (ctx: any, x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data as Uint8ClampedArray)
const fresh = (bg = '#ffffff') => { const c = createCanvas(W, H); const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, W, H); return g as unknown as CanvasRenderingContext2D }

beforeAll(() => setLayerFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement))
afterAll(() => setLayerFactory(null))

describe('layer effects', () => {
  it('chroma key: the key colour becomes transparent (background shows), other colours stay', () => {
    const g = fresh('#ff0000')
    drawVisual(g, { ...base, fx: { chroma: { color: '#00ff00', tolerance: 0.2, softness: 0.02 } } }, W, H, src('#00ff00', '#0000ff'))
    expect(px(g, 30, 20).slice(0, 3)).toEqual([255, 0, 0])   // green half removed → red background
    expect(px(g, 5, 20).slice(0, 3)).toEqual([0, 0, 255])    // blue half kept
  })
  it('mask: an ellipse keeps the centre and removes the corners; invert does the opposite', () => {
    const a = fresh('#ffffff'); drawVisual(a, { ...base, fx: { mask: { shape: 'ellipse', inset: 0 } } }, W, H, src('#000000'))
    expect(px(a, 20, 20).slice(0, 3)).toEqual([0, 0, 0]); expect(px(a, 1, 1).slice(0, 3)).toEqual([255, 255, 255])
    const b = fresh('#ffffff'); drawVisual(b, { ...base, fx: { mask: { shape: 'ellipse', inset: 0, invert: true } } }, W, H, src('#000000'))
    expect(px(b, 20, 20).slice(0, 3)).toEqual([255, 255, 255]); expect(px(b, 1, 1).slice(0, 3)).toEqual([0, 0, 0])
  })
  it('blend: multiply darkens the layer below, screen lightens it', () => {
    const m = fresh('#808080'); drawVisual(m, { ...base, fx: { blend: 'multiply' } }, W, H, src('#808080'))
    expect(px(m, 20, 20)[0]).toBeLessThan(0x60)
    const sc = fresh('#808080'); drawVisual(sc, { ...base, fx: { blend: 'screen' } }, W, H, src('#808080'))
    expect(px(sc, 20, 20)[0]).toBeGreaterThan(0xa0)
  })
  it('state does not leak between layers (filter / transform after a chroma layer)', () => {
    const g = fresh('#ffffff')
    drawVisual(g, { ...base, rotation: 20, filters: { brightness: 0.5, contrast: 1, saturation: 1, blur: 0 }, fx: { chroma: { color: '#00ff00', tolerance: 0.2, softness: 0.02 } } }, W, H, src('#0000ff'))
    const h = fresh('#ffffff'); drawVisual(h, { ...base, fx: { chroma: { color: '#00ff00', tolerance: 0.2, softness: 0.02 } } }, W, H, src('#0000ff'))
    expect(px(h, 20, 20).slice(0, 3)).toEqual([0, 0, 255])
  })
  it('parseFx sanitises', () => {
    expect(parseFx({ blend: 'nope', chroma: { color: 'red' } })).toBeNull()
    expect(parseFx({ blend: 'screen', mask: { shape: 'ellipse', inset: 9 } })).toEqual({ blend: 'screen', mask: { shape: 'ellipse', inset: 0.45 } })
    expect(parseFx({ chroma: { color: '#00FF00', tolerance: 5, softness: -1 } })!.chroma).toEqual({ color: '#00ff00', tolerance: 1, softness: 0 })
  })
})
