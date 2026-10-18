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
