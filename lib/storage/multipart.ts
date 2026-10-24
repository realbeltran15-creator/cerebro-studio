import { assertOwnPath, r2Configured, r2Url } from './server'

/**
 * Resumable large uploads to Cloudflare R2 (S3 multipart), driven by the server so the secret keys never reach the browser:
 * the server creates/completes/aborts the upload and signs one short-lived URL per part; the browser PUTs each part straight to R2.
 * Parts that already arrived can be listed, so an interrupted upload continues where it stopped (even after closing the browser).
 */
export { PART_BYTES, MULTIPART_MIN_BYTES, MAX_PARTS } from './constants'
import { MAX_PARTS, PART_BYTES } from './constants'

export type PartInfo = { partNumber: number; etag: string; size: number }
const xmlText = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const partCount = (bytes: number) => Math.max(1, Math.ceil(bytes / PART_BYTES))

function guard(ownerId: string, key: string) {
  if (!r2Configured()) throw new Error('Cloudflare R2 no está configurado.')
  return assertOwnPath(key, ownerId)
}

export async function createMultipart(ownerId: string, key: string, contentType: string): Promise<string> {
  const k = guard(ownerId, key)
  const r = await fetch(r2Url('POST', k, 300, contentType, undefined, { uploads: '' }), { method: 'POST', headers: { 'Content-Type': contentType } })
  const text = await r.text()
  const id = /<UploadId>([^<]+)<\/UploadId>/.exec(text)?.[1]
  if (!r.ok || !id) throw new Error(`No se pudo iniciar la subida (${r.status}).`)
  return xmlText(id)
}

/** URL for one part. The part's exact size is signed in, so a client cannot send more than it declared. */
export function partUrl(ownerId: string, key: string, uploadId: string, partNumber: number, bytes: number) {
  const k = guard(ownerId, key)
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) throw new Error('Número de parte no válido.')
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > PART_BYTES) throw new Error('Tamaño de parte no válido.')
  return r2Url('PUT', k, 3600, undefined, bytes, { partNumber: String(partNumber), uploadId })
}

export async function listParts(ownerId: string, key: string, uploadId: string): Promise<PartInfo[]> {
  const k = guard(ownerId, key)
  const out: PartInfo[] = []
  let marker = '0'
  for (let page = 0; page < 20; page++) {
    const r = await fetch(r2Url('GET', k, 300, undefined, undefined, { uploadId, 'part-number-marker': marker }), { cache: 'no-store' })
    const text = await r.text()
    if (r.status === 404 || /<Code>NoSuchUpload<\/Code>/.test(text)) throw new Error('NoSuchUpload')
    if (!r.ok) throw new Error(`No se pudo consultar la subida (${r.status}).`)
    for (const m of text.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
      const n = Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(m[1])?.[1]), etag = /<ETag>([^<]+)<\/ETag>/.exec(m[1])?.[1], size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1])
      if (n && etag) out.push({ partNumber: n, etag: xmlText(etag), size })
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(text)) break
    marker = /<NextPartNumberMarker>(\d+)<\/NextPartNumberMarker>/.exec(text)?.[1] ?? marker
  }
  return out
}

export async function completeMultipart(ownerId: string, key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>) {
  const k = guard(ownerId, key)
  if (!parts.length) throw new Error('No hay partes que unir.')
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  const body = `<CompleteMultipartUpload>${sorted.map(p => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEsc(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
  const r = await fetch(r2Url('POST', k, 300, 'application/xml', undefined, { uploadId }), { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body })
  const text = await r.text()
  // S3 may answer 200 with an error document.
  if (!r.ok || /<Error>/.test(text)) throw new Error(`No se pudo terminar la subida (${r.status}${/<Code>([^<]+)<\/Code>/.exec(text) ? `: ${/<Code>([^<]+)<\/Code>/.exec(text)![1]}` : ''}).`)
}

export async function abortMultipart(ownerId: string, key: string, uploadId: string) {
  const k = guard(ownerId, key)
  const r = await fetch(r2Url('DELETE', k, 300, undefined, undefined, { uploadId }), { method: 'DELETE' })
  if (!r.ok && r.status !== 404) throw new Error(`No se pudo cancelar la subida (${r.status}).`)
}
