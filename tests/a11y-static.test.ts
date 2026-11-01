// @vitest-environment node
/** Accesibilidad (análisis ESTÁTICO del JSX): no sustituye a una auditoría con lector de pantalla ni a axe en un navegador real. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..', 'app')
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const p = path.join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith('.tsx')) out.push(p) }
  return out
}
const files = walk(root).map(p => ({ rel: path.relative(path.resolve(__dirname, '..'), p), src: readFileSync(p, 'utf8') }))

describe('accesibilidad estática', () => {
  it('todo campo de formulario tiene nombre accesible (label, Field, aria-label o id)', () => {
    const bad: string[] = []
    for (const { rel, src } of files) {
      for (const m of src.matchAll(/<(input|select|textarea)\b((?:=>|[^>])*?)\/?>/g)) {
        const a = m[2]
        if (/type=["']hidden["']/.test(a) || /aria-label|aria-labelledby|\bid=/.test(a)) continue
        const pre = src.slice(0, m.index)
        if (pre.lastIndexOf('<label') > pre.lastIndexOf('</label>') || pre.lastIndexOf('<Field') > pre.lastIndexOf('</Field>')) continue
        bad.push(`${rel}: ${m[0].slice(0, 80)}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('toda imagen tiene alt y todo botón sin texto tiene aria-label o title', () => {
    const bad: string[] = []
    for (const { rel, src } of files) {
      for (const m of src.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) bad.push(`${rel}: ${m[0].slice(0, 80)}`)
      for (const m of src.matchAll(/<button\b((?:=>|[^>])*)>([\s\S]{0,200}?)<\/button>/g)) {
        if (/aria-label|title=/.test(m[1])) continue
        if (m[2].replace(/<[^>]*>/g, '').trim() === '') bad.push(`${rel}: ${m[0].slice(0, 80)}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('ningún div/span con onClick sin rol y foco de teclado', () => {
    const bad: string[] = []
    for (const { rel, src } of files) for (const m of src.matchAll(/<(div|span|li|p)\b((?:=>|[^>])*?\bonClick=(?:=>|[^>])*)>/g)) if (!/role=|tabIndex/.test(m[2]) && !/onClick=\{e => e\.stopPropagation\(\)\}/.test(m[2])) bad.push(`${rel}: ${m[0].slice(0, 80)}`)
    expect(bad).toEqual([])
  })
})
