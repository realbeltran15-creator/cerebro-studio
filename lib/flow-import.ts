import type { LicenseStatus } from '@/lib/media-upload'
import { instagramReadiness } from '@/lib/editor/container'

/**
 * Importing videos made in Google Flow.
 *
 * Google Flow has no public API to list or fetch a user's videos, and no documented export to Google Drive.
 * What does exist, officially:
 *  - the file you download from Flow (a normal MP4 on your computer), and
 *  - the Google Picker over Google Drive with the per-file scope `drive.file`: the user opens the picker, ticks the
 *    videos and only those files become readable by the app. Nothing is listed or read without that explicit choice.
 * Veo itself is reachable through the Gemini API / Vertex AI, which is a separate (paid) generation path.
 *
 * Selection is therefore always manual; the import and the follow-up processing are automatic.
 */

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const FLOW_MAX_BYTES = 50 * 1024 * 1024
export const FLOW_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'] as const
export const FLOW_URL = 'https://labs.google/fx/tools/flow'
export const FLOW_LICENSE_NOTE = 'Declarado por el usuario: vídeo creado con su cuenta de Google Flow. Cerebro Studio no puede comprobar el origen ni las condiciones de uso; revísalas antes de publicar. Los vídeos de Veo pueden incluir una marca de agua invisible (SynthID): no la elimines.'

export type PickerConfig = { clientId: string; apiKey: string; appId: string }

/** The picker needs three public identifiers (an OAuth web client id, a browser API key and the Cloud project number). None is a secret. */
export function pickerConfigFromEnv(env: Record<string, string | undefined> = {
  clientId: process.env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID,
  apiKey: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
  appId: process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID,
}): PickerConfig | null {
  const clientId = env.clientId?.trim() ?? '', apiKey = env.apiKey?.trim() ?? '', appId = env.appId?.trim() ?? ''
  if (!/^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i.test(clientId)) return null
  if (!/^AIza[0-9A-Za-z_-]{20,60}$/.test(apiKey)) return null
  if (!/^[0-9]{4,20}$/.test(appId)) return null
  return { clientId, apiKey, appId }
}

export type PickedFile = { id: string; name: string; mimeType: string; sizeBytes?: number }

const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/

/** Why a picked Drive file cannot be imported, or null. Folders, documents and other types are refused. */
export function pickedProblem(file: PickedFile) {
  if (!DRIVE_ID.test(file.id)) return 'Identificador de Drive no válido.'
  if (!(FLOW_MIMES as readonly string[]).includes(file.mimeType)) return `Solo se importan MP4, WebM o MOV (este es ${file.mimeType || 'de tipo desconocido'}).`
  if (typeof file.sizeBytes === 'number' && file.sizeBytes > FLOW_MAX_BYTES) return `Supera ${FLOW_MAX_BYTES / 1048576} MB; el límite actual de importación es ese.`
  return null
}

/** Media download for a file the user picked. The bearer token is added by the caller and never put in the URL. */
export function driveDownloadUrl(fileId: string) {
  if (!DRIVE_ID.test(fileId)) throw new Error('Identificador de Drive no válido.')
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
}

export function flowLicense(confirmed: boolean): { status: LicenseStatus; notes: string } {
  return confirmed
    ? { status: 'owned', notes: FLOW_LICENSE_NOTE }
    : { status: 'restricted', notes: 'Origen sin confirmar: la publicación queda bloqueada hasta que marques la licencia.' }
}

export type FlowSource = { kind: 'drive'; fileId: string } | { kind: 'local' }

export function flowProvenance(input: { originalFilename: string; source: FlowSource; prompt?: string; codec?: { video: string | null; audio: string | null } | null; mime: string }) {
  const readiness = instagramReadiness(input.codec?.video ? `${input.mime};codecs=${input.codec.video}` : input.mime)
  return {
    importedFrom: input.source.kind === 'drive' ? 'google-drive-picker' : 'local-file',
    driveFileId: input.source.kind === 'drive' ? input.source.fileId : null,
    declaredOrigin: 'google-flow',
    aiGenerated: true,
    prompt: input.prompt?.trim().slice(0, 2000) || null,
    codecs: input.codec ?? null,
    instagramReady: readiness.ok && !readiness.unknown ? true : readiness.unknown ? null : false,
    instagramNote: readiness.reason,
  }
}

/** What happens to a video after it is imported, for the on-screen summary. Pure, so it can be tested. */
export function followUps(provenance: ReturnType<typeof flowProvenance>) {
  const list = ['Guardado en la Biblioteca del proyecto con su procedencia.', 'Disponible en el Editor y en el Editor automático.']
  if (provenance.instagramReady === false) list.push('Para Instagram habrá que convertirlo a MP4 H.264 + AAC (botón en el panel de render del Editor).')
  if (provenance.instagramReady === null) list.push('No se pudo leer el códec; el panel de render lo comprobará.')
  return list
}
