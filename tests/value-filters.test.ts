import { describe, expect, it } from 'vitest'
import { assess, prescreen } from '@/lib/research/value-filters'

const an = (demand: number, confidence: 'alta' | 'media' | 'baja' = 'media') => ({ indices: { demand, supply: 10, competition: 10, growth: null, opportunity: 50 }, confidence, niches: ['educacion'] }) as never

describe('value filters', () => {
  it('never turns missing evidence into a score', () => {
    const r = assess({ topic: 'historia antigua', language: 'es', region: 'ES' })
    expect(r.filters.find(f => f.id === 'demanda')?.score).toBeNull()
    expect(r.filters.find(f => f.id === 'barrera')?.basis).toBe('no_verificado')
    expect(r.verdict).not.toBe('PASA')
  })
  it('discards when a measured filter is below its minimum', () => {
    const r = assess({ topic: 'x', language: 'es', region: 'ES', analysis: an(20) })
    expect(r.verdict).toBe('DESCARTAR'); expect(r.failed).toContain('demanda')
  })
  it('keeps for review when everything measurable passes', () => {
    const r = assess({ topic: 'x', language: 'de', region: 'DE', analysis: an(75) })
    expect(r.verdict).toBe('REVISAR'); expect(r.unverified).toEqual(['barrera'])
  })
  it('low-confidence samples leave demand unverified', () => {
    expect(assess({ topic: 'x', language: 'es', region: 'ES', analysis: an(90, 'baja') }).unverified).toContain('demanda')
  })
  it('advantage counts own languages and home country', () => {
    expect(prescreen('x', 'nl', 'NL').filters.find(f => f.id === 'ventaja')?.score).toBe(4)
    expect(prescreen('x', 'ja', 'JP').filters.find(f => f.id === 'ventaja')?.score).toBe(1)
  })
})
