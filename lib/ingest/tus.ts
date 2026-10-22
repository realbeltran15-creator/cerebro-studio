'use client'
/**
 * Resumable upload to Supabase Storage (TUS 1.0.0, the protocol Supabase implements at /storage/v1/upload/resumable).
 * - Chunks of exactly 6 MB (Supabase requirement), sent with XHR for real progress.
 * - Each chunk is retried with back-off; before retrying, the server's offset is asked (HEAD) so nothing is sent twice.
 * - The upload URL (not the file) is remembered in localStorage for 24 h, so a reload or a dropped mobile connection resumes
 *   where it stopped when the same file is chosen again. Nothing of the file is kept in the browser.
 * - Cancel aborts the transfer and asks the server to discard the partial upload.
 * The user's own session token is used, so the bucket's RLS (first folder = user id) still applies.
 */
export const TUS_CHUNK = 6 * 1024 * 1024
const KEY = 'cerebro-tus-v1'
const TTL = 24 * 3600 * 1000

type Saved = { url: string; path: string; at: number }
const readAll = (): Record<string, Saved> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Saved> } catch { return {} } }
const writeAll = (v: Record<string, Saved>) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode: resume just won't survive a reload */ } }
export function rememberUpload(fp: string, s: Saved) { const all = readAll(); for (const [k, v] of Object.entries(all)) if (Date.now() - v.at > TTL) delete all[k]; all[fp] = s; writeAll(all) }
export function recalledUpload(fp: string): Saved | null { const s = readAll()[fp]; return s && Date.now() - s.at < TTL ? s : null }
export function forgetUpload(fp: string) { const all = readAll(); delete all[fp]; writeAll(all) }

const b64 = (v: string) => btoa(unescape(encodeURIComponent(v)))
export const tusMetadata = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k} ${b64(v)}`).join(',')

export type TusOptions = {
  endpoint: string; accessToken: string; apiKey: string
  bucket: string; path: string; contentType: string; fingerprint: string
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
  retries?: number
}

function xhr(method: string, url: string, headers: Record<string, string>, body: Blob | null, signal?: AbortSignal, onUp?: (n: number) => void) {
  return new Promise<{ status: number; header: (h: string) => string | null }>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelado', 'AbortError')); return }
    const x = new XMLHttpRequest()
    x.open(method, url)
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
    if (onUp) x.upload.onprogress = e => onUp(e.loaded)
    x.onload = () => resolve({ status: x.status, header: h => x.getResponseHeader(h) })
    x.onerror = () => reject(new Error('network'))
    x.onabort = () => reject(new DOMException('Cancelado', 'AbortError'))
    signal?.addEventListener('abort', () => x.abort(), { once: true })
    x.send(body)
  })
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Cancelado', 'AbortError')) }, { once: true }) })

/** Uploads `file` and returns the stored path. Throws AbortError when cancelled. */
export async function tusUpload(file: Blob, o: TusOptions): Promise<{ path: string; resumedFrom: number }> {
  const base = { 'Tus-Resumable': '1.0.0', authorization: `Bearer ${o.accessToken}`, apikey: o.apiKey }
  let url: string | null = null
  let offset = 0
  let path = o.path
  const saved = recalledUpload(o.fingerprint)
  if (saved) {
    // Resume: ask the server how much it already has.
    const h = await xhr('HEAD', saved.url, base, null, o.signal).catch(() => null)
    const off = h && h.status < 300 ? Number(h.header('Upload-Offset')) : NaN
    if (Number.isFinite(off) && off <= file.size) { url = saved.url; offset = off; path = saved.path } else forgetUpload(o.fingerprint)
  }
  const resumedFrom = offset
  if (!url) {
    const r = await xhr('POST', o.endpoint, { ...base, 'Upload-Length': String(file.size), 'Upload-Metadata': tusMetadata({ bucketName: o.bucket, objectName: path, contentType: o.contentType, cacheControl: '3600' }), 'x-upsert': 'false' }, null, o.signal)
    if (r.status === 409) throw new Error('Ya existe un archivo con ese nombre en la nube.')
    if (r.status === 413) throw new Error('El archivo supera el tamaño máximo que admite el almacenamiento.')
    if (r.status >= 300 || !r.header('Location')) throw new Error(`La nube no aceptó la subida (${r.status}).`)
    const loc = r.header('Location')!
    url = /^https?:\/\//.test(loc) ? loc : new URL(loc, o.endpoint).toString()
    rememberUpload(o.fingerprint, { url, path, at: Date.now() })
  }
  o.onProgress?.(offset, file.size)
  const tries = o.retries ?? 4
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + TUS_CHUNK, file.size))
    let done = false
    for (let attempt = 0; attempt <= tries && !done; attempt++) {
      if (attempt > 0) {
        await wait(Math.min(15000, 1000 * 2 ** (attempt - 1)), o.signal)
        const h = await xhr('HEAD', url, base, null, o.signal).catch(() => null)
        const off = h && h.status < 300 ? Number(h.header('Upload-Offset')) : NaN
        if (Number.isFinite(off) && off !== offset) { offset = off; done = true; break }
      }
      try {
        const r = await xhr('PATCH', url, { ...base, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' }, chunk, o.signal, n => o.onProgress?.(offset + n, file.size))
        if (r.status === 204 || r.status === 200) { offset = Number(r.header('Upload-Offset')) || offset + chunk.size; done = true }
        else if (r.status === 409 || r.status === 404 || r.status === 410) { forgetUpload(o.fingerprint); throw new Error(`La subida caducó en la nube (${r.status}); vuelve a intentarlo.`) }
        else if (r.status === 413) throw new Error('El archivo supera el tamaño máximo que admite el almacenamiento.')
        else if (attempt === tries) throw new Error(`La nube respondió ${r.status}.`)
      } catch (e) {
        if ((e as Error).name === 'AbortError' || /caducó|supera|respondió/.test((e as Error).message)) throw e
        if (attempt === tries) throw new Error('Se perdió la conexión varias veces. Pulsa «Reintentar»: continuará donde se quedó.')
      }
    }
    o.onProgress?.(offset, file.size)
  }
  forgetUpload(o.fingerprint)
  return { path, resumedFrom }
}

/** Discards a partial upload on the server (best effort) and forgets it locally. */
export async function tusDiscard(fingerprint: string, accessToken: string, apiKey: string) {
  const s = recalledUpload(fingerprint)
  forgetUpload(fingerprint)
  if (s) await xhr('DELETE', s.url, { 'Tus-Resumable': '1.0.0', authorization: `Bearer ${accessToken}`, apikey: apiKey }, null).catch(() => undefined)
}
