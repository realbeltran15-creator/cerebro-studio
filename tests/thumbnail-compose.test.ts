import { describe, expect, it } from 'vitest'
import { layoutText, lineBaselines, THUMB_H } from '@/lib/thumbnails/compose'

// Monospace-like measure: 0.6 em per character.
const measure = (s: string, px: number) => s.length * px * 0.6

describe('thumbnail text composed on top', () => {
  it('fits short text big (up to two lines)', () => {
    const l = layoutText('NADIE SOBREVIVIÓ', measure)!
    expect(l.lines.length).toBeLessThanOrEqual(2); expect(l.px).toBeGreaterThanOrEqual(100)
  })
  it('wraps to two lines and shrinks until it fits; refuses what cannot fit legibly', () => {
    const l = layoutText('LA VERDAD QUE NADIE TE CONTÓ SOBRE ESTO', measure)!
    expect(l.lines.length).toBe(2); expect(l.lines.every(x => measure(x, l.px) <= 1152)).toBe(true)
    expect(layoutText('una frase demasiado larga para una miniatura que nadie podría leer en el móvil jamás', measure)).toBeNull()
  })
  it('places the block at the top, centre or bottom inside the margins', () => {
    const [b] = lineBaselines(1, 100, 'bottom'); const [t] = lineBaselines(1, 100, 'top'); const [c] = lineBaselines(1, 100, 'center')
    expect(t).toBeLessThan(c); expect(c).toBeLessThan(b); expect(b).toBeLessThan(THUMB_H)
  })
})

import { coverRect, THUMB_SIZES } from '@/lib/thumbnails/compose'
import { describe as d2, expect as e2, it as i2 } from 'vitest'

d2('coverRect y formatos', () => {
  i2('cubre el lienzo sin deformar en 16:9, 9:16 y 1:1', () => {
    for (const [asp, { w, h }] of Object.entries(THUMB_SIZES)) {
      for (const [sw, sh] of [[1920, 1080], [1080, 1920], [1000, 1000], [4000, 300]]) {
        const r = coverRect(sw, sh, w, h)
        e2(r.x).toBeLessThanOrEqual(0.0001); e2(r.y).toBeLessThanOrEqual(0.0001)
        e2(r.x + r.width).toBeGreaterThanOrEqual(w - 0.001); e2(r.y + r.height).toBeGreaterThanOrEqual(h - 0.001)
        e2(Math.abs(r.width / r.height - sw / sh)).toBeLessThan(1e-9)
        void asp
      }
    }
  })
  i2('rechaza imágenes sin tamaño', () => { e2(() => coverRect(0, 10, 100, 100)).toThrow() })
  i2('tamaños de salida esperados', () => { e2(THUMB_SIZES['9:16']).toEqual({ w: 720, h: 1280 }) })
})
