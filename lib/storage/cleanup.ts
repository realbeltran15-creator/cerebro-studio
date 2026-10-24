import type { SupabaseClient } from '@supabase/supabase-js'
import { r2Configured, r2Key, r2Url, R2_PREFIX } from './server'

/**
 * Safe clean-up of R2 leftovers: files nobody refers to (an upload that never got its Library entry) and multipart uploads that were abandoned
 * (R2 keeps charging their parts' storage until they are aborted). Nothing is ever removed by looking at the clock alone:
 *   - a file is an orphan only when NO asset row of this user points at it, it is older than a day (an upload may still be about to get its row),
 *     and it is not under `versions/` (recovery points);
 *   - the delete action removes only the keys the same check lists again at that moment, never an arbitrary key sent by the browser.
 */
export const ORPHAN_MIN_AGE_MS = 24 * 3600_000
export const STALE_UPLOAD_MS = 7 * 24 * 3600_000
export type Orphan = { key: string; bytes: number; modifiedAt: string }
export type StaleUpload = { key: string; uploadId: string; initiatedAt: string }
export type CleanupReport = { orphans: Orphan[]; staleUploads: StaleUpload[]; referenced: number; objects: number; orphanBytes: number }

const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const MAX_PAGES = 200

async function listObjects(ownerId: string) {
  const out: Array<{ key: string; bytes: number; modifiedAt: string }> = []
  let token = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await fetch(r2Url('GET', '', 300, undefined, undefined, { 'list-type': '2', prefix: `${ownerId}/`, ...(token ? { 'continuation-token': token } : {}) }), { cache: 'no-store' })
    const text = await r.text()
    if (!r.ok) throw new Error(`No se pudo listar el almacenamiento (${r.status}).`)
    for (const m of text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([^<]*)<\/Key>/.exec(m[1])?.[1], bytes = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1]), at = /<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1]
      if (key && at) out.push({ key: unxml(key), bytes: bytes || 0, modifiedAt: at })
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(text)) break
    token = unxml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(text)?.[1] ?? '')
    if (!token) break
  }
  return out
}

async function listUploads(ownerId: string) {
  const out: StaleUpload[] = []
  let keyMarker = '', idMarker = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await fetch(r2Url('GET', '', 300, undefined, undefined, { uploads: '', prefix: `${ownerId}/`, ...(keyMarker ? { 'key-marker': keyMarker, 'upload-id-marker': idMarker } : {}) }), { cache: 'no-store' })
    const text = await r.text()
    if (!r.ok) throw new Error(`No se pudieron listar las subidas pendientes (${r.status}).`)
    for (const m of text.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)) {
      const key = /<Key>([^<]*)<\/Key>/.exec(m[1])?.[1], id = /<UploadId>([^<]+)<\/UploadId>/.exec(m[1])?.[1], at = /<Initiated>([^<]+)<\/Initiated>/.exec(m[1])?.[1]
      if (key && id && at) out.push({ key: unxml(key), uploadId: unxml(id), initiatedAt: at })
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(text)) break
    keyMarker = unxml(/<NextKeyMarker>([^<]*)<\/NextKeyMarker>/.exec(text)?.[1] ?? ''); idMarker = unxml(/<NextUploadIdMarker>([^<]*)<\/NextUploadIdMarker>/.exec(text)?.[1] ?? '')
    if (!keyMarker && !idMarker) break
  }
  return out
}

async function referencedKeys(db: SupabaseClient, ownerId: string) {
  const keys = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('assets').select('storage_path').eq('owner_id', ownerId).like('storage_path', `${R2_PREFIX}%`).range(from, from + 999)
    if (error) throw new Error('No se pudo leer la Biblioteca; no se limpia nada.')
    for (const r of (data ?? []) as Array<{ storage_path: string | null }>) if (r.storage_path) keys.add(r2Key(r.storage_path))
    if ((data ?? []).length < 1000) break
  }
  return keys
}

export async function cleanupReport(db: SupabaseClient, ownerId: string, now = Date.now()): Promise<CleanupReport> {
  if (!r2Configured()) throw new Error('Cloudflare R2 no está configurado.')
  if (!ownerId) throw new Error('Sin usuario.')
  // The Library is read FIRST: an upload that finishes while this runs gets its row after, and is then too recent to count as an orphan anyway.
  const refs = await referencedKeys(db, ownerId)
  const [objects, uploads] = await Promise.all([listObjects(ownerId), listUploads(ownerId)])
  const orphans = objects.filter(o => !refs.has(o.key) && !o.key.startsWith(`${ownerId}/versions/`) && now - Date.parse(o.modifiedAt) >= ORPHAN_MIN_AGE_MS && o.key.split('/').length >= 2)
  const staleUploads = uploads.filter(u => now - Date.parse(u.initiatedAt) >= STALE_UPLOAD_MS)
  return { orphans, staleUploads, referenced: refs.size, objects: objects.length, orphanBytes: orphans.reduce((n, o) => n + o.bytes, 0) }
}

/** Deletes the requested orphans and aborts the requested stale uploads, but only those that the report lists right now. */
export async function cleanupDelete(db: SupabaseClient, ownerId: string, want: { keys?: string[]; uploads?: Array<{ key: string; uploadId: string }> }, now = Date.now()) {
  const report = await cleanupReport(db, ownerId, now)
  const okKeys = new Set(report.orphans.map(o => o.key)), okUp = new Set(report.staleUploads.map(u => `${u.key}\n${u.uploadId}`))
  let deleted = 0, freed = 0, aborted = 0
  const skipped: string[] = []
  for (const key of want.keys ?? []) {
    if (!okKeys.has(key)) { skipped.push(key); continue }
    const r = await fetch(r2Url('DELETE', key, 300), { method: 'DELETE' })
    if (r.ok || r.status === 404) { deleted++; freed += report.orphans.find(o => o.key === key)?.bytes ?? 0 } else skipped.push(key)
  }
  for (const u of want.uploads ?? []) {
    if (!okUp.has(`${u.key}\n${u.uploadId}`)) { skipped.push(u.key); continue }
    const r = await fetch(r2Url('DELETE', u.key, 300, undefined, undefined, { uploadId: u.uploadId }), { method: 'DELETE' })
    if (r.ok || r.status === 404) aborted++; else skipped.push(u.key)
  }
  return { deleted, freedBytes: freed, aborted, skipped }
}
