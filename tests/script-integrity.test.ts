import { describe, expect, it } from 'vitest'
import { classifyScriptInsertError, friendlyDbMessage, planStoryboardResume, sceneKey } from '@/lib/script-integrity'
import { makeSection, scriptToScenes } from '@/lib/scripts'

const sections = ['A', 'B', 'C'].map(h => ({ ...makeSection(h, 'verified_fact'), text: `texto ${h}`, sources: ['https://s.test'] }))
const planned = scriptToScenes({ id: 's1', version: 1, hook: 'Gancho', cta: 'Cierre', sections })

describe('23505: solo (project_id, version) es recuperable', () => {
  it('clasifica por restricción, no por código', () => {
    expect(classifyScriptInsertError({ code: '23505', message: 'duplicate key value violates unique constraint "scripts_project_id_version_key"' })).toBe('version_conflict')
    expect(classifyScriptInsertError({ code: '23505', details: 'Key (project_id, version)=(a, 1) already exists.' })).toBe('version_conflict')
    expect(classifyScriptInsertError({ code: '23505', message: 'violates unique constraint "otra_cosa_key"' })).toBe('other_unique')
    expect(classifyScriptInsertError({ code: '42501' })).toBe('other')
    expect(classifyScriptInsertError(null)).toBe('none')
  })
  it('mensajes comprensibles, sin SQL crudo', () => {
    const raw = 'duplicate key value violates unique constraint "scripts_project_id_version_key"'
    expect(friendlyDbMessage({ code: '23505', message: raw }, 'x')).not.toMatch(/constraint|duplicate key/)
    expect(friendlyDbMessage({ code: '42501', message: 'new row violates row-level security policy for table "scripts"' }, 'x')).toBe('No tienes permiso para esta operación.')
    expect(friendlyDbMessage({ message: 'TypeError: Failed to fetch' }, 'x')).toMatch(/Sin conexión/)
    expect(friendlyDbMessage({ message: 'select * from secret_table where x' }, 'No se pudo.')).toBe('No se pudo.')
  })
})

describe('storyboard reanudable e idempotente', () => {
  it('sin escenas previas: crea todas', () => {
    const p = planStoryboardResume(planned, [])
    expect(p.state).toBe('fresh'); expect(p.toInsert).toHaveLength(planned.length)
  })
  it('completo: no inserta nada (doble clic / reintento no duplica)', () => {
    const existing = planned.map(s => ({ position: s.position, metadata: s.metadata }))
    const p = planStoryboardResume(planned, existing)
    expect(p.state).toBe('complete'); expect(p.toInsert).toEqual([])
  })
  it('interrupción a mitad: inserta SOLO las que faltan, en posiciones libres', () => {
    const existing = planned.slice(0, 2).map(s => ({ position: s.position, metadata: s.metadata }))
    const p = planStoryboardResume(planned, existing)
    expect(p.state).toBe('resume'); expect(p.kept).toBe(2)
    expect(p.toInsert.map(s => s.narration)).toEqual(planned.slice(2).map(s => s.narration))
    expect(new Set([...existing.map(e => e.position), ...p.toInsert.map(s => s.position)]).size).toBe(planned.length)
  })
  it('escenas editadas/reordenadas a mano se respetan y no chocan posiciones', () => {
    // El usuario movió la escena de la sección A a la posición 9 y añadió una propia en la 3.
    const existing = [
      { position: 9, metadata: planned[1].metadata },
      { position: 3, metadata: { manual: true } },
    ]
    const p = planStoryboardResume(planned, existing)
    expect(p.toInsert.some(s => s.metadata.script_section_id === planned[1].metadata.script_section_id)).toBe(false)
    const positions = [...existing.map(e => e.position), ...p.toInsert.map(s => s.position)]
    expect(new Set(positions).size).toBe(positions.length)
  })
  it('claves estables', () => {
    expect(sceneKey(planned[0].metadata)).toBe('h:Hook')
    expect(sceneKey(planned[planned.length - 1].metadata)).toBe('h:Cierre / CTA')
    expect(sceneKey(planned[1].metadata)).toMatch(/^s:/)
    expect(sceneKey({ manual: true })).toBeNull(); expect(sceneKey(null)).toBeNull()
  })
})

describe('propuesta SQL pendiente (no aplicada)', () => {
  it('es solo propuesta: security invoker, sin permisos para anon y sin URLs/credenciales', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('supabase/pending/20261102120000_storyboard_from_script_rpc.sql', 'utf8')
    expect(sql).toMatch(/security invoker/i); expect(sql).toMatch(/revoke all on function .* from public, anon/i)
    expect(sql).not.toMatch(/https?:\/\/|service_role|password|secret/i)
  })
})
