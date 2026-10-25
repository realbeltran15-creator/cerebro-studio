import { describe, expect, it } from 'vitest'
import { fileNameFor, folderSaveSupported, spaceAdvice } from '@/lib/editor/export-destination'

const base = { estimatedBytes: 3 * 1024 ** 3, folderSupported: true, tempSupported: true }
describe('export destinations', () => {
  it('detects support without throwing', () => {
    expect(folderSaveSupported({ showSaveFilePicker() {} })).toBe(true)
    expect(folderSaveSupported({})).toBe(false)
  })
  it('folder: ok when supported, blocked otherwise, never claims to know the disk space', () => {
    expect(spaceAdvice({ ...base, where: 'folder' }).level).toBe('ok')
    expect(spaceAdvice({ ...base, where: 'folder' }).message).toMatch(/no puede ver el espacio libre/)
    expect(spaceAdvice({ ...base, where: 'folder', folderSupported: false }).level).toBe('block')
  })
  it('drive: states that a local temporary is used and blocks when the browser has no room', () => {
    const ok = spaceAdvice({ ...base, where: 'drive', browserFreeBytes: 50 * 1024 ** 3 })
    expect(ok.message).toMatch(/temporal/); expect(ok.message).toMatch(/No es una transferencia directa/)
    expect(spaceAdvice({ ...base, where: 'drive', browserFreeBytes: 1024 ** 3 }).level).toBe('block')
  })
  it('library: blocks above the per-file limit and above the free quota', () => {
    expect(spaceAdvice({ ...base, where: 'library', libraryMaxFileBytes: 50 * 1048576 }).level).toBe('block')
    expect(spaceAdvice({ ...base, estimatedBytes: 10e6, where: 'library', libraryFreeBytes: 5e6 }).level).toBe('block')
    expect(spaceAdvice({ ...base, estimatedBytes: 10e6, where: 'library', libraryFreeBytes: 500e6, libraryMaxFileBytes: 50 * 1048576 }).level).toBe('ok')
  })
  it('unavailable services are blocked, download of >1 GB warns', () => {
    expect(spaceAdvice({ ...base, where: 'onedrive' }).level).toBe('block')
    expect(spaceAdvice({ ...base, where: 'download' }).level).toBe('warn')
  })
  it('names files safely', () => { expect(fileNameFor('Mi vídeo: ¡hola!', '16:9', 1080, 'mp4')).toBe('Mi-vídeo-hola-16x9-1080p.mp4') })
})
