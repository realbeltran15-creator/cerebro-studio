import { beforeEach, describe, expect, it, vi } from 'vitest'

const removed: string[] = []
let failPaths: string[] = []
vi.mock('@/lib/storage/client', () => ({
  removeFromCloud: vi.fn(async (path: string) => { if (failPaths.includes(path)) throw new Error('no se pudo'); removed.push(path) }),
}))

import { confirmationMatches, deleteProject, deletionBlockers, impactLines, keptLines, loadImpact } from '@/lib/projects/delete'

type Row = Record<string, unknown>
/** A tiny stand-in for the Supabase query builder: select().eq().limit() and delete().eq(). */
function fakeDb(tables: Record<string, Row[]>, opts: { failDelete?: boolean } = {}) {
  const log: string[] = []
  const db = {
    from(table: string) {
      let filter: { col: string; val: unknown } | null = null
      let op: 'select' | 'delete' = 'select'
      const api = {
        select() { return api }, limit() { return api },
        delete() { op = 'delete'; return api },
        eq(col: string, val: unknown) { filter = { col, val }; return api },
        then(resolve: (v: unknown) => void) {
          const rows = (tables[table] ?? []).filter(r => !filter || r[filter.col] === filter.val)
          if (op === 'delete') { log.push(`delete ${table}`); if (opts.failDelete) return resolve({ error: { message: 'boom' } }); tables[table] = (tables[table] ?? []).filter(r => !rows.includes(r)); return resolve({ error: null }) }
          log.push(`select ${table}`); resolve({ data: rows, error: null })
        },
      }
      return api
    },
  }
  return { db: db as never, log, tables }
}

const base = (): Record<string, Row[]> => ({
  projects: [{ id: 'p1', name: 'Mi proyecto' }],
  assets: [
    { id: 'a1', project_id: 'p1', asset_type: 'video', storage_path: 'u1/p1/a.webm' }, { id: 'a2', project_id: 'p1', asset_type: 'image', storage_path: 'r2:u1/p1/b.png' },
    { id: 'a3', project_id: 'p1', asset_type: 'music', storage_path: null }, { id: 'x', project_id: 'other', asset_type: 'video', storage_path: 'u1/other/c.webm' },
  ],
  render_jobs: [{ id: 'r1', project_id: 'p1' }, { id: 'r2', project_id: 'p1' }],
  scripts: [{ id: 's1', project_id: 'p1' }], storyboards: [{ id: 'sb', project_id: 'p1' }],
  publication_jobs: [{ id: 'j1', project_id: 'p1', status: 'draft', result: null }],
  opportunities: [{ id: 'o1', project_id: 'p1' }],
})

beforeEach(() => { removed.length = 0; failPaths = [] })

describe('project deletion impact', () => {
  it('counts what goes with the project and lists only its own stored files', async () => {
    const { db } = fakeDb(base())
    const i = await loadImpact(db, 'p1')
    expect(i).toMatchObject({ assets: 3, videos: 1, renders: 2, scripts: 1, storyboards: 1, publications: 1, published: 0, inFlight: 0, opportunities: 1 })
    expect(i.paths).toEqual(['u1/p1/a.webm', 'r2:u1/p1/b.png'])
    expect(impactLines(i).join(' | ')).toMatch(/3 archivos de la Biblioteca \(1 vídeo\).*borrados del almacenamiento/)
    expect(keptLines(i)[0]).toMatch(/1 oportunidad/)
  })
  it('says which already-uploaded videos stay on the platform', async () => {
    const t = base(); t.publication_jobs = [{ id: 'j1', project_id: 'p1', status: 'published', result: { videoId: 'abc' } }, { id: 'j2', project_id: 'p1', status: 'draft', result: { videoId: 'def' } }]
    const i = await loadImpact(fakeDb(t).db, 'p1')
    expect(i.published).toBe(2)
    expect(impactLines(i).join(' ')).toMatch(/seguirá\(n\) en la plataforma/)
  })
  it('blocks while a publication is approved or uploading', async () => {
    const t = base(); t.publication_jobs = [{ id: 'j1', project_id: 'p1', status: 'approved', result: null }, { id: 'j2', project_id: 'p1', status: 'publishing', result: null }]
    const i = await loadImpact(fakeDb(t).db, 'p1')
    expect(i.inFlight).toBe(2)
    expect(deletionBlockers(i)[0]).toMatch(/2 publicación/)
  })
})

describe('confirmation by name', () => {
  it('needs the exact name, ignoring case and surrounding spaces', () => {
    expect(confirmationMatches('mi proyecto', 'Mi proyecto')).toBe(true)
    expect(confirmationMatches('  MI PROYECTO ', 'Mi proyecto')).toBe(true)
    expect(confirmationMatches('Mi proyect', 'Mi proyecto')).toBe(false)
    expect(confirmationMatches('', 'Mi proyecto')).toBe(false)
    expect(confirmationMatches('x', '')).toBe(false)
  })
})

describe('deleteProject', () => {
  it('refuses a wrong name without touching anything', async () => {
    const { db, log } = fakeDb(base())
    await expect(deleteProject(db, { id: 'p1', name: 'Mi proyecto' }, 'otro')).rejects.toThrow(/no coincide/)
    expect(log).toEqual([]); expect(removed).toEqual([])
  })
  it('refuses while a publication is in flight, even with the right name', async () => {
    const t = base(); t.publication_jobs = [{ id: 'j1', project_id: 'p1', status: 'publishing', result: null }]
    const { db, log } = fakeDb(t)
    await expect(deleteProject(db, { id: 'p1', name: 'Mi proyecto' }, 'Mi proyecto')).rejects.toThrow(/publicación/)
    expect(log).not.toContain('delete projects'); expect(removed).toEqual([])
  })
  it('deletes the project row first and then its stored files, and leaves other projects alone', async () => {
    const { db, log, tables } = fakeDb(base())
    const r = await deleteProject(db, { id: 'p1', name: 'Mi proyecto' }, 'mi proyecto')
    expect(log.indexOf('delete projects')).toBeGreaterThan(-1)
    expect(tables.projects).toEqual([])
    expect(removed).toEqual(['u1/p1/a.webm', 'r2:u1/p1/b.png'])
    expect(removed).not.toContain('u1/other/c.webm')
    expect(r).toMatchObject({ removedFiles: 2, failedFiles: 0 })
  })
  it('reports files that could not be removed instead of hiding them', async () => {
    failPaths = ['r2:u1/p1/b.png']
    const r = await deleteProject(fakeDb(base()).db, { id: 'p1', name: 'Mi proyecto' }, 'Mi proyecto')
    expect(r).toMatchObject({ removedFiles: 1, failedFiles: 1 })
  })
  it('keeps every file when the database refuses the deletion', async () => {
    const { db } = fakeDb(base(), { failDelete: true })
    await expect(deleteProject(db, { id: 'p1', name: 'Mi proyecto' }, 'Mi proyecto')).rejects.toThrow(/No se pudo eliminar/)
    expect(removed).toEqual([])
  })
})
