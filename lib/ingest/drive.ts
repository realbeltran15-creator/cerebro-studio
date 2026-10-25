'use client'
import { DRIVE_FILE_SCOPE, driveDownloadUrl, type PickerConfig } from '@/lib/flow-import'

/**
 * Google Drive for «Añadir materiales»: the official Picker with the per-file scope `drive.file` — only the files the owner ticks become
 * readable, nothing is listed. Same three public identifiers as the Google Flow import (NEXT_PUBLIC_GOOGLE_PICKER_*).
 */
export const DRIVE_MEDIA_MIMES = ['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/flac']
export const DRIVE_AUDIO_MIMES = DRIVE_MEDIA_MIMES.filter(m => m.startsWith('audio/'))
export const DRIVE_VIDEO_MIMES = DRIVE_MEDIA_MIMES.filter(m => m.startsWith('video/'))
export const DRIVE_IMAGE_MIMES = DRIVE_MEDIA_MIMES.filter(m => m.startsWith('image/'))
export type DrivePick = { id: string; name: string; mimeType: string; sizeBytes?: number }
/** Which tabs the Picker shows. The Picker itself provides folder navigation, search by name and multi-select. */
export type DriveFilter = 'audio' | 'video' | 'image' | 'all'
export const DRIVE_FILTER_LABEL: Record<Exclude<DriveFilter, 'all'>, string> = { audio: 'Audio', video: 'Vídeo', image: 'Imágenes' }
export function viewsFor(filter: DriveFilter): Array<{ label: string; mimes: string[] }> {
  const one = (f: Exclude<DriveFilter, 'all'>) => ({ label: DRIVE_FILTER_LABEL[f], mimes: f === 'audio' ? DRIVE_AUDIO_MIMES : f === 'video' ? DRIVE_VIDEO_MIMES : DRIVE_IMAGE_MIMES })
  if (filter !== 'all') return [one(filter), { label: 'Todo', mimes: DRIVE_MEDIA_MIMES }]
  return [{ label: 'Todo', mimes: DRIVE_MEDIA_MIMES }, one('audio'), one('video'), one('image')]
}

const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
  const s = document.createElement('script')
  s.src = src; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('No se pudo cargar Google Drive.'))
  document.head.appendChild(s)
})

async function loadGoogle() {
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')])
  await new Promise<void>(resolve => window.gapi!.load('picker', () => resolve()))
}

/** A short-lived access token for `drive.file` (needs a click: Google may show its consent window). It is kept in memory only. */
export async function requestDriveToken(config: PickerConfig): Promise<string> {
  await loadGoogle()
  const g = window.google!
  return new Promise<string>((resolve, reject) => {
    g.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope: DRIVE_FILE_SCOPE, callback: r => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? 'Google no concedió el acceso.'))) }).requestAccessToken({ prompt: '' })
  })
}

/** Opens the Picker; resolves with the access token and the files ticked (empty when closed without choosing). */
export async function pickFromDrive(config: PickerConfig, filter: DriveFilter = 'all'): Promise<{ token: string; files: DrivePick[] }> {
  await loadGoogle()
  const g = window.google!
  const token = await requestDriveToken(config)
  return new Promise(resolve => {
    const picker = new g.picker.PickerBuilder()
    for (const v of viewsFor(filter)) {
      const view = new g.picker.DocsView((g.picker.ViewId as unknown as { DOCS: string }).DOCS)
      view.setMimeTypes(v.mimes.join(',')); view.setIncludeFolders(true); view.setSelectFolderEnabled(false)
      ;(view as unknown as { setLabel?: (l: string) => void }).setLabel?.(v.label)
      picker.addView(view)
    }
    picker.setOAuthToken(token); picker.setDeveloperKey(config.apiKey); picker.setAppId(config.appId)
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

/** Lets the person choose the Drive folder where an export will be saved (the Picker's folder view). */
export async function pickDriveFolder(config: PickerConfig): Promise<{ token: string; folderId: string; folderName: string } | null> {
  await loadGoogle()
  const g = window.google!
  const token = await requestDriveToken(config)
  return new Promise(resolve => {
    const view = new g.picker.DocsView((g.picker.ViewId as unknown as { FOLDERS: string }).FOLDERS)
    view.setIncludeFolders(true); view.setSelectFolderEnabled(true); view.setMimeTypes('application/vnd.google-apps.folder')
    ;(view as unknown as { setLabel?: (l: string) => void }).setLabel?.('Carpetas')
    const picker = new g.picker.PickerBuilder()
    picker.addView(view); picker.setOAuthToken(token); picker.setDeveloperKey(config.apiKey); picker.setAppId(config.appId)
    picker.setCallback(r => {
      if (r.action === g.picker.Action.PICKED && r.docs?.[0]) resolve({ token, folderId: r.docs[0].id, folderName: r.docs[0].name })
      else if (r.action === 'cancel') resolve(null)
    })
    ;(picker.build() as { setVisible(v: boolean): void }).setVisible(true)
  })
}
