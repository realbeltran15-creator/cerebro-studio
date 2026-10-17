import type { SupabaseClient } from '@supabase/supabase-js'
import { presignUrl } from './s3-presign'

/**
 * Cloud storage for every file the studio creates. Two drivers behind one interface:
 *  - Cloudflare R2 (when R2_* is configured): 10 GB-month free, free egress, objects up to ~5 TB.
 *    Stored paths are prefixed `r2:` so existing Supabase files keep working.
 *  - Supabase Storage bucket `generated-assets` (default): Free plan caps files at 50 MB and 1 GB total.
 * Keys always start with the owner's user id; callers must check ownership before signing.
 */
export const BUCKET = 'generated-assets'
export const R2_PREFIX = 'r2:'

const env = () => ({
  account: process.env.R2_ACCOUNT_ID?.trim() ?? '',
  key: process.env.R2_ACCESS_KEY_ID?.trim() ?? '',
  secret: process.env.R2_SECRET_ACCESS_KEY?.trim() ?? '',
  bucket: process.env.R2_BUCKET?.trim() ?? '',
})
export const r2Configured = () => { const e = env(); return Boolean(e.account && e.key && e.secret && e.bucket) }
export const storageDriver = (): 'r2' | 'supabase' => (r2Configured() ? 'r2' : 'supabase')
export const isR2Path = (p: string) => p.startsWith(R2_PREFIX)
export const r2Key = (p: string) => p.slice(R2_PREFIX.length)

/** Owner of a stored path: the first folder of the key. */
export const ownerOfPath = (p: string) => (isR2Path(p) ? r2Key(p) : p).split('/')[0] ?? ''

export function r2Url(method: 'GET' | 'PUT' | 'DELETE' | 'HEAD', key: string, expiresSeconds = 300, contentType?: string) {
  const e = env()
  if (!r2Configured()) throw new Error('Cloudflare R2 no está configurado.')
  return presignUrl({ method, host: `${e.account}.r2.cloudflarestorage.com`, path: `/${e.bucket}/${key}`, accessKeyId: e.key, secretAccessKey: e.secret, region: 'auto', expiresSeconds, contentType })
}

/**
 * The R2 credentials bypass database RLS, so every read/write/delete checks that the stored path
 * belongs to the caller (first folder = user id) and has no traversal or empty segments. An asset row
 * pointing at someone else's key is therefore useless.
 */
export function assertOwnPath(storagePath: string, ownerId: string) {
  const key = isR2Path(storagePath) ? r2Key(storagePath) : storagePath
  const parts = key.split('/')
  if (!ownerId || parts[0] !== ownerId || parts.length < 2 || parts.some(p => !p || p === '.' || p === '..') || /[\\\u0000-\u001f]/.test(key)) throw new Error('Archivo no válido para este usuario.')
  return key
}

/** Short-lived URL to read a stored file (private on both drivers). */
export async function signedReadUrl(db: SupabaseClient, ownerId: string, storagePath: string, expiresSeconds = 300) {
  assertOwnPath(storagePath, ownerId)
  if (isR2Path(storagePath)) return r2Url('GET', r2Key(storagePath), expiresSeconds)
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(storagePath, expiresSeconds)
  if (error || !data?.signedUrl) throw new Error('No se pudo crear el enlace de acceso al archivo.')
  return data.signedUrl
}

export async function downloadObject(db: SupabaseClient, ownerId: string, storagePath: string): Promise<Blob> {
  assertOwnPath(storagePath, ownerId)
  if (isR2Path(storagePath)) {
    const r = await fetch(r2Url('GET', r2Key(storagePath), 600), { cache: 'no-store' })
    if (!r.ok) throw new Error(`No se pudo leer el archivo de la nube (${r.status}).`)
    return await r.blob()
  }
  const { data, error } = await db.storage.from(BUCKET).download(storagePath)
  if (error || !data) throw new Error('No se pudo leer el archivo del almacenamiento.')
  return data
}

/** Stores bytes under `key` (must start with the owner id) and returns the storage_path to save. */
export async function putObject(db: SupabaseClient, ownerId: string, key: string, body: Blob | Buffer | Uint8Array, contentType: string) {
  assertOwnPath(key, ownerId)
  if (r2Configured()) {
    const payload = body instanceof Blob ? body : new Blob([new Uint8Array(body)], { type: contentType })
    const r = await fetch(r2Url('PUT', key, 900, contentType), { method: 'PUT', headers: { 'Content-Type': contentType }, body: payload })
    if (!r.ok) throw new Error(`No se pudo guardar el archivo en la nube (${r.status}).`)
    return `${R2_PREFIX}${key}`
  }
  const { error } = await db.storage.from(BUCKET).upload(key, body, { contentType, upsert: false })
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`)
  return key
}

export async function removeObject(db: SupabaseClient, ownerId: string, storagePath: string) {
  assertOwnPath(storagePath, ownerId)
  if (isR2Path(storagePath)) {
    const r = await fetch(r2Url('DELETE', r2Key(storagePath), 300), { method: 'DELETE' })
    if (!r.ok && r.status !== 404) throw new Error(`No se pudo borrar el archivo de la nube (${r.status}).`)
    return
  }
  const { error } = await db.storage.from(BUCKET).remove([storagePath])
  if (error) throw new Error(`No se pudo borrar el archivo: ${error.message}`)
}
