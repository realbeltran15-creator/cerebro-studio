import { describe, expect, it } from 'vitest'
import { estimateSeconds, makeSection, normalizeSections, scriptToScenes, scriptWarnings, wordCount } from '@/lib/scripts'

const sec = (heading: string, text: string, over: object = {}) => ({ ...makeSection(heading, 'verified_fact'), text, sources: ['https://a.test'], ...over })

describe('lib/scripts (cobertura que faltaba)', () => {
  it('normalizeSections descarta basura y corrige bases desconocidas', () => {
    const out = normalizeSections([null, 3, [], { heading: 'A', basis: 'inventada', text: 'x', sources: ['s', '', 4] }, { id: 'k' }])
    expect(out).toHaveLength(2)
    expect(out[0].basis).toBe('reconstruction'); expect(out[0].sources).toEqual(['s'])
    expect(normalizeSections('no')).toEqual([])
  })
  it('avisos: hook ausente, sección vacía, hecho sin fuente, testimonio sin hablante', () => {
    const w = scriptWarnings({ hook: '', cta: null, sections: [sec('S1', ''), sec('S2', 'texto', { sources: [] }), sec('S3', 'texto', { basis: 'testimony', speaker: '' })] })
    const msgs = w.map(x => x.message).join('|')
    expect(msgs).toMatch(/Falta el hook/); expect(msgs).toMatch(/no tiene narración/); expect(msgs).toMatch(/no tiene fuente/); expect(msgs).toMatch(/testimonio/)
    expect(scriptWarnings({ hook: 'h', cta: 'c', sections: [sec('S', 'ok')] })).toEqual([])
  })
  it('scriptToScenes: hook → secciones con texto → CTA, posiciones consecutivas, duración marcada como estimación, fuentes conservadas', () => {
    const scenes = scriptToScenes({ id: 's1', version: 2, hook: 'Gancho', cta: 'Suscríbete', sections: [sec('A', 'uno dos tres'), sec('B', '   '), sec('C', 'cuatro')] })
    expect(scenes.map(s => s.position)).toEqual([1, 2, 3, 4])
    expect(scenes.map(s => s.narration)).toEqual(['Gancho', 'uno dos tres', 'cuatro', 'Suscríbete'])
    expect(scenes.every(s => s.metadata.duration_is_estimate === true && s.metadata.script_id === 's1' && s.metadata.script_version === 2)).toBe(true)
    expect(scenes[1].metadata.sources).toEqual(['https://a.test'])
    expect(scenes.every(s => s.duration_ms >= 2000)).toBe(true)
  })
  it('guion sin texto => 0 escenas (la pantalla lo bloquea)', () => {
    expect(scriptToScenes({ id: 'x', version: 1, hook: null, cta: null, sections: [sec('A', '')] })).toEqual([])
  })
  it('duración: estimación a 2,5 palabras/s con mínimo de 2 s; texto vacío = 0', () => {
    expect(wordCount('  a  b\nc ')).toBe(3)
    expect(estimateSeconds('')).toBe(0); expect(estimateSeconds('hola')).toBe(2); expect(estimateSeconds(Array(50).fill('x').join(' '))).toBe(20)
  })
})
