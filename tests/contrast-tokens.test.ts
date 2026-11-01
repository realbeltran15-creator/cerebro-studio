// @vitest-environment node
/** Contraste WCAG 2.2 AA calculado sobre los tokens CSS (comprobación ESTÁTICA de colores declarados; no mide el render real). */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(__dirname, '..', 'app', 'globals.css'), 'utf8')
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')))
const tok = (n: string) => { const m = root.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})\\b`)); if (!m) throw new Error('falta --' + n); return m[1] }
const lum = (hex: string) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('contraste de los tokens', () => {
  for (const bg of ['bg', 'panel', 'panel-2']) {
    it(`texto normal sobre --${bg} ≥ 4.5`, () => {
      for (const fg of ['text', 'muted', 'faint']) expect(ratio(tok(fg), tok(bg)), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
    it(`indicador de foco (--accent) sobre --${bg} ≥ 3 (elementos no textuales)`, () => {
      expect(ratio(tok('accent'), tok(bg))).toBeGreaterThanOrEqual(3)
    })
  }
  it('colores de estado (ok, warn, bad, info) como texto sobre los fondos ≥ 4.5', () => {
    for (const bg of ['bg', 'panel', 'panel-2']) for (const fg of ['ok', 'warn', 'bad', 'info']) expect(ratio(tok(fg), tok(bg)), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
  })
})
