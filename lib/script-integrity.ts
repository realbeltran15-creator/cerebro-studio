/** Integridad de guiones y storyboards: clasificación de errores de unicidad y reanudación idempotente de escenas. Sin I/O. */
import type { PlannedScene } from './scripts'

type DbError = { code?: string; message?: string; details?: string } | null | undefined

/** 23505 NO siempre es recuperable: solo lo es la restricción (project_id, version) de scripts. */
export function classifyScriptInsertError(e: DbError): 'version_conflict' | 'other_unique' | 'other' | 'none' {
  if (!e) return 'none'
  if (e.code !== '23505') return 'other'
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  return /scripts_project_id_version_key|\(project_id, version\)/i.test(text) ? 'version_conflict' : 'other_unique'
}

/** Mensaje comprensible: nunca texto SQL crudo. */
export function friendlyDbMessage(e: DbError, fallback: string): string {
  if (!e) return fallback
  if (e.code === '42501' || /row-level security|permission denied/i.test(e.message ?? '')) return 'No tienes permiso para esta operación.'
  if (e.code === '23505') return 'Ya existe un elemento igual. Recarga la página para ver el estado actual.'
  if (e.code === '23503') return 'El elemento relacionado ya no existe. Recarga la página.'
  if (/fetch|network|failed to fetch/i.test(e.message ?? '')) return 'Sin conexión con el servidor. No se ha perdido nada de lo que escribiste: reintenta en unos segundos.'
  return fallback
}

export type ExistingScene = { position: number; metadata: Record<string, unknown> | null }

/** Clave estable de una escena planificada: id de la sección del guion o, para hook/CTA, su encabezado. */
export function sceneKey(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null
  if (typeof meta.script_section_id === 'string' && meta.script_section_id) return `s:${meta.script_section_id}`
  if (typeof meta.heading === 'string' && (meta.heading === 'Hook' || meta.heading === 'Cierre / CTA')) return `h:${meta.heading}`
  return null
}

export type ResumePlan = {
  state: 'fresh' | 'resume' | 'complete'
  /** Solo las escenas que faltan, con posiciones libres (nunca pisa ni mueve las existentes, ni sus ediciones manuales). */
  toInsert: PlannedScene[]
  kept: number
}

export function planStoryboardResume(planned: PlannedScene[], existing: ExistingScene[]): ResumePlan {
  if (existing.length === 0) return { state: 'fresh', toInsert: planned, kept: 0 }
  const have = new Set(existing.map(e => sceneKey(e.metadata)).filter((k): k is string => !!k))
  const taken = new Set(existing.map(e => e.position))
  let next = Math.max(...existing.map(e => e.position)) + 1
  const toInsert: PlannedScene[] = []
  for (const p of planned) {
    const key = sceneKey(p.metadata)
    if (key && have.has(key)) continue
    let position = p.position
    if (taken.has(position)) position = next++
    taken.add(position)
    toInsert.push({ ...p, position })
  }
  return { state: toInsert.length === 0 ? 'complete' : 'resume', toInsert, kept: existing.length }
}
