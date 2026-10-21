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
export const saveLocalDraft = (d: LocalDraft) => tx<void>('readwrite', s => s.put(JSON.parse(JSON.stringify(d))))
export const loadLocalDraft = (jobId: string) => tx<LocalDraft>('readonly', s => s.get(jobId))
export const clearLocalDraft = (jobId: string) => tx<void>('readwrite', s => s.delete(jobId))

/** Whether a stored draft is worth offering: different from what was loaded. */
export function draftDiffers(d: LocalDraft | null, loaded: Composition): d is LocalDraft {
  return Boolean(d && JSON.stringify(d.composition) !== JSON.stringify(loaded))
}
