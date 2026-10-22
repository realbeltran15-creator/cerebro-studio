'use client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mediaDuration, type UploadKind } from '@/lib/media-upload'
import { classify, contentFingerprint, fingerprintKey, formatBytes } from './files'
import { tusDiscard, tusUpload } from './tus'

/**
 * One file into Cerebro Studio, from any source (this device, an iPhone through Safari, Google Drive):
 * check type and size → content fingerprint → duplicate check → resumable upload of the ORIGINAL bytes → asset row
 * (in a project, or in the general Library with no project). Nothing is compressed or converted.
 */
export type Destination = 'library' | string
export type Source = 'device' | 'drive'
export type IngestResult = { status: 'uploaded'; assetId: string; resumedFrom: number } | { status: 'duplicate'; assetId: string }

export class IngestError extends Error { constructor(message: string, public readonly retryable = false) { super(message) } }

const SUPABASE_URL = () => (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

const checkAbort = (s?: AbortSignal) => { if (s?.aborted) throw new DOMException('Cancelado', 'AbortError') }

export async function findDuplicate(db: SupabaseClient, fp: string): Promise<string | null> {
  const { data } = await db.from('assets').select('id').eq('provenance->>contentFingerprint', fp).limit(1)
  return (data?.[0] as { id: string } | undefined)?.id ?? null
}

export async function ingestFile(db: SupabaseClient, file: File, o: {
  destination: Destination; source: Source; kind?: UploadKind; allowDuplicate?: boolean
  onProgress?: (sent: number, total: number) => void; onStage?: (s: string) => void; signal?: AbortSignal
  extra?: Record<string, unknown>
}): Promise<IngestResult> {
  const c = classify(file.name, file.type)
  if (!c.ok) throw new IngestError(c.reason)
  const kind = o.kind ?? c.kind
  const { data: { session } } = await db.auth.getSession()
  if (!session) throw new IngestError('La sesión ha caducado: vuelve a entrar.')
  o.onStage?.('Comprobando…')
  const fp = await contentFingerprint(file)
  checkAbort(o.signal)
  if (!o.allowDuplicate) { const dup = await findDuplicate(db, fp); if (dup) return { status: 'duplicate', assetId: dup } }
  checkAbort(o.signal)
  // The stored name comes from the fingerprint: choosing the same file again resumes the same upload instead of creating another.
  const r = await fetch('/api/storage/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: o.signal, body: JSON.stringify({ projectId: o.destination, folder: 'uploads', ext: c.ext, name: fp.slice(0, 40), contentType: c.mime, size: file.size }) })
  const target = await r.json().catch(() => ({})) as { driver?: 'r2' | 'supabase'; storagePath?: string; uploadUrl?: string; maxBytes?: number; error?: string }
  if (!r.ok || !target.storagePath) throw new IngestError(target.error ?? 'No se pudo preparar la subida.', r.status >= 500)
  if (target.maxBytes && file.size > target.maxBytes) throw new IngestError(`Pesa ${formatBytes(file.size)} y el almacenamiento actual admite ${formatBytes(target.maxBytes)} por archivo (Supabase gratuito). Recórtalo en el iPhone (Fotos › Editar) o activa un almacenamiento mayor.`)
  const durationSeconds = kind === 'image' ? null : await mediaDuration(file).catch(() => null)
  checkAbort(o.signal)
  let storagePath = target.storagePath
  let resumedFrom = 0
  o.onStage?.('Subiendo…')
  if (target.driver === 'r2' && target.uploadUrl) {
    await new Promise<void>((resolve, reject) => {
      const x = new XMLHttpRequest()
      x.open('PUT', target.uploadUrl!)
      x.setRequestHeader('Content-Type', c.mime)
      x.upload.onprogress = e => o.onProgress?.(e.loaded, file.size)
      x.onload = () => (x.status < 300 ? resolve() : reject(new IngestError(`La nube rechazó la subida (${x.status}).`, true)))
      x.onerror = () => reject(new IngestError('Se perdió la conexión.', true))
      x.onabort = () => reject(new DOMException('Cancelado', 'AbortError'))
      if (o.signal?.aborted) { reject(new DOMException('Cancelado', 'AbortError')); return }
      o.signal?.addEventListener('abort', () => x.abort(), { once: true })
      x.send(file)
    })
  } else {
    try {
      const up = await tusUpload(file, { endpoint: `${SUPABASE_URL()}/storage/v1/upload/resumable`, accessToken: session.access_token, apiKey: ANON(), bucket: 'generated-assets', path: target.storagePath, contentType: c.mime, fingerprint: `${fp}:${o.destination}`, onProgress: o.onProgress, signal: o.signal })
      storagePath = up.path; resumedFrom = up.resumedFrom
    } catch (e) {
      if ((e as Error).name === 'AbortError') { void tusDiscard(`${fp}:${o.destination}`, session.access_token, ANON()); throw e }
      // The same file finished uploading before but its row was never written (closed tab): register it now.
      if (!/Ya existe/.test((e as Error).message)) throw new IngestError((e as Error).message, true)
    }
  }
  o.onStage?.('Registrando…')
  const { data, error } = await db.from('assets').insert({
    owner_id: session.user.id, project_id: o.destination === 'library' ? null : o.destination, asset_type: kind, storage_path: storagePath,
    source_provider: o.source === 'drive' ? 'google-drive' : 'upload', license_status: 'owned',
    provenance: {
      title: file.name.replace(/\.[^.]+$/, '').slice(0, 160) || file.name, originalFilename: file.name.slice(0, 200), mimeType: c.mime, bytes: file.size, durationSeconds,
      contentFingerprint: fp, fingerprintKey: fingerprintKey(file.name, file.size), uploadedAt: new Date().toISOString(), uploadedFrom: o.source,
      // The bytes stored are exactly the file received: no compression or conversion by Cerebro Studio.
      original: true, ...(c.note ? { note: c.note } : {}), ...(o.extra ?? {}),
    },
  }).select('id').single()
  if (error) throw new IngestError(`Subido, pero no se pudo registrar: ${error.message}`, true)
  return { status: 'uploaded', assetId: (data as { id: string }).id, resumedFrom }
}
