import { describe, it, expect } from 'vitest'
import { zoomAfterWheel, anchoredScrollLeft, wheelDelta, ZOOM_MIN, ZOOM_MAX } from '@/lib/editor/timeline-zoom'

describe('zoom de la línea de tiempo con Alt + rueda', () => {
  it('rueda arriba acerca y rueda abajo aleja', () => {
    expect(zoomAfterWheel(40, -100)).toBeGreaterThan(40)
    expect(zoomAfterWheel(40, 100)).toBeLessThan(40)
  })
  it('respeta los límites del deslizador (1–200)', () => {
    expect(zoomAfterWheel(199, -240)).toBe(ZOOM_MAX)
    expect(zoomAfterWheel(1.2, 240)).toBe(ZOOM_MIN)
    expect(zoomAfterWheel(ZOOM_MAX, -100)).toBe(ZOOM_MAX)
  })
  it('un golpe de rueda grande no da saltos bruscos', () => {
    const a = zoomAfterWheel(40, -100000), b = zoomAfterWheel(40, -240)
    expect(a).toBe(b)
    expect(b / 40).toBeLessThan(1.5)
  })
  it('acercar y alejar la misma cantidad vuelve casi al valor inicial', () => {
    expect(Math.abs(zoomAfterWheel(zoomAfterWheel(40, -120), 120) - 40)).toBeLessThan(0.1)
  })
  it('normaliza líneas/páginas y usa deltaX si deltaY es 0', () => {
    expect(wheelDelta({ deltaY: 3, deltaX: 0, deltaMode: 1 })).toBe(48)
    expect(wheelDelta({ deltaY: 1, deltaX: 0, deltaMode: 2 })).toBe(100)
    expect(wheelDelta({ deltaY: 0, deltaX: -100, deltaMode: 0 })).toBe(-100)
  })
  it('mantiene bajo el cursor el mismo instante', () => {
    const oldPx = 40, newPx = 80, scroll = 300, x = 250, W = 20000
    const left = anchoredScrollLeft(oldPx, newPx, scroll, x, W, 1000)
    expect((left + x) / newPx).toBeCloseTo((scroll + x) / oldPx, 6)
  })
  it('no desplaza fuera del contenido (proyecto corto) ni por debajo de 0', () => {
    expect(anchoredScrollLeft(40, 20, 0, 400, 600, 1000)).toBe(0)
    expect(anchoredScrollLeft(40, 41, 0, 10, 5000, 1000)).toBeGreaterThanOrEqual(0)
    expect(anchoredScrollLeft(10, 200, 100, 900, 3000, 1000)).toBeLessThanOrEqual(2000)
  })
})
