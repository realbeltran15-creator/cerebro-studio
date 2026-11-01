/**
 * «Crear guion» desde una oportunidad: crea o REUTILIZA el proyecto y el guion, conserva la procedencia y nunca sobrescribe.
 * Puertos inyectables (Supabase en la pantalla, dobles en los tests). No genera texto con IA: el borrador queda vacío y editable.
 */
import { projectDraftFromOpportunity } from './opportunity-project'
import { defaultStructure, makeSection } from './scripts'
import type { ScriptSection } from './types/database'

export type OppForScript = Parameters<typeof projectDraftFromOpportunity>[0] & { id: string; project_id: string | null }

export type ScriptPorts = {
  /** Relee la oportunidad: otro clic/pestaña pudo haber creado ya el proyecto. */
  currentProjectId(oppId: string): Promise<string | null>
  insertProject(draft: ReturnType<typeof projectDraftFromOpportunity>): Promise<{ id: string } | { error: string }>
  linkOpportunity(oppId: string, projectId: string): Promise<string | null>
  /** Guion más reciente del proyecto, si existe. */
  latestScript(projectId: string): Promise<{ id: string } | null>
  insertScript(row: { project_id: string; version: number; title: string; status: 'draft'; idea: string; brief: string; source_opportunity_id: string; sections: ScriptSection[] }): Promise<{ id: string } | { conflict: true } | { error: string }>
}

export type ScriptResult =
  | { ok: true; projectId: string; scriptId: string; createdProject: boolean; createdScript: boolean; warnings: string[] }
  | { ok: false; error: string; projectId?: string }

export async function createScriptFromOpportunity(o: OppForScript, ports: ScriptPorts, now: number): Promise<ScriptResult> {
  const warnings: string[] = []
  let projectId = o.project_id ?? (await ports.currentProjectId(o.id))
  let createdProject = false
  const draft = projectDraftFromOpportunity(o, now)
  if (!projectId) {
    const p = await ports.insertProject(draft)
    if ('error' in p) return { ok: false, error: p.error }
    projectId = p.id; createdProject = true
    const linkErr = await ports.linkOpportunity(o.id, projectId)
    if (linkErr) warnings.push(`El proyecto se creó pero no se pudo vincular a la oportunidad (${linkErr}).`)
  }
  const existing = await ports.latestScript(projectId)
  if (existing) return { ok: true, projectId, scriptId: existing.id, createdProject, createdScript: false, warnings }
  const row = {
    project_id: projectId, version: 1, title: o.title, status: 'draft' as const, idea: draft.description, brief: draft.description,
    source_opportunity_id: o.id, sections: defaultStructure.map(s => makeSection(s.heading, s.basis)),
  }
  const ins = await ports.insertScript(row)
  if ('error' in ins) return { ok: false, error: ins.error, projectId }
  if ('conflict' in ins) {
    // Otro intento creó la versión 1 entre la comprobación y el insert: se reutiliza, no se duplica.
    const again = await ports.latestScript(projectId)
    return again ? { ok: true, projectId, scriptId: again.id, createdProject, createdScript: false, warnings } : { ok: false, error: 'No se pudo crear el guion.', projectId }
  }
  return { ok: true, projectId, scriptId: ins.id, createdProject, createdScript: true, warnings }
}
