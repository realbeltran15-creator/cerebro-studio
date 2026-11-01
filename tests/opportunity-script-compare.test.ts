import { describe, expect, it } from 'vitest'
import { compareOpportunities, explainOpportunity, MAX_COMPARE, NO_DATA, type Opp } from '@/lib/opportunity-explain'
import { createScriptFromOpportunity, type OppForScript, type ScriptPorts } from '@/lib/opportunity-script'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const base = (over: Partial<Opp> = {}): Opp => ({
  id: 'o1', title: 'Historias', source_platform: 'youtube', source_id: 'https://youtu.be/x', query: 'misterios', region: 'ES', language: 'es', status: 'discovered',
  created_at: '2026-10-20T00:00:00Z', observed_metrics: { views: 1000, channelSubscribers: 500, fetchedAt: '2026-10-23T12:00:00Z', history: [{ fetchedAt: '2026-10-22T12:00:00Z', views: 600 }] },
  calculated_metrics: { viewsPerDay: 400, viewsToSubscribers: 2, viewsPerDaySinceLastCheck: 400 }, evidence: [{ note: 'nota' }], ...over,
})
const empty = (id: string): Opp => base({ id, title: `vacía ${id}`, source_platform: 'manual', source_id: null, query: null, region: null, language: null, observed_metrics: {}, calculated_metrics: {}, evidence: [] })

describe('explicación (sin puntuaciones inventadas)', () => {
  it('datos completos: evidencia alta, nada estimado, faltan solo demanda/competencia', () => {
    const e = explainOpportunity(base(), NOW)
    expect(e.evidenceLevel).toBe('alta')
    expect(e.estimated).toEqual([])
    expect(e.readings).toBe(2)
    expect(e.missing.join(' ')).toMatch(/Demanda y competencia/)
    expect(e.missing.join(' ')).not.toMatch(/Métricas observadas/)
  })
  it('sin evidencias: lo dice y no calcula nada', () => {
    const e = explainOpportunity(empty('a'), NOW)
    expect(e.evidenceLevel).toBe('sin_datos')
    expect(e.observed).toEqual([]); expect(e.calculated).toEqual([])
    expect(e.risks.join(' ')).toMatch(/es una idea, no una oportunidad medida/)
    expect(e.missing.length).toBeGreaterThanOrEqual(4)
  })
  it('fuente caducada y una sola lectura generan riesgos', () => {
    const e = explainOpportunity(base({ observed_metrics: { views: 5, fetchedAt: '2026-09-01T00:00:00Z' } }), NOW)
    expect(e.freshness.level).toBe('stale')
    expect(e.risks.join(' ')).toMatch(/desactualizados/)
    expect(e.risks.join(' ')).toMatch(/Una sola lectura/)
  })
  it('nunca menciona probabilidad, viral ni ingresos', () => {
    const txt = JSON.stringify([explainOpportunity(base(), NOW), compareOpportunities([base(), empty('b')], NOW)])
    expect(txt).not.toMatch(/probabilidad de éxito|viralidad garantizada|ingresos/i)
  })
})

describe('comparador', () => {
  it('2 a 4: rechaza menos de 2 y más de 4', () => {
    expect(compareOpportunities([base()], NOW).error).toBeTruthy()
    expect(compareOpportunities(Array.from({ length: MAX_COMPARE + 1 }, (_, i) => base({ id: String(i) })), NOW).error).toBeTruthy()
  })
  it('completos, parciales y ausentes: «Sin datos suficientes» en lugar de inventar', () => {
    const { rows } = compareOpportunities([base(), base({ id: 'p', observed_metrics: { views: 10 }, calculated_metrics: {} }), empty('z')], NOW)
    const get = (l: string) => rows.find(r => r.label === l)!.values
    expect(get('Vistas/día (calculado)')).toEqual(['400', NO_DATA, NO_DATA])
    expect(get('Vistas (observado)')[2]).toBe(NO_DATA)
    expect(get('Fecha de la lectura')[2]).toBe(NO_DATA)
    expect(get('Frescura')[2]).toBe(NO_DATA)
    expect(get('Enlace verificable')).toEqual(['Sí', 'Sí', 'No'])
    expect(rows.every(r => r.values.length === 3)).toBe(true)
  })
})

