/**
 * Where an export goes, and what each choice really costs. Pure helpers plus thin wrappers over browser APIs, so the panel and the tests share them.
 *
 *  download  the file is built in memory and handed to the browser's download (lands in the Downloads folder, normally the internal disk).
 *  folder    the person picks the FILE (any folder, external drive or USB stick the system shows) BEFORE rendering; the video is written
 *            there as it is produced (File System Access API). Chrome keeps its swap file next to the target, so the internal disk
 *            is not used for the video; nothing is committed if the export is cancelled or fails.
 *  drive     rendered to a temporary file of this browser (origin-private storage = the internal disk) and then uploaded to the chosen
 *            Drive folder in chunks. It is NOT a transfer from a server: the video never exists on any server of ours.
 *  library   private cloud storage of the account, limited by its quota and per-file size.
 *  onedrive / dropbox  not implemented (need app registrations): shown as unavailable.
 */
export type ExportWhere = 'download' | 'folder' | 'drive' | 'library' | 'onedrive' | 'dropbox'
export const EXPORT_TEMP_PREFIX = 'cerebro-export-'

type SavePickerWindow = { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }
export const folderSaveSupported = (w: unknown = typeof window !== 'undefined' ? window : undefined) => typeof (w as SavePickerWindow | undefined)?.showSaveFilePicker === 'function'
export const tempStorageSupported = (n: unknown = typeof navigator !== 'undefined' ? navigator : undefined) => typeof (n as { storage?: { getDirectory?: unknown } } | undefined)?.storage?.getDirectory === 'function'

export const fileNameFor = (title: string, format: string, height: number, ext: string) =>
  `${(title || 'montaje').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'montaje'}-${format.replace(':', 'x')}-${height}p.${ext}`

/** Opens the system «save as» dialog. Must be called from a click (needs user activation). Throws AbortError if the person cancels. */
export async function pickSaveFile(name: string, ext: 'mp4' | 'webm') {
  const w = window as unknown as SavePickerWindow
  if (!w.showSaveFilePicker) throw new Error('Este navegador no permite elegir dónde guardar. Usa Chrome o Edge, o «Descargar a mi equipo».')
  return w.showSaveFilePicker({ suggestedName: name, types: [{ description: ext === 'mp4' ? 'Vídeo MP4' : 'Vídeo WebM', accept: { [ext === 'mp4' ? 'video/mp4' : 'video/webm']: [`.${ext}`] } }] })
}

export type SpaceAdvice = { level: 'ok' | 'warn' | 'block'; message: string }
const gb = (b: number) => Math.round(b / 1024 ** 3 * 10) / 10
const mbs = (b: number) => Math.max(0.1, Math.round(b / 1048576 * 10) / 10)

/**
 * What to tell before rendering. `browserFreeBytes` is navigator.storage.estimate() quota−usage: it is what the browser may still store for
 * this site (a temporary file for Drive), NOT the free space of an external drive, which a web page cannot read.
 */
export function spaceAdvice(i: { where: ExportWhere; estimatedBytes: number; browserFreeBytes?: number | null; libraryFreeBytes?: number | null; libraryMaxFileBytes?: number | null; folderSupported: boolean; tempSupported: boolean }): SpaceAdvice {
  const est = i.estimatedBytes
  switch (i.where) {
    case 'folder':
      if (!i.folderSupported) return { level: 'block', message: 'Este navegador no permite elegir una carpeta o disco. Usa Chrome o Edge, o «Descargar a mi equipo».' }
      return { level: 'ok', message: `Se escribe directamente en el archivo que elijas (~${mbs(est)} MB), sin armarlo antes en memoria ni en el disco interno. El navegador no puede ver el espacio libre de ese disco: si se llena, la exportación se detiene y no queda un archivo a medias.` }
    case 'drive':
      if (!i.tempSupported) return { level: 'block', message: 'Este navegador no puede guardar el archivo temporal necesario para subirlo a Drive. Usa Chrome o Edge.' }
      if (i.browserFreeBytes != null && i.browserFreeBytes < est * 1.1) return { level: 'block', message: `Hace falta un temporal de ~${mbs(est)} MB en este equipo antes de subirlo a Drive y el navegador solo permite ~${mbs(Math.max(0, i.browserFreeBytes))} MB. Libera espacio o exporta a una carpeta.` }
      return { level: 'warn', message: `Se renderiza a un archivo temporal de este equipo (~${mbs(est)} MB, en el disco interno) y después se sube a tu Drive; el temporal se borra al terminar. No es una transferencia directa desde un servidor.` }
    case 'library':
      if (i.libraryMaxFileBytes != null && est > i.libraryMaxFileBytes) return { level: 'block', message: `Pesa ~${mbs(est)} MB y la Biblioteca admite ${mbs(i.libraryMaxFileBytes)} MB por archivo.` }
      if (i.libraryFreeBytes != null && est > i.libraryFreeBytes) return { level: 'block', message: `No cabe: ~${mbs(est)} MB y quedan ${mbs(Math.max(0, i.libraryFreeBytes))} MB en tu cuota.` }
      return { level: 'ok', message: `Se guarda en tu almacenamiento privado (~${mbs(est)} MB)${i.libraryFreeBytes != null ? `; te quedarán ~${mbs(i.libraryFreeBytes - est)} MB` : ''}.` }
    case 'download':
      return est >= 1024 ** 3 ? { level: 'warn', message: `~${gb(est)} GB: el navegador lo monta entero en memoria (necesita ~${gb(est * 2.7)} GB libres) y lo descarga a la carpeta Descargas. Para vídeos largos elige «Guardar en carpeta o disco».` } : { level: 'ok', message: `~${mbs(est)} MB. Se descarga a la carpeta de descargas de tu navegador.` }
    default:
      return { level: 'block', message: 'Todavía no está disponible: requiere registrar la aplicación en ese servicio.' }
  }
}

export async function browserFreeBytes(): Promise<number | null> {
  try { const e = await navigator.storage.estimate(); return e.quota != null && e.usage != null ? e.quota - e.usage : null } catch { return null }
}

/** Temporary export files of this site (never the person's media): listed and removable from the Storage panel. */
export async function listExportTemps(): Promise<Array<{ name: string; bytes: number }>> {
  if (!tempStorageSupported()) return []
  const root = await navigator.storage.getDirectory()
  const out: Array<{ name: string; bytes: number }> = []
  for await (const [name, h] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (h.kind === 'file' && name.startsWith(EXPORT_TEMP_PREFIX)) out.push({ name, bytes: (await (h as FileSystemFileHandle).getFile()).size })
  }
  return out
}
export async function removeExportTemp(name: string) {
  if (!name.startsWith(EXPORT_TEMP_PREFIX)) throw new Error('Solo se pueden borrar temporales de exportación.')
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(name).catch(() => undefined)
}
export async function createExportTemp(id: string, ext: string) {
  const root = await navigator.storage.getDirectory()
  const name = `${EXPORT_TEMP_PREFIX}${id}.${ext}`
  const handle = await root.getFileHandle(name, { create: true })
  return { name, handle, writable: await handle.createWritable() }
}
