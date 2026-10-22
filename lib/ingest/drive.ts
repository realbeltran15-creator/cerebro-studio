'use client'
import { DRIVE_FILE_SCOPE, driveDownloadUrl, type PickerConfig } from '@/lib/flow-import'

/**
 * Google Drive for «Añadir materiales»: the official Picker with the per-file scope `drive.file` — only the files the owner ticks become
 * readable, nothing is listed. Same three public identifiers as the Google Flow import (NEXT_PUBLIC_GOOGLE_PICKER_*).
 */
export const DRIVE_MEDIA_MIMES = ['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/flac']
export type DrivePick = { id: string; name: string; mimeType: string; sizeBytes?: number }

const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
  const s = document.createElement('script')
  s.src = src; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('No se pudo cargar Google Drive.'))
  document.head.appendChild(s)
})

/** Opens the Picker; resolves with the access token and the files ticked (empty when closed without choosing). */
export async function pickFromDrive(config: PickerConfig): Promise<{ token: string; files: DrivePick[] }> {
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')])
  await new Promise<void>(resolve => window.gapi!.load('picker', () => resolve()))
  const g = window.google!
  const token = await new Promise<string>((resolve, reject) => {
    g.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope: DRIVE_FILE_SCOPE, callback: r => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? 'Google no concedió el acceso.'))) }).requestAccessToken({ prompt: '' })
  })
  return new Promise(resolve => {
    const view = new g.picker.DocsView((g.picker.ViewId as unknown as { DOCS: string }).DOCS)
    view.setMimeTypes(DRIVE_MEDIA_MIMES.join(',')); view.setIncludeFolders(true); view.setSelectFolderEnabled(false)
    const picker = new g.picker.PickerBuilder()
    picker.addView(view); picker.setOAuthToken(token); picker.setDeveloperKey(config.apiKey); picker.setAppId(config.appId)
    picker.enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
    picker.setCallback(r => {
      if (r.action === g.picker.Action.PICKED) resolve({ token, files: (r.docs ?? []).map(d => ({ id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes })) })
      else if (r.action === 'cancel') resolve({ token, files: [] })
    })
    ;(picker.build() as { setVisible(v: boolean): void }).setVisible(true)
  })
}

/** Downloads one picked file (bearer token in the header, never in the URL), refusing it early when it is larger than allowed. */
export async function downloadPicked(f: DrivePick, token: string, maxBytes: number, signal?: AbortSignal): Promise<File> {
  if (typeof f.sizeBytes === 'number' && f.sizeBytes > maxBytes) throw new Error(`Pesa más de ${Math.round(maxBytes / 1048576)} MB, el máximo por archivo del almacenamiento actual.`)
  const r = await fetch(driveDownloadUrl(f.id), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal })
  if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? 'Drive no deja leer este archivo (¿lo elegiste en el selector?).' : `Drive respondió ${r.status}.`)
  const blob = await r.blob()
  if (blob.size > maxBytes) throw new Error(`Pesa más de ${Math.round(maxBytes / 1048576)} MB.`)
  return new File([blob], f.name, { type: f.mimeType })
}