function ports(over: Partial<ScriptPorts> = {}) {
  const calls = { projects: 0, scripts: 0, links: 0, rows: [] as unknown[] }
  let projectId: string | null = null, scriptId: string | null = null
  const p: ScriptPorts = {
    currentProjectId: async () => projectId,
    insertProject: async () => { calls.projects++; projectId = 'p1'; return { id: 'p1' } },
    linkOpportunity: async () => { calls.links++; return null },
    latestScript: async () => (scriptId ? { id: scriptId } : null),
    insertScript: async row => { calls.scripts++; calls.rows.push(row); scriptId = 's1'; return { id: 's1' } },
    ...over,
  }
  return { p, calls }
}
const opp: OppForScript = { ...base(), project_id: null }

describe('Crear guion desde oportunidad', () => {
  it('crea proyecto y borrador editable conservando la fuente; sin texto generado', async () => {
    const { p, calls } = ports()
    const r = await createScriptFromOpportunity(opp, p, NOW)
    expect(r).toMatchObject({ ok: true, projectId: 'p1', scriptId: 's1', createdProject: true, createdScript: true })
    const row = calls.rows[0] as { brief: string; idea: string; sections: Array<{ text: string }>; source_opportunity_id: string; status: string }
    expect(row.brief).toContain('https://youtu.be/x'); expect(row.brief).toContain('ES / es'); expect(row.brief).toContain('misterios')
    expect(row.source_opportunity_id).toBe('o1'); expect(row.status).toBe('draft')
    expect(row.sections.length).toBeGreaterThan(0); expect(row.sections.every(s => s.text === '')).toBe(true)
  })
  it('doble clic / reintento: reutiliza, no duplica ni sobrescribe', async () => {
    const { p, calls } = ports()
    const [a, b] = [await createScriptFromOpportunity(opp, p, NOW), await createScriptFromOpportunity(opp, p, NOW)]
    expect(calls.projects).toBe(1); expect(calls.scripts).toBe(1)
    expect(b).toMatchObject({ ok: true, createdProject: false, createdScript: false, scriptId: 's1' })
    expect(a.ok && b.ok && a.projectId === b.projectId).toBe(true)
  })
  it('error parcial al vincular: continúa y avisa', async () => {
    const { p } = ports({ linkOpportunity: async () => 'boom' })
    const r = await createScriptFromOpportunity(opp, p, NOW)
    expect(r.ok && r.warnings[0]).toMatch(/no se pudo vincular/)
  })
  it('conflicto de versión (otra pestaña ganó la carrera): reutiliza el guion', async () => {
    let n = 0
    const { p } = ports({ latestScript: async () => (n++ === 0 ? null : { id: 'winner' }), insertScript: async () => ({ conflict: true }) })
    const r = await createScriptFromOpportunity(opp, p, NOW)
    expect(r).toMatchObject({ ok: true, scriptId: 'winner', createdScript: false })
  })
  it('un guion existente jamás se toca; fallo de proyecto o de guion se informa', async () => {
    const existing = ports({ latestScript: async () => ({ id: 'old' }) })
    const r = await createScriptFromOpportunity({ ...opp, project_id: 'p9' }, existing.p, NOW)
    expect(r).toMatchObject({ ok: true, scriptId: 'old', createdScript: false }); expect(existing.calls.scripts).toBe(0)
    expect((await createScriptFromOpportunity(opp, ports({ insertProject: async () => ({ error: 'rls' }) }).p, NOW)).ok).toBe(false)
    const f = await createScriptFromOpportunity(opp, ports({ insertScript: async () => ({ error: 'x' }) }).p, NOW)
    expect(f).toMatchObject({ ok: false, projectId: 'p1' })
  })
})
