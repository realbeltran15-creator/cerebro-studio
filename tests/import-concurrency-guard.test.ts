import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('importación de bancos: concurrencia', () => {
  const src = readFileSync('lib/providers/persist.ts', 'utf8')
  it('comparte una sola importación en vuelo y reconcilia el registro más antiguo entre instancias', () => {
    expect(src).toContain('inflightImports')
    expect(src).toMatch(/first\.id!==/)
    expect(src).toContain('is NOT removed here')
  })
  it('una importación simultánea del mismo elemento devuelve el registro ganador como duplicado, no un error', () => {
    expect(src).toMatch(/already exists\|duplicate/)
    expect(src).toContain('return{asset:won,duplicate:true}')
  })
})
