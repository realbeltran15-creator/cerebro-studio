'use client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser upload to the configured cloud storage. Large files go straight to Cloudflare R2 with a
 * presigned URL (they never pass through the app server); without R2 they go to Supabase Storage.
 */
export async function uploadToCloud(supabase: SupabaseClient, input: { projectId: string; folder: 'renders' | 'uploads' | 'subtitles' | 'auto-edit'; ext: string; name?: string; body: Blob; contentType: string; onProgress?: (fraction: number) => void }) {
  const r = await fetch('/api/storage/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: input.projectId, folder: input.folder, ext: input.ext, name: input.name, contentType: input.contentType.split(';')[0], size: input.body.size }) })
  const target = await r.json().catch(() => ({})) as { driver?: 'r2' | 'supabase'; storagePath?: string; uploadUrl?: string; maxBytes?: number; error?: string }
  if (!r.ok || !target.storagePath) throw new Error(target.error ?? 'No se pudo preparar la subida.')
  const mb = Math.round(input.body.size / 1048576)
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
