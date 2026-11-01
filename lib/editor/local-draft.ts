'use client'
/**
 * Local recovery copy of a montage being edited: written to IndexedDB a moment after every change, removed after a successful save.
 * If the tab closes or the browser crashes, the editor offers to recover it next time. It never overwrites the saved version by itself.
 */
import type { Composition } from './composition'

export type LocalDraft = { jobId: string; composition: Composition; savedAt: string; /** updated_at of the cloud version the changes started from. */ baseUpdatedAt: string | null }
const DB = 'cerebro-editor-drafts', STORE = 'drafts'

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'jobId' }) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise(resolve => {
    try {
      const t = db.transaction(STORE, mode)
      const r = fn(t.objectStore(STORE))
      t.oncomplete = () => { resolve((r && 'result' in r ? r.result : null) as T | null); db.close() }
      t.onerror = () => { resolve(null); db.close() }
    } catch { resolve(null) }
  })
}
// ---- Un registro por montaje con un borrador POR PESTAÑA: dos pestañas ya no se pisan ni se borran el borrador entre sí. ----
export type DraftRecord = { jobId: string; drafts: Record<string, LocalDraft> }

/** Normaliza el formato antiguo (un solo borrador sin pestaña) al nuevo. */
export function toRecord(raw: unknown, jobId: string): DraftRecord {
  const r = raw as { drafts?: Record<string, LocalDraft>; composition?: unknown } | null
  if (r && r.drafts && typeof r.drafts === 'object') return { jobId, drafts: { ...r.drafts } }
  if (r && r.composition) return { jobId, drafts: { _legacy: raw as LocalDraft } }
  return { jobId, drafts: {} }
}
export const putDraft = (rec: DraftRecord, tab: string, d: LocalDraft): DraftRecord => ({ ...rec, drafts: { ...rec.drafts, [tab]: d } })
/** Quita el borrador de una pestaña (o todos). */
export function dropDraft(rec: DraftRecord, tab: string | 'all'): DraftRecord {
  if (tab === 'all') return { ...rec, drafts: {} }
  const { [tab]: _removed, ...rest } = rec.drafts; void _removed
  return { ...rec, drafts: rest }
}
/** El borrador más reciente de cualquier pestaña (el de una pestaña cerrada también se puede recuperar). */
export function newestDraft(rec: DraftRecord): LocalDraft | null {
  const all = Object.values(rec.drafts)
  return all.length ? all.reduce((a, b) => (Date.parse(b.savedAt) > Date.parse(a.savedAt) ? b : a)) : null
}

let tabId: string | null = null
/** Identificador de esta pestaña: sobrevive a una recarga (sessionStorage) pero no se comparte con otras pestañas. */
export function currentTabId(): string {
  if (tabId) return tabId
  try {
    tabId = sessionStorage.getItem('cerebro.tab') ?? ''
    if (!tabId) { tabId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; sessionStorage.setItem('cerebro.tab', tabId) }
  } catch { tabId = `t-${Math.random().toString(36).slice(2, 10)}` }
  return tabId
}

function update(jobId: string, fn: (rec: DraftRecord) => DraftRecord) {
  return tx<void>('readwrite', s => {
    const g = s.get(jobId)
    g.onsuccess = () => {
      const next = fn(toRecord(g.result, jobId))
      if (Object.keys(next.drafts).length) s.put(JSON.parse(JSON.stringify(next))); else s.delete(jobId)
    }
  })
}
export const saveLocalDraft = (d: LocalDraft) => update(d.jobId, rec => putDraft(rec, currentTabId(), d))
export async function loadLocalDraft(jobId: string): Promise<LocalDraft | null> {
  const raw = await tx<unknown>('readonly', s => s.get(jobId))
  return newestDraft(toRecord(raw, jobId))
}
/** Por defecto borra solo el borrador de ESTA pestaña. `{ all: true }` = el usuario descarta todas las copias. */
export const clearLocalDraft = (jobId: string, opts: { all?: boolean } = {}) => update(jobId, rec => dropDraft(rec, opts.all ? 'all' : currentTabId()))

/** Whether a stored draft is worth offering: different from what was loaded. */
export function draftDiffers(d: LocalDraft | null, loaded: Composition): d is LocalDraft {
  return Boolean(d && JSON.stringify(d.composition) !== JSON.stringify(loaded))
}

/**
 * The undo history of a montage, kept in this browser (IndexedDB) so Ctrl+Z still works after reloading the page.
 * Only used when the montage opened is exactly the one the history ends in.
 */
export type LocalHistory = { jobId: string; past: Composition[]; future: Composition[]; present: Composition }
const HDB = 'cerebro-editor-history', HSTORE = 'history'
function openH(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(HDB, 1)
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(HSTORE)) req.result.createObjectStore(HSTORE, { keyPath: 'jobId' }) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}
async function htx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | null> {
  const db = await openH()
  if (!db) return null
  return new Promise(resolve => {
    try {
      const t = db.transaction(HSTORE, mode)
      const r = fn(t.objectStore(HSTORE))
      t.oncomplete = () => { resolve((r && 'result' in r ? r.result : null) as T | null); db.close() }
      t.onerror = () => { resolve(null); db.close() }
    } catch { resolve(null) }
  })
}
export const HISTORY_KEPT = 30
export const saveLocalHistory = (h: LocalHistory) => htx<void>('readwrite', s => s.put(JSON.parse(JSON.stringify({ ...h, past: h.past.slice(-HISTORY_KEPT), future: h.future.slice(0, HISTORY_KEPT) }))))
export const loadLocalHistory = (jobId: string) => htx<LocalHistory>('readonly', s => s.get(jobId))
