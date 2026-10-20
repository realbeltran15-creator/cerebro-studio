import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitizeBrief } from './store'
import type { CampaignStatus, SavedCampaign } from './types'

/**
 * Server-side copy of the campaigns in the `campaigns` table (migration 20261015120000, owner RLS).
 * Until that migration is applied the table does not exist: every call then reports 'unavailable' and the page keeps working
 * exactly as before, from this browser only. Nothing here publishes ads or spends money.
 *
 * Sync model (single owner, a few devices):
 * - Union by id; for the same campaign the newer `updatedAt` wins.
 * - A campaign that this browser already synced and that is no longer in the cloud was deleted on another device: it is dropped
 *   here too instead of being uploaded again. `syncedIds` remembers which ids have been in the cloud.
 * - Deleting here deletes the row as well.
 */
export const SYNCED_KEY = 'cerebro.campaigns.synced.v1'
export const CLOUD_MAX = 200
export type CloudState = 'local' | 'syncing' | 'synced' | 'unavailable' | 'error'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: string) => UUID.test(v)
const STATUSES: readonly CampaignStatus[] = ['borrador', 'lista', 'archivada']
const t = (s: string) => Date.parse(s) || 0

export type CampaignRow = { id: string; owner_id?: string; name: string; status: CampaignStatus; brief: unknown; notes: string; project_id: string | null; created_at: string; updated_at: string }

/** Table rows use uuid ids. Older campaigns created with `cmp_…` ids get a uuid once, before their first upload. */
export function withUuidIds(list: SavedCampaign[], uuid: () => string): { list: SavedCampaign[]; renamed: Record<string, string> } {
  const renamed: Record<string, string> = {}
  const out = list.map(c => { if (isUuid(c.id)) return c; const id = uuid(); renamed[c.id] = id; return { ...c, id } })
  return { list: out, renamed }
}

export function toRow(c: SavedCampaign, owner: string, projectIds: ReadonlySet<string>): CampaignRow {
  const p = c.brief.projectId
  return {
    id: c.id, owner_id: owner, name: (c.brief.name || c.brief.subjectName || '').slice(0, 200), status: c.status, brief: c.brief, notes: c.notes.slice(0, 4000),
    // The policy only accepts a project of the same owner; an unknown or deleted project is left unlinked rather than failing the save.
    project_id: p && isUuid(p) && projectIds.has(p) ? p : null,
    created_at: c.createdAt || new Date().toISOString(), updated_at: c.updatedAt || new Date().toISOString(),
  }
}

export function fromRow(r: CampaignRow): SavedCampaign | null {
  if (!r || typeof r.id !== 'string' || !isUuid(r.id)) return null
  return { id: r.id, brief: sanitizeBrief(r.brief), status: STATUSES.includes(r.status) ? r.status : 'borrador', notes: typeof r.notes === 'string' ? r.notes.slice(0, 2000) : '', createdAt: String(r.created_at ?? ''), updatedAt: String(r.updated_at ?? '') }
}

/** Merge result: the list to show, and the campaigns that must be uploaded because this browser has the newer (or only) copy. */
export function mergeCampaigns(local: SavedCampaign[], remote: SavedCampaign[], synced: ReadonlySet<string>): { list: SavedCampaign[]; upload: SavedCampaign[] } {
  const byId = new Map(remote.map(c => [c.id, c]))
  const upload: SavedCampaign[] = []
  for (const c of local) {
    const r = byId.get(c.id)
    if (!r) { if (!synced.has(c.id)) { byId.set(c.id, c); upload.push(c) } continue }
    if (t(c.updatedAt) > t(r.updatedAt)) { byId.set(c.id, c); upload.push(c) }
  }
  const list = [...byId.values()].sort((a, b) => t(b.updatedAt) - t(a.updatedAt))
  return { list, upload }
}

/** Campaigns whose content changed since the last successful save (compared by updatedAt). */
export function changedSince(list: SavedCampaign[], saved: ReadonlyMap<string, string>): SavedCampaign[] {
  return list.filter(c => saved.get(c.id) !== c.updatedAt)
}

/** PostgREST answers PGRST205 (or Postgres 42P01) while the table does not exist yet. */
export function tableMissing(e: { code?: string; message?: string } | null | undefined) {
  return !!e && (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|relation .* does not exist/i.test(e.message ?? ''))
}

export class CloudUnavailable extends Error {}

export async function loadCloud(db: SupabaseClient): Promise<SavedCampaign[]> {
  const { data, error } = await db.from('campaigns').select('id,name,status,brief,notes,project_id,created_at,updated_at').order('updated_at', { ascending: false }).limit(CLOUD_MAX)
  if (tableMissing(error)) throw new CloudUnavailable('La tabla de campañas aún no existe.')
  if (error) throw new Error(error.message)
  return (data as CampaignRow[] ?? []).flatMap(r => { const c = fromRow(r); return c ? [c] : [] })
}

export async function saveCloud(db: SupabaseClient, items: SavedCampaign[], projectIds: ReadonlySet<string>) {
  if (!items.length) return
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('Sin sesión')
  const { error } = await db.from('campaigns').upsert(items.map(c => toRow(c, user.id, projectIds)), { onConflict: 'id' })
  if (tableMissing(error)) throw new CloudUnavailable('La tabla de campañas aún no existe.')
  if (error) throw new Error(error.message)
}

export async function deleteCloud(db: SupabaseClient, id: string) {
  if (!isUuid(id)) return
  const { error } = await db.from('campaigns').delete().eq('id', id)
  if (tableMissing(error)) throw new CloudUnavailable('La tabla de campañas aún no existe.')
  if (error) throw new Error(error.message)
}

type Store = Pick<Storage, 'getItem' | 'setItem'>
export function loadSynced(s: Store | null): Set<string> {
  try { const v = JSON.parse(s?.getItem(SYNCED_KEY) ?? '[]') as unknown; return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && isUuid(x)) : []) } catch { return new Set() }
}
export function saveSynced(s: Store | null, ids: Iterable<string>) { try { s?.setItem(SYNCED_KEY, JSON.stringify([...ids])) } catch { /* best effort */ } }
