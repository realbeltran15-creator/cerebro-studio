import type { SupabaseClient } from '@supabase/supabase-js'
import { removeFromCloud } from '@/lib/storage/client'

/**
 * Deleting a project removes, in the database, its files list (assets), edits (render_jobs), scripts, storyboards with their
 * scenes, publication jobs and linked metrics. Opportunities and Shorts-factory items are kept (they only lose the link).
 * The stored FILES are not removed by the database, so this module removes them. Nothing on YouTube or other platforms is touched.
 */

export type DeletionImpact = {
  assets: number
  /** Videos, including renders. */
  videos: number
  renders: number
  scripts: number
  storyboards: number
  publications: number
  /** Jobs already uploaded: the platform keeps the video, Cerebro loses its record of it. */
  published: number
  /** Approved or uploading right now: deleting would race with the upload. */
  inFlight: number
  opportunities: number
  paths: string[]
}

type Row = Record<string, unknown>
const rows = (r: { data: unknown }) => ((r.data ?? []) as Row[])

export async function loadImpact(supabase: SupabaseClient, projectId: string): Promise<DeletionImpact> {
  const [assets, renders, scripts, boards, jobs, opps] = await Promise.all([
    supabase.from('assets').select('id,asset_type,storage_path').eq('project_id', projectId).limit(5000),
    supabase.from('render_jobs').select('id').eq('project_id', projectId).limit(5000),
    supabase.from('scripts').select('id').eq('project_id', projectId).limit(5000),
    supabase.from('storyboards').select('id').eq('project_id', projectId).limit(5000),
    supabase.from('publication_jobs').select('id,status,result').eq('project_id', projectId).limit(5000),
    supabase.from('opportunities').select('id').eq('project_id', projectId).limit(5000),
  ])
  const a = rows(assets), j = rows(jobs)
  return {
    assets: a.length, videos: a.filter(x => x.asset_type === 'video').length, renders: rows(renders).length, scripts: rows(scripts).length, storyboards: rows(boards).length,
    publications: j.length,
    published: j.filter(x => x.status === 'published' || typeof (x.result as Row | null)?.videoId === 'string').length,
    inFlight: j.filter(x => x.status === 'approved' || x.status === 'publishing').length,
    opportunities: rows(opps).length,
    paths: a.map(x => x.storage_path).filter((p): p is string => typeof p === 'string' && p.length > 0),
  }
}

/** Reasons that forbid deleting right now. */
export function deletionBlockers(impact: Pick<DeletionImpact, 'inFlight'>) {
  return impact.inFlight > 0 ? [`Hay ${impact.inFlight} publicación(es) aprobada(s) o en curso. Cancélalas o espera a que terminen antes de eliminar el proyecto.`] : []
}

/** The typed name must match exactly (ignoring surrounding spaces and letter case), so a stray click or a copied habit cannot delete. */
export function confirmationMatches(typed: string, name: string) {
  const t = typed.trim().toLocaleLowerCase('es'), n = name.trim().toLocaleLowerCase('es')
  return n.length > 0 && t === n
}

export function impactLines(i: DeletionImpact) {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const lines = [
    `${n(i.assets, 'archivo de la Biblioteca', 'archivos de la Biblioteca')}${i.videos ? ` (${n(i.videos, 'vídeo', 'vídeos')})` : ''}, también borrados del almacenamiento`,
    n(i.renders, 'montaje o render', 'montajes y renders'),
    n(i.scripts, 'versión de guion', 'versiones de guion'),
    n(i.storyboards, 'storyboard con sus escenas', 'storyboards con sus escenas'),
    n(i.publications, 'trabajo de publicación', 'trabajos de publicación'),
  ].filter(l => !l.startsWith('0 '))
  if (i.published) lines.push(`${n(i.published, 'vídeo ya subido', 'vídeos ya subidos')}: seguirá(n) en la plataforma, pero Cerebro perderá su registro y sus métricas`)
  return lines
}

export const keptLines = (i: DeletionImpact) => (i.opportunities ? [`${i.opportunities} oportunidad(es) se conservan, solo pierden el vínculo con este proyecto`] : [])

/**
 * Deletes the project. Order matters: the database row goes first (one atomic cascade), so a failure never leaves a project
 * whose files are already gone. Files are removed afterwards; any that cannot be removed are reported, not hidden.
 */
export async function deleteProject(supabase: SupabaseClient, project: { id: string; name: string }, typedName: string) {
  if (!confirmationMatches(typedName, project.name)) throw new Error('El nombre escrito no coincide con el del proyecto.')
  const impact = await loadImpact(supabase, project.id)
  const blockers = deletionBlockers(impact)
  if (blockers.length) throw new Error(blockers[0])
  const { error } = await supabase.from('projects').delete().eq('id', project.id)
  if (error) throw new Error(`No se pudo eliminar el proyecto: ${error.message}`)
  let failed = 0
  for (const path of impact.paths) {
    try { await removeFromCloud(path) } catch { failed++ }
  }
  return { removedFiles: impact.paths.length - failed, failedFiles: failed, impact }
}
