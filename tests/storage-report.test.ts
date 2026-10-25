import { describe, expect, it } from 'vitest'
import { metadataBytes, summarize, type StoredAsset } from '@/lib/storage/report'

const a = (id: string, o: Partial<StoredAsset> = {}): StoredAsset => ({ id, project_id: 'p1', asset_type: 'video', source_provider: 'upload', bytes: 100, fingerprint: null, driveFileId: null, title: id, created_at: '2026-01-01', ...o })
describe('storage report', () => {
  it('adds up by kind and project and separates exports', () => {
    const s = summarize([a('1'), a('2', { asset_type: 'music', bytes: 50 }), a('3', { source_provider: 'browser-render', bytes: 400 }), a('4', { project_id: null, bytes: 10 })], { p1: 'Mi proyecto' })
    expect(s.totalBytes).toBe(560); expect(s.byKind['exportación'].bytes).toBe(400); expect(s.byKind.music.files).toBe(1)
    expect(s.byProject.find(p => p.name === 'Mi proyecto')?.bytes).toBe(550); expect(s.byProject.some(p => p.name === 'Biblioteca general')).toBe(true)
  })
  it('finds duplicates by content fingerprint or by Drive id, counting only the extra copies', () => {
    const s = summarize([a('1', { fingerprint: 'x', bytes: 1000 }), a('2', { fingerprint: 'x', bytes: 1000 }), a('3', { fingerprint: 'x', bytes: 1000 }), a('4', { driveFileId: 'D', bytes: 7 }), a('5', { driveFileId: 'D', bytes: 7 }), a('6', { driveFileId: 'D', bytes: 9 })])
    expect(s.duplicates.map(d => d.count)).toEqual([3, 2]); expect(s.duplicateExtraBytes).toBe(2007)
  })
  it('counts metadata bytes', () => { expect(metadataBytes([{ a: 1 }, null])).toBe(JSON.stringify({ a: 1 }).length + 2) })
})
