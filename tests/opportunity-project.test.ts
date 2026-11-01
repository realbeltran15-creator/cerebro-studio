import { describe, expect, it } from 'vitest'
import { metricsFreshness, projectDraftFromOpportunity } from '@/lib/opportunity-project'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const opp = {
  title: 'Historias reales', source_platform: 'youtube', source_id: 'https://youtu.be/abc', query: 'misterios', region: 'ES', language: 'es',
  observed_metrics: { views: 1500, fetchedAt: '2026-10-23T12:00:00Z' }, evidence: [{ note: 'Canal pequeño con muchas vistas' }, { other: 1 }, null],
}

describe('oportunidad -> proyecto', () => {
  it('conserva fuente, consulta, mercado, fecha y observaciones', () => {
    const d = projectDraftFromOpportunity(opp, NOW)
    expect(d.name).toBe('Historias reales')
    expect(d.description).toContain('Fuente original: https://youtu.be/abc')
    expect(d.description).toContain('misterios')
    expect(d.description).toContain('Mercado: ES / es')
    expect(d.description).toContain('Observado el 2026-10-23')
    expect(d.description).toContain('Observación: Canal pequeño con muchas vistas')
    expect(d.description).not.toContain('desactualizados')
  })
  it('marca datos caducados y no inventa métricas cuando faltan', () => {
    const old = projectDraftFromOpportunity({ ...opp, observed_metrics: { views: 10, fetchedAt: '2026-09-01T00:00:00Z' } }, NOW)
    expect(old.description).toContain('desactualizados')
    const bare = projectDraftFromOpportunity({ title: 'x', source_platform: 'manual', source_id: null, query: null, region: null, language: null }, NOW)
    expect(bare.description).toBe('Oportunidad (manual)')
  })
  it('fuente no http se guarda como referencia, no como enlace', () => {
    expect(projectDraftFromOpportunity({ ...opp, source_id: 'javascript:alert(1)' }, NOW).description).toContain('Referencia de la fuente: javascript:alert(1)')
    expect(projectDraftFromOpportunity({ ...opp, source_id: 'javascript:alert(1)' }, NOW).description).not.toContain('Fuente original')
  })
  it('frescura', () => {
    expect(metricsFreshness({ fetchedAt: '2026-10-23T12:00:00Z' }, NOW)).toEqual({ level: 'fresh', days: 1 })
    expect(metricsFreshness({ fetchedAt: '2026-10-01T12:00:00Z' }, NOW).level).toBe('stale')
    expect(metricsFreshness({}, NOW)).toEqual({ level: 'none', days: null })
    expect(metricsFreshness(null, NOW).level).toBe('none')
  })
})
