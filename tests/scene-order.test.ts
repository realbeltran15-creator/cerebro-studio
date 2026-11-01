import { describe, expect, it } from 'vitest'
import { applyPositionSteps, planCompact, planMove, type SceneRef } from '@/lib/scene-order'

const scenes = (): SceneRef[] => [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }]

/** Base simulada que RESPETA UNIQUE(storyboard_id, position) y permite inyectar un fallo en la llamada N. */
function fakeDb(initial: SceneRef[], failOnCall = -1) {
  const rows = new Map(initial.map(s => [s.id, s.position])); let calls = 0
  return {
    rows, get calls() { return calls },
    update: async ({ id, position }: { id: string; position: number }) => {
      if (calls++ === failOnCall) return 'network'
      if ([...rows.entries()].some(([k, v]) => k !== id && v === position)) return 'duplicate position'
      rows.set(id, position); return null
    },
    order: () => [...rows.entries()].sort((x, y) => x[1] - y[1]).map(([k]) => k),
  }
}

describe('reordenar escenas', () => {
  it('subir y bajar intercambia vecinas sin violar la unicidad', async () => {
    const db = fakeDb(scenes())
    expect(await applyPositionSteps(planMove(scenes(), 'b', -1)!, scenes(), db.update)).toEqual({ ok: true })
    expect(db.order()).toEqual(['b', 'a', 'c'])
    const down = fakeDb(scenes())
    await applyPositionSteps(planMove(scenes(), 'a', 1)!, scenes(), down.update)
    expect(down.order()).toEqual(['b', 'a', 'c'])
    expect(new Set(down.rows.values()).size).toBe(3)
  })
  it('extremos: no se puede subir la primera ni bajar la última; id desconocido', () => {
    expect(planMove(scenes(), 'a', -1)).toBeNull(); expect(planMove(scenes(), 'c', 1)).toBeNull(); expect(planMove(scenes(), 'zz', 1)).toBeNull()
  })
  it('con huecos en las posiciones (escenas manuales) también funciona', async () => {
    const gap: SceneRef[] = [{ id: 'a', position: 2 }, { id: 'b', position: 9 }]
    const db = fakeDb(gap); await applyPositionSteps(planMove(gap, 'b', -1)!, gap, db.update)
    expect(db.order()).toEqual(['b', 'a'])
  })
  it('fallo en cualquier paso: se restaura el orden anterior sin duplicados', async () => {
    for (const failAt of [0, 1, 2]) {
      const db = fakeDb(scenes(), failAt)
      const r = await applyPositionSteps(planMove(scenes(), 'b', -1)!, scenes(), db.update)
      expect(r.ok).toBe(false)
      expect(db.order()).toEqual(['a', 'b', 'c']); expect(new Set(db.rows.values()).size).toBe(3)
    }
  })
  it('doble clic: dos movimientos seguidos son operaciones independientes y coherentes', async () => {
    const db = fakeDb(scenes())
    await applyPositionSteps(planMove(scenes(), 'c', -1)!, scenes(), db.update)
    const now = [...db.rows.entries()].map(([id, position]) => ({ id, position }))
    await applyPositionSteps(planMove(now, 'c', -1)!, now, db.update)
    expect(db.order()).toEqual(['c', 'a', 'b'])
  })
})

describe('eliminar y compactar', () => {
  it('cierra huecos sin colisiones y solo toca lo necesario', async () => {
    const after: SceneRef[] = [{ id: 'a', position: 1 }, { id: 'c', position: 3 }, { id: 'd', position: 7 }]
    const steps = planCompact(after)
    expect(steps).toEqual([{ id: 'c', position: 2 }, { id: 'd', position: 3 }])
    const db = fakeDb(after); expect((await applyPositionSteps(steps, after, db.update)).ok).toBe(true)
    expect([...db.rows.values()].sort()).toEqual([1, 2, 3])
    expect(planCompact([{ id: 'a', position: 1 }, { id: 'b', position: 2 }])).toEqual([])
  })
  it('fallo al compactar: se deshace', async () => {
    const after: SceneRef[] = [{ id: 'a', position: 2 }, { id: 'b', position: 3 }]
    const db = fakeDb(after, 1)
    const r = await applyPositionSteps(planCompact(after), after, db.update)
    expect(r.ok).toBe(false); expect(db.order()).toEqual(['a', 'b']); expect(db.rows.get('a')).toBe(2)
  })
})

describe('propuesta SQL (no aplicada)', () => {
  it('security invoker, sin anon, sin credenciales', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('supabase/pending/20261102130000_scenes_concurrency_and_reorder.sql', 'utf8')
    expect(sql).toMatch(/security invoker/i); expect(sql).toMatch(/from public, anon/i); expect(sql).not.toMatch(/https?:\/\/|service_role|password/i)
  })
})
