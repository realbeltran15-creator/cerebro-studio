import type { SupabaseClient } from '@supabase/supabase-js'
import { originOf, type LibraryAsset } from './library'

/**
 * Organisation of the Biblioteca: the owner's own tags and collections, plus automatic tags derived from each file.
 * Stored in ONE connector_configs row per owner (provider 'cerebro-library', capability 'organization'; owner RLS), so it needs no
 * migration and never touches the assets themselves (their provenance and approval seals stay untouched).
 */
export type Collection = { id: string; name: string; assetIds: string[] }
export type LibraryOrg = { tags: Record<string, string[]>; collections: Collection[] }
export const EMPTY_ORG: LibraryOrg = { tags: {}, collections: [] }
const KEY = { provider: 'cerebro-library', capability: 'organization' } as const
const MAX_TAGS_PER_ASSET = 20, MAX_COLLECTIONS = 100, MAX_ASSETS_PER_COLLECTION = 2000

export function normalizeTag(raw: string) {
  return raw.normalize('NFC').trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 40)
}

/** Defensive parse of the stored row (it is user data). */
export function parseOrg(v: unknown): LibraryOrg {
  const o = (v && typeof v === 'object' ? v : {}) as { tags?: unknown; collections?: unknown }
  const tags: Record<string, string[]> = {}
  if (o.tags && typeof o.tags === 'object') for (const [id, list] of Object.entries(o.tags as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const clean = [...new Set(list.filter((t): t is string => typeof t === 'string').map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS_PER_ASSET)
    if (clean.length) tags[id] = clean
  }
  const collections = (Array.isArray(o.collections) ? o.collections : []).flatMap((c: unknown) => {
    const x = c as Partial<Collection>
    if (!x || typeof x.id !== 'string' || typeof x.name !== 'string' || !x.name.trim()) return []
    return [{ id: x.id, name: x.name.trim().slice(0, 80), assetIds: [...new Set((Array.isArray(x.assetIds) ? x.assetIds : []).filter((i): i is string => typeof i === 'string'))].slice(0, MAX_ASSETS_PER_COLLECTION) }]
  }).slice(0, MAX_COLLECTIONS)
  return { tags, collections }
}

export function addTag(org: LibraryOrg, assetId: string, raw: string): LibraryOrg {
  const tag = normalizeTag(raw)
  const current = org.tags[assetId] ?? []
  if (!tag || current.includes(tag) || current.length >= MAX_TAGS_PER_ASSET) return org
  return { ...org, tags: { ...org.tags, [assetId]: [...current, tag] } }
}
export function removeTag(org: LibraryOrg, assetId: string, tag: string): LibraryOrg {
  const next = (org.tags[assetId] ?? []).filter(t => t !== tag)
  const tags = { ...org.tags }
  if (next.length) tags[assetId] = next; else delete tags[assetId]
  return { ...org, tags }
}
export function createCollection(org: LibraryOrg, name: string, id: string): LibraryOrg {
  const n = name.trim().slice(0, 80)
  if (!n || org.collections.length >= MAX_COLLECTIONS || org.collections.some(c => c.name.toLowerCase() === n.toLowerCase())) return org
  return { ...org, collections: [...org.collections, { id, name: n, assetIds: [] }] }
}
export function toggleInCollection(org: LibraryOrg, collectionId: string, assetId: string): LibraryOrg {
  return { ...org, collections: org.collections.map(c => c.id !== collectionId ? c : c.assetIds.includes(assetId) ? { ...c, assetIds: c.assetIds.filter(i => i !== assetId) } : { ...c, assetIds: [...c.assetIds, assetId].slice(0, MAX_ASSETS_PER_COLLECTION) }) }
}
export function deleteCollection(org: LibraryOrg, collectionId: string): LibraryOrg {
  return { ...org, collections: org.collections.filter(c => c.id !== collectionId) }
}
/** Drops tags and collection entries of files that no longer exist (after a deletion). */
export function forgetAsset(org: LibraryOrg, assetId: string): LibraryOrg {
  const tags = { ...org.tags }; delete tags[assetId]
  return { tags, collections: org.collections.map(c => ({ ...c, assetIds: c.assetIds.filter(i => i !== assetId) })) }
}
export const allTags = (org: LibraryOrg) => [...new Set(Object.values(org.tags).flat())].sort((a, b) => a.localeCompare(b, 'es'))

/** Automatic organisation: tags computed from what the file is (never stored, always up to date). */
export function autoTags(a: LibraryAsset): string[] {
  const p = a.provenance ?? {}
  const out: string[] = []
  const origin = originOf(a)
  out.push(origin === 'generated' ? 'generado con IA' : origin === 'render' ? 'montaje' : origin === 'imported' ? 'importado' : 'subido')
  const format = typeof p.format === 'string' ? p.format : (p.options && typeof p.options === 'object' ? (p.options as Record<string, unknown>).format : null)
  if (format === '9:16') out.push('vertical'); else if (format === '16:9') out.push('horizontal'); else if (format === '1:1') out.push('cuadrado')
  const ms = typeof p.durationMs === 'number' ? p.durationMs : typeof p.durationSeconds === 'number' ? p.durationSeconds * 1000 : null
  if (ms !== null && ['video', 'voice', 'music', 'sfx'].includes(a.asset_type)) out.push(ms <= 60_000 ? 'corto (≤ 60 s)' : ms <= 600_000 ? 'medio (1–10 min)' : 'largo (> 10 min)')
  if (p.purpose === 'short' || (format === '9:16' && origin === 'render')) out.push('short')
  if (a.license_status === 'restricted' || a.license_status === 'unknown') out.push('licencia por revisar')
  if (typeof p.composedFrom === 'string' || Array.isArray(p.inputs)) out.push('derivado')
  if (p.conversion && typeof p.conversion === 'object') out.push('convertido')
  return out
}

/** Files related to `a`: what it was made from, what was made from it, and its transcript/source pair. */
export function relatedAssets(a: LibraryAsset, all: LibraryAsset[]) {
  const p = a.provenance ?? {}
  const idsFrom = new Set<string>([
    ...(Array.isArray(p.inputs) ? (p.inputs as Array<{ id?: unknown }>).map(i => (typeof i.id === 'string' ? i.id : '')) : []),
    typeof p.composedFrom === 'string' ? p.composedFrom : '', typeof p.sourceAssetId === 'string' ? p.sourceAssetId : '',
    p.conversion && typeof p.conversion === 'object' && typeof (p.conversion as Record<string, unknown>).sourceAssetId === 'string' ? String((p.conversion as Record<string, unknown>).sourceAssetId) : '',
  ].filter(Boolean))
  const madeFrom = all.filter(x => idsFrom.has(x.id))
  const derived = all.filter(x => {
    const q = x.provenance ?? {}
    return x.id !== a.id && ((Array.isArray(q.inputs) && (q.inputs as Array<{ id?: unknown }>).some(i => i.id === a.id)) || q.composedFrom === a.id || q.sourceAssetId === a.id
      || (q.conversion && typeof q.conversion === 'object' && (q.conversion as Record<string, unknown>).sourceAssetId === a.id))
  })
  return { madeFrom, derived }
}

export async function loadOrg(db: SupabaseClient): Promise<LibraryOrg> {
  const { data, error } = await db.from('connector_configs').select('config').eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  if (error) throw new Error(error.message)
  return parseOrg((data as { config?: unknown } | null)?.config)
}
export async function saveOrg(db: SupabaseClient, org: LibraryOrg) {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const { error } = await db.from('connector_configs').upsert({ owner_id: user.id, ...KEY, enabled: true, priority: 0, config: parseOrg(org), updated_at: new Date().toISOString() }, { onConflict: 'owner_id,provider,capability' })
  if (error) throw new Error(error.message)
}
