import { parseComposition, type Composition } from './composition'

/**
 * Pure helpers for render_jobs rows: picking the saved edit to open, describing saved versions,
 * detecting renders left in "rendering" by a closed or reloaded tab, and save conflicts.
 */

export type DraftRow = { id: string; updated_at: string; composition: unknown }
export type Draft = { id: string; updatedAt: string; comp: Composition }

/** Drafts of one storyboard, newest first. Horizontal/vertical derived edits (origin set) are excluded. */
export function draftsForStoryboard(rows: DraftRow[], storyboardId: string): Draft[] {
  return rows.flatMap(r => {
    const comp = parseComposition(r.composition)
    return comp && comp.storyboardId === storyboardId && !comp.origin ? [{ id: r.id, updatedAt: r.updated_at, comp }] : []
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Short description of a saved version so duplicates can be told apart. */
export function draftSummary(comp: Composition) {
  const visuals = comp.clips.filter(c => c.visualAssetId).length
  const voices = comp.clips.filter(c => c.voiceAssetId).length
  return `${comp.clips.length} escenas · ${visuals} con imagen/vídeo · ${voices} con voz${comp.musicAssetId ? ' · música' : ''}`
}

/** A render still "rendering" long after it started was interrupted (tab closed or reloaded). */
export const STALE_RENDER_MS = 60 * 60 * 1000

export function isStaleRender(job: { status: string; updated_at: string; output_asset_id: string | null }, now = Date.now()) {
  return job.status === 'rendering' && !job.output_asset_id && now - Date.parse(job.updated_at) > STALE_RENDER_MS
}

export const INTERRUPTED_MESSAGE = 'Interrumpido: la pestaña se cerró o recargó antes de terminar el render.'

export class SaveConflictError extends Error {
  constructor() { super('Este montaje se guardó en otra pestaña o sesión después de abrirlo aquí. Recarga la página para trabajar sobre la última versión.') }
}
