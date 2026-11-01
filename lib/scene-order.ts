/**
 * Reordenar / eliminar escenas con la restricción UNIQUE(storyboard_id, position) y SIN transacción en el cliente.
 * Cada paso es una actualización de posición que nunca viola la unicidad; si uno falla se deshacen los hechos en orden inverso.
 * No es atómico (otra pestaña podría intercalar cambios): la garantía fuerte requiere la RPC propuesta en supabase/pending.
 */
export type SceneRef = { id: string; position: number }
export type PositionStep = { id: string; position: number }

const sorted = (scenes: SceneRef[]) => [...scenes].sort((a, b) => a.position - b.position)

/** Intercambia la escena con su vecina (delta -1 = subir, +1 = bajar) usando una posición temporal libre. null si no se puede mover. */
export function planMove(scenes: SceneRef[], id: string, delta: -1 | 1): PositionStep[] | null {
  const list = sorted(scenes)
  const i = list.findIndex(s => s.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return null
  const a = list[i], b = list[j]
  const temp = list[list.length - 1].position + 1
  return [{ id: a.id, position: temp }, { id: b.id, position: a.position }, { id: a.id, position: b.position }]
}

/** Cierra huecos tras eliminar: renumera 1..n en orden ascendente (cada destino ya está libre). Solo emite los cambios necesarios. */
export function planCompact(remaining: SceneRef[]): PositionStep[] {
  return sorted(remaining).flatMap((s, i) => (s.position === i + 1 ? [] : [{ id: s.id, position: i + 1 }]))
}

export type ApplyResult = { ok: true } | { ok: false; error: string; rolledBack: boolean }

/** Aplica los pasos en orden; si uno falla, restaura las posiciones originales en orden inverso. */
export async function applyPositionSteps(steps: PositionStep[], original: SceneRef[], update: (s: PositionStep) => Promise<string | null>): Promise<ApplyResult> {
  const done: PositionStep[] = []
  for (const step of steps) {
    const err = await update(step)
    if (err) {
      let rolledBack = true
      for (const d of [...done].reverse()) {
        const orig = original.find(o => o.id === d.id)
        if (!orig || (await update({ id: d.id, position: orig.position }))) rolledBack = false
      }
      return { ok: false, error: err, rolledBack }
    }
    done.push(step)
  }
  return { ok: true }
}
