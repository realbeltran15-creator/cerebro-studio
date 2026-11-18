'use client'
import type { EditorAsset } from './client'

/**
 * «Materiales de mi disco»: files that stay on the owner's computer or external drive (e.g. D:) and are used in a montage
 * without uploading them to the cloud. The browser keeps a handle to each file (File System Access API) in IndexedDB;
 * the player and the exporter read them through a local blob: URL. Nothing is copied or uploaded.
 *
 * Ids start with `local-`. A montage that uses them only plays and exports in a browser where the folder was chosen
 * (the cloud and the offline FFmpeg package cannot reach the owner's disk).
 */
export const LOCAL_PREFIX = 'local-'
export const isLocalId = (id: string | null | undefined): id is string => typeof id === 'string' && id.startsWith(LOCAL_PREFIX)

type Kind = 'music' | 'video' | 'image'
export type LocalFile = {
  id: string
  name: string
  folder: string
  kind: Kind
  size: number
  lastModified: number
  durationMs: number | null
  addedAt: string
  handle: FileSystemFileHandle
}
type FolderRec = { name: string; handle: FileSystemDirectoryHandle; addedAt: string }

const DB = 'cerebro-local-media'
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i
const VIDEO = /\.(mp4|webm|mov|m4v)$/i
const IMAGE = /\.(png|jpe?g|webp|gif)$/i
export const kindOfName = (name: string): Kind | null => (AUDIO.test(name) ? 'music' : VIDEO.test(name) ? 'video' : IMAGE.test(name) ? 'image' : null)

function db(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const q = indexedDB.open(DB, 1)
    q.onupgradeneeded = () => { q.result.createObjectStore('files', { keyPath: 'id' }); q.result.createObjectStore('folders', { keyPath: 'name' }) }
    q.onsuccess = () => ok(q.result)
    q.onerror = () => bad(q.error)
  })
}
async function all<T>(store: string): Promise<T[]> {
  const d = await db()
  return new Promise((ok, bad) => { const q = d.transaction(store).objectStore(store).getAll(); q.onsuccess = () => ok(q.result as T[]); q.onerror = () => bad(q.error) })
}
async function putAll(store: string, rows: unknown[]) {
  const d = await db()
  await new Promise<void>((ok, bad) => { const t = d.transaction(store, 'readwrite'); for (const r of rows) t.objectStore(store).put(r); t.oncomplete = () => ok(); t.onerror = () => bad(t.error) })
}

/** Stable id for a file: the same file chosen again keeps its id (montages that use it keep working). */
async function idOf(folder: string, name: string, size: number) {
  const bytes = new TextEncoder().encode(`${folder}/${name}/${size}`)
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return LOCAL_PREFIX + [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function mediaDurationMs(file: File, kind: Kind): Promise<number | null> {
  if (kind === 'image') return null
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<number | null>(ok => {
      const el = document.createElement(kind === 'video' ? 'video' : 'audio')
      el.preload = 'metadata'
      const t = setTimeout(() => ok(null), 15000)
      el.onloadedmetadata = () => { clearTimeout(t); ok(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null) }
      el.onerror = () => { clearTimeout(t); ok(null) }
      el.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}

export function localFolderSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Asks for a folder (needs a click) and registers its media files, sorted by name. Returns the files of that folder. */
export async function pickLocalFolder(onProgress?: (done: number, total: number) => void): Promise<{ folder: string; files: LocalFile[] }> {
  if (!localFolderSupported()) throw new Error('Este navegador no deja usar carpetas del disco. Usa Chrome o Edge en el ordenador.')
  const dir = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ id: 'cerebro-local', mode: 'read' })
  const entries: FileSystemFileHandle[] = []
  for await (const h of (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) if (h.kind === 'file' && kindOfName(h.name)) entries.push(h as FileSystemFileHandle)
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const known = new Map((await all<LocalFile>('files')).map(f => [f.id, f]))
  const files: LocalFile[] = []
  let n = 0
  for (const h of entries) {
    const file = await h.getFile()
    const kind = kindOfName(h.name)!
    const id = await idOf(dir.name, h.name, file.size)
    const prev = known.get(id)
    const durationMs = prev?.durationMs ?? await mediaDurationMs(file, kind)
    files.push({ id, name: h.name, folder: dir.name, kind, size: file.size, lastModified: file.lastModified, durationMs, addedAt: prev?.addedAt ?? new Date().toISOString(), handle: h })
    onProgress?.(++n, entries.length)
  }
  await putAll('files', files)
  await putAll('folders', [{ name: dir.name, handle: dir, addedAt: new Date().toISOString() } satisfies FolderRec])
  return { folder: dir.name, files }
}

export async function localFiles(): Promise<LocalFile[]> {
  if (typeof indexedDB === 'undefined') return []
  try { return (await all<LocalFile>('files')).sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name, undefined, { numeric: true })) } catch { return [] }
}

/** Local files shown as ordinary materials of the editor (Biblioteca general = usable in any montage). */
export function asEditorAssets(files: LocalFile[]): EditorAsset[] {
  return files.map(f => ({
    id: f.id, project_id: null, asset_type: f.kind, storage_path: `local:${f.folder}/${f.name}`, license_status: 'owned', source_provider: 'local-disk',
    provenance: { title: `${f.name.replace(/\.[^.]+$/, '')} · disco (${f.folder})`, durationMs: f.durationMs, local: true, folder: f.folder, bytes: f.size },
    created_at: f.addedAt,
  }))
}

type Perm = { queryPermission?: (o: object) => Promise<PermissionState>; requestPermission?: (o: object) => Promise<PermissionState> }
/** Re-grants read access to every chosen folder (the browser asks again after a restart). Must run from a click. */
export async function grantLocalAccess(): Promise<boolean> {
  let ok = true
  for (const f of await all<FolderRec>('folders').catch(() => [] as FolderRec[])) {
    const h = f.handle as unknown as Perm
    const st = (await h.queryPermission?.({ mode: 'read' })) ?? 'granted'
    if (st !== 'granted' && (await h.requestPermission?.({ mode: 'read' })) !== 'granted') ok = false
  }
  return ok
}
export async function localAccessNeeded(): Promise<boolean> {
  for (const f of await all<FolderRec>('folders').catch(() => [] as FolderRec[])) if (((await (f.handle as unknown as Perm).queryPermission?.({ mode: 'read' })) ?? 'granted') !== 'granted') return true
  return false
}

const urls = new Map<string, string>()
/** A playable blob: URL for a local file (kept for the page's life; the file is read from disk, not copied). */
export async function resolveLocal(id: string): Promise<string> {
  const hit = urls.get(id)
  if (hit) return hit
  const d = await db()
  const rec = await new Promise<LocalFile | undefined>((ok, bad) => { const q = d.transaction('files').objectStore('files').get(id); q.onsuccess = () => ok(q.result as LocalFile | undefined); q.onerror = () => bad(q.error) })
  if (!rec) throw new Error('Este archivo del disco no está registrado en este navegador. Vuelve a elegir su carpeta.')
  let file: File
  try { file = await rec.handle.getFile() } catch {
    throw new Error(`No hay permiso para leer «${rec.name}» del disco. Pulsa «Dar acceso a mis carpetas del disco» o comprueba que el disco está conectado.`)
  }
  const url = URL.createObjectURL(file)
  urls.set(id, url)
  return url
}
