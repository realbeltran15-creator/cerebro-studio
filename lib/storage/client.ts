'use client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MULTIPART_MIN_BYTES } from './constants'

/**
 * Browser upload to the configured cloud storage. Large files go straight to Cloudflare R2 with a
 * presigned URL (they never pass through the app server); without R2 they go to Supabase Storage.
 */
export async function uploadToCloud(supabase: SupabaseClient, input: { projectId: string; folder: 'renders' | 'uploads' | 'subtitles' | 'auto-edit'; ext: string; name?: string; body: Blob; contentType: string; onProgress?: (fraction: number) => void }) {
  // A big upload that was interrupted continues at the same place (same file, same destination), without asking for a new one.
  const rk = resumeKey(input)
  const prior = input.body.size >= MULTIPART_MIN_BYTES ? readSaved(rk) : null
  if (prior?.storagePath) { await multipartUpload(input.body, prior.storagePath, input.contentType.split(';')[0], input.onProgress, rk); return prior.storagePath }
  const r = await fetch('/api/storage/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: input.projectId, folder: input.folder, ext: input.ext, name: input.name, contentType: input.contentType.split(';')[0], size: input.body.size }) })
  const target = await r.json().catch(() => ({})) as { driver?: 'r2' | 'supabase'; storagePath?: string; uploadUrl?: string; multipart?: boolean; maxBytes?: number; error?: string }
  if (!r.ok || !target.storagePath) throw new Error(target.error ?? 'No se pudo preparar la subida.')
  const mb = Math.round(input.body.size / 1048576)
  if (target.driver === 'r2' && target.multipart) { await multipartUpload(input.body, target.storagePath, input.contentType.split(';')[0], input.onProgress, rk); return target.storagePath }
  if (target.driver === 'r2' && !target.uploadUrl) throw new Error(target.error ?? 'No se pudo preparar la subida a la nube.')
  if (target.driver === 'r2' && target.uploadUrl) {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', target.uploadUrl!)
      xhr.setRequestHeader('Content-Type', input.contentType.split(';')[0])
      xhr.upload.onprogress = e => { if (e.lengthComputable) input.onProgress?.(e.loaded / e.total) }
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`La nube rechazó la subida (${xhr.status}). Revisa la configuración CORS del bucket R2.`)))
      xhr.onerror = () => reject(new Error('No se pudo subir a la nube. Revisa la conexión y la configuración CORS del bucket R2.'))
      xhr.send(input.body)
    })
    return target.storagePath
  }
  if (target.maxBytes && input.body.size > target.maxBytes) throw new Error(`El archivo pesa ${mb} MB y el almacenamiento gratuito de Supabase admite ${Math.round(target.maxBytes / 1048576)} MB por archivo. Configura Cloudflare R2 (10 GB gratis) para archivos grandes.`)
  const { error } = await supabase.storage.from('generated-assets').upload(target.storagePath, input.body, { contentType: input.contentType, upsert: false })
  if (error) throw new Error(`No se pudo subir el archivo (${mb} MB): ${error.message}`)
  input.onProgress?.(1)
  return target.storagePath
}

export async function removeFromCloud(storagePath: string) {
  const r = await fetch('/api/storage/object', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath }) })
  if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; throw new Error(j.error ?? 'No se pudo borrar el archivo.') }
}

// ---------------------------------------------------------------- resumable uploads (R2 multipart)
type Saved = { uploadId: string; partBytes: number; storagePath?: string }
const resumeKey = (i: { projectId: string; folder: string; name?: string; body: Blob }) => `cerebro-mpu:${i.projectId}:${i.folder}:${i.name ?? ''}:${(i.body as File).name ?? ''}:${i.body.size}:${(i.body as File).lastModified ?? 0}`
const readSaved = (k: string): Saved | null => { try { const v = JSON.parse(localStorage.getItem(k) ?? 'null'); return v && typeof v.uploadId === 'string' ? v : null } catch { return null } }
const writeSaved = (k: string, v: Saved | null) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k) } catch { /* private mode: it just will not resume */ } }

