'use client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseComposition, type Composition } from './composition'

/**
 * Recovery points of a montage, kept on the server (private storage, the owner's own folder) so they survive closing the browser and can be
 * opened from another device. No database change: each point is a small JSON file `<owner>/<project>/versions/<job>/<time>-<reason>.json`.
 */
const BUCKET = 'generated-assets'
export const KEEP_VERSIONS = 30
export type VersionReason = 'manual' | 'auto' | 'before-restore' | 'conflict'
export type VersionInfo = { path: string; at: number; reason: VersionReason; bytes: number }
const folder = (owner: string, projectId: string, jobId: string) => `${owner}/${projectId}/versions/${jobId}`
export const REASON_LABELS: Record<VersionReason, string> = { manual: 'Guardado a mano', auto: 'Automático', 'before-restore': 'Antes de restaurar', conflict: 'Tu versión en un conflicto' }

export async function saveVersion(db: SupabaseClient, p: { owner: string; projectId: string; jobId: string; composition: Composition; reason: VersionReason }) {
  const path = `${folder(p.owner, p.projectId, p.jobId)}/${Date.now()}-${p.reason}.json`
  const body = new Blob([JSON.stringify(p.composition)], { type: 'application/json' })
  const { error } = await db.storage.from(BUCKET).upload(path, body, { contentType: 'application/json', upsert: false })
  if (error) throw new Error(error.message)
  void pruneVersions(db, p).catch(() => undefined)
  return path
}

export async function listVersions(db: SupabaseClient, p: { owner: string; projectId: string; jobId: string }): Promise<VersionInfo[]> {
  const dir = folder(p.owner, p.projectId, p.jobId)
  const { data, error } = await db.storage.from(BUCKET).list(dir, { limit: 200, sortBy: { column: 'name', order: 'desc' } })
  if (error) throw new Error(error.message)
  return (data ?? []).flatMap(f => {
    const m = /^(\d+)-([a-z-]+)\.json$/.exec(f.name)
    return m ? [{ path: `${dir}/${f.name}`, at: Number(m[1]), reason: (m[2] as VersionReason), bytes: Number((f.metadata as { size?: number } | null)?.size ?? 0) }] : []
  }).sort((a, b) => b.at - a.at)
}

export async function loadVersion(db: SupabaseClient, path: string): Promise<Composition | null> {
  const { data, error } = await db.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(error?.message ?? 'No se pudo leer el punto de recuperación.')
  return parseComposition(JSON.parse(await data.text()))
}

async function pruneVersions(db: SupabaseClient, p: { owner: string; projectId: string; jobId: string }) {
  const all = await listVersions(db, p)
  const old = all.slice(KEEP_VERSIONS).map(v => v.path)
  if (old.length) await db.storage.from(BUCKET).remove(old)
}
