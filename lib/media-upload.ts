import type { SupabaseClient } from '@supabase/supabase-js'
import { removeFromCloud, uploadToCloud } from '@/lib/storage/client'

/** Client-side upload of user-provided media into the private generated-assets bucket plus an assets row. */

export type UploadKind = 'music' | 'sfx' | 'image' | 'video' | 'voice'
export type LicenseStatus = 'owned' | 'licensed' | 'public_domain' | 'restricted'

const limits: Record<UploadKind, { mime: RegExp; maxBytes: number }> = {
  music: { mime: /^audio\/(mpeg|mp3|wav|x-wav|wave|ogg|aac|mp4|x-m4a|flac|webm)$/, maxBytes: 50 * 1024 * 1024 },
  sfx: { mime: /^audio\/(mpeg|mp3|wav|x-wav|wave|ogg|aac|mp4|x-m4a|flac|webm)$/, maxBytes: 20 * 1024 * 1024 },
  voice: { mime: /^audio\/(mpeg|mp3|wav|x-wav|wave|ogg|aac|mp4|x-m4a|webm)$/, maxBytes: 50 * 1024 * 1024 },
  image: { mime: /^image\/(png|jpeg|webp)$/, maxBytes: 25 * 1024 * 1024 },
  video: { mime: /^video\/(mp4|webm|quicktime)$/, maxBytes: 50 * 1024 * 1024 },
}

export function validateUpload(kind: UploadKind, file: File) {
  const rule = limits[kind]
  if (!rule.mime.test(file.type)) return `Formato no admitido (${file.type || 'desconocido'}).`
  if (file.size > rule.maxBytes) return `El archivo supera ${Math.round(rule.maxBytes / 1048576)} MB.`
  return null
}

/** Reads duration from the browser's media decoder; null when it cannot be determined. */
export function mediaDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio')
    const url = URL.createObjectURL(file)
    const done = (value: number | null) => { URL.revokeObjectURL(url); resolve(value) }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : null)
    el.onerror = () => done(null)
    el.src = url
  })
}

const extFor = (file: File) => {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  return fromName && /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : 'bin'
}

export async function uploadProjectMedia(supabase: SupabaseClient, input: {
  projectId: string
  kind: UploadKind
  file: File
  title: string
  license: LicenseStatus
  sourceUrl?: string | null
  licenseNotes?: string | null
  /** Where the file comes from (default 'upload'); imports from a web app use their provider id. */
  provider?: string
  extra?: Record<string, unknown>
  onProgress?: (fraction: number) => void
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const problem = validateUpload(input.kind, input.file)
  if (problem) throw new Error(problem)
  const durationSeconds = input.kind === 'image' ? null : await mediaDuration(input.file)
  // Cloud storage (R2 when configured, otherwise Supabase); the key always starts with the user id.
  const storagePath = await uploadToCloud(supabase, { projectId: input.projectId, folder: 'uploads', ext: extFor(input.file), body: input.file, contentType: input.file.type || 'application/octet-stream', onProgress: input.onProgress })
  const { data, error } = await supabase.from('assets').insert({
    owner_id: user.id,
    project_id: input.projectId,
    asset_type: input.kind,
    storage_path: storagePath,
    source_provider: input.provider ?? 'upload',
    // Only http(s) links are stored: the value is rendered as a link later.
    source_url: /^https?:\/\//i.test(input.sourceUrl?.trim() ?? '') ? input.sourceUrl!.trim() : null,
    license_status: input.license,
    provenance: {
      title: input.title.trim().slice(0, 160) || input.file.name,
      originalFilename: input.file.name.slice(0, 200),
      mimeType: input.file.type,
      bytes: input.file.size,
      durationSeconds,
      licenseNotes: input.licenseNotes?.trim().slice(0, 1000) || null,
      uploadedAt: new Date().toISOString(),
      ...(input.extra ?? {}),
    },
  }).select('id').single()
  if (error) {
    await removeFromCloud(storagePath).catch(() => undefined)
    throw new Error(`No se pudo registrar el archivo: ${error.message}`)
  }
  return data as { id: string }
}

export async function deleteAsset(supabase: SupabaseClient, asset: { id: string; storage_path: string | null }) {
  if (asset.storage_path) {
    await removeFromCloud(asset.storage_path)
  }
  const { error } = await supabase.from('assets').delete().eq('id', asset.id)
  if (error) throw new Error(`No se pudo borrar el registro: ${error.message}`)
}