async function mp<T>(body: Record<string, unknown>): Promise<{ status: number; json: T & { error?: string } }> {
  const r = await fetch('/api/storage/multipart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

function putPart(url: string, body: Blob, onBytes: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onBytes(e.loaded) }
    xhr.onload = () => { const etag = xhr.getResponseHeader('ETag'); if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag); else reject(new Error(xhr.status >= 200 && xhr.status < 300 ? 'La nube no devolvió el ETag: añade ETag a ExposeHeaders en la configuración CORS del bucket R2.' : `La nube rechazó una parte (${xhr.status}).`)) }
    xhr.onerror = () => reject(new Error('Se cortó la conexión subiendo una parte.'))
    xhr.send(body)
  })
}

/**
 * Uploads a big file in parts of 32 MiB. Each part is retried; if the browser is closed or the connection drops, running the same upload
 * again (same file) asks R2 which parts it already has and sends only the rest.
 */
export async function multipartUpload(file: Blob, storagePath: string, contentType: string, onProgress: ((fraction: number) => void) | undefined, key: string) {
  let saved = readSaved(key)
  let done = new Map<number, string>()
  if (saved) {
    const st = await mp<{ done?: Array<{ partNumber: number; etag: string; size: number }> }>({ action: 'status', storagePath, uploadId: saved.uploadId })
    if (st.status === 404) saved = null
    else if (st.status !== 200) throw new Error(st.json.error ?? 'No se pudo consultar la subida anterior.')
    else done = new Map((st.json.done ?? []).filter(p => p.size === Math.min(saved!.partBytes, file.size - (p.partNumber - 1) * saved!.partBytes)).map(p => [p.partNumber, p.etag]))
  }
  if (!saved) {
    const c = await mp<Saved & { parts: number }>({ action: 'create', storagePath, contentType, size: file.size })
    if (c.status !== 200 || !c.json.uploadId) throw new Error(c.json.error ?? 'No se pudo iniciar la subida.')
    saved = { uploadId: c.json.uploadId, partBytes: c.json.partBytes, storagePath }
    writeSaved(key, saved)
  }
  const { uploadId, partBytes } = saved
  const parts = Math.max(1, Math.ceil(file.size / partBytes))
  const sent = new Map<number, number>()
  const report = () => { let b = 0; for (let i = 1; i <= parts; i++) b += done.has(i) ? Math.min(partBytes, file.size - (i - 1) * partBytes) : sent.get(i) ?? 0; onProgress?.(Math.min(1, b / file.size)) }
  report()
  for (let n = 1; n <= parts; n++) {
    if (done.has(n)) continue
    const blob = file.slice((n - 1) * partBytes, Math.min(file.size, n * partBytes))
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const u = await mp<{ url?: string }>({ action: 'part-url', storagePath, uploadId, partNumber: n, bytes: blob.size })
        if (u.status !== 200 || !u.json.url) throw new Error(u.json.error ?? 'No se pudo firmar una parte.')
        done.set(n, await putPart(u.json.url, blob, loaded => { sent.set(n, loaded); report() }))
        sent.delete(n); lastError = null; break
      } catch (e) { lastError = e; sent.delete(n); await new Promise(r => setTimeout(r, 800 * 2 ** attempt)) }
    }
    if (lastError) throw lastError instanceof Error ? lastError : new Error('No se pudo subir una parte.')
    report()
  }
  const fin = await mp<{ ok?: boolean }>({ action: 'complete', storagePath, uploadId, parts: [...done].map(([partNumber, etag]) => ({ partNumber, etag })) })
  if (fin.status !== 200) throw new Error(fin.json.error ?? 'No se pudo terminar la subida.')
  writeSaved(key, null)
  onProgress?.(1)
}

/** Cancels a started multipart upload (frees the space of its parts) and forgets it. */
export async function abortMultipartUpload(input: { projectId: string; folder: string; name?: string; body: Blob }) {
  const key = resumeKey(input), s = readSaved(key)
  if (!s?.storagePath) return
  await mp({ action: 'abort', storagePath: s.storagePath, uploadId: s.uploadId }).catch(() => undefined)
  writeSaved(key, null)
}
