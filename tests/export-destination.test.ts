import { describe, expect, it } from 'vitest'
import { exportFootprint, fileNameFor, folderSaveSupported, spaceAdvice } from '@/lib/editor/export-destination'

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
    const small = { ...base, estimatedBytes: 300 * 1024 ** 2 }
    const ok = spaceAdvice({ ...small, where: 'drive', browserFreeBytes: 50 * 1024 ** 3 })
    expect(ok.message).toMatch(/temporal/); expect(ok.message).toMatch(/No es una transferencia directa/)
    expect(spaceAdvice({ ...small, where: 'drive', browserFreeBytes: 100 * 1024 ** 2 }).level).toBe('block')
    // a big video never gets a local temporary file (it would fill the internal disk)
    const big = spaceAdvice({ ...base, where: 'drive', driveMode: 'temp', browserFreeBytes: 50 * 1024 ** 3 })
    expect(big.level).toBe('block'); expect(big.message).toMatch(/Directo mientras se renderiza/)
  })
  it('drive direct: no local file, says what the fragmented MP4 means and what happens if the tab closes', () => {
    const a = spaceAdvice({ ...base, where: 'drive', driveMode: 'direct', browserFreeBytes: 1 })
    expect(a.level).toBe('ok'); expect(a.message).toMatch(/no se crea ningún archivo en este equipo/); expect(a.message).toMatch(/fragmentado/); expect(a.message).toMatch(/cierra la pestaña/)
  })
  it('footprint: only a local temporary when asked for; download builds it all in memory', () => {
    const est = 10 * 1024 ** 3
    expect(exportFootprint({ where: 'drive', driveMode: 'direct', estimatedBytes: est }).diskTempBytes).toBe(0)
    expect(exportFootprint({ where: 'drive', driveMode: 'temp', estimatedBytes: est }).diskTempBytes).toBe(est)
    expect(exportFootprint({ where: 'folder', estimatedBytes: est }).diskTempBytes).toBe(0)
    expect(exportFootprint({ where: 'download', estimatedBytes: est }).ramBytes).toBeGreaterThan(est)
    expect(exportFootprint({ where: 'folder', estimatedBytes: est }).ramBytes).toBeLessThan(100 * 1048576)
  })
  it('library: blocks above the per-file limit and above the free quota', () => {
    expect(spaceAdvice({ ...base, where: 'library', libraryMaxFileBytes: 50 * 1048576 }).level).toBe('block')
    expect(spaceAdvice({ ...base, estimatedBytes: 10e6, where: 'library', libraryFreeBytes: 5e6 }).level).toBe('block')
    expect(spaceAdvice({ ...base, estimatedBytes: 10e6, where: 'library', libraryFreeBytes: 500e6, libraryMaxFileBytes: 50 * 1048576 }).level).toBe('ok')
  })
  it('unavailable services are blocked, download of >=1 GB is blocked', () => {
    expect(spaceAdvice({ ...base, where: 'onedrive' }).level).toBe('block')
    expect(spaceAdvice({ ...base, where: 'download' }).level).toBe('block')
    expect(spaceAdvice({ ...base, estimatedBytes: 200 * 1024 ** 2, where: 'download' }).level).toBe('ok')
  })
  it('names files safely', () => { expect(fileNameFor('Mi vídeo: ¡hola!', '16:9', 1080, 'mp4')).toBe('Mi-vídeo-hola-16x9-1080p.mp4') })
})
