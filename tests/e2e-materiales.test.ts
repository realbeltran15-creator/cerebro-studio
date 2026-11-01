// @vitest-environment node
/**
 * Recorrido de MATERIALES: importar -> clasificar -> guardar como material -> montaje -> MP4 -> original intacto y procedencia.
 * REAL: classify/fingerprintKey, compositionFromAssets, manualEditorHref/parseAssetIds, compositionAssetIds, motor de render + FFmpeg, QC, sha256.
 * SIMULADO: la subida a Supabase/R2 y la tabla assets (un Map en memoria); no es integración real de almacenamiento.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classify, fingerprintKey } from '@/lib/ingest/files'
import { compositionFromAssets, manualEditorHref, parseAssetIds } from '@/lib/editor/from-assets'
import { compositionAssetIds } from '@/lib/editor/client'
import { projectDurationMs } from '@/lib/editor/composition'
import { renderProject, type AssetFile } from '@/lib/render/engine'
import { inspectMedia, sha256File } from '@/lib/qc/media'

const have = spawnSync('ffmpeg', ['-version']).status === 0
const d = have ? describe : describe.skip
const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])

describe('classify: formatos y errores de archivo', () => {
  it('admite los formatos documentados y rechaza el resto con motivo', () => {
    expect(classify('a.mp4', 'video/mp4')).toMatchObject({ ok: true, kind: 'video' })
    expect(classify('a.mov', '')).toMatchObject({ ok: true, kind: 'video' })
    expect(classify('foto.JPG', 'image/jpeg')).toMatchObject({ ok: true, kind: 'image' })
    expect(classify('nota.m4a', 'audio/x-m4a')).toMatchObject({ ok: true, kind: 'voice', mime: 'audio/mp4' })
    expect(classify('tema.mp3', 'audio/mpeg')).toMatchObject({ ok: true, kind: 'music' })
    for (const [n, m] of [['x.exe', 'application/octet-stream'], ['doc.pdf', 'application/pdf'], ['foto.heic', 'image/heic'], ['v.avi', 'video/x-msvideo'], ['sinext', '']] as const) {
      const r = classify(n, m); expect(r.ok).toBe(false); if (!r.ok) expect(r.reason.length).toBeGreaterThan(10)
    }
  })
  it('duplicados: mismo nombre (NFC, mayúsculas) y tamaño comparten clave', () => {
    expect(fingerprintKey('Café.MP4', 10)).toBe(fingerprintKey('Café.mp4', 10))
    expect(fingerprintKey('a.mp4', 10)).not.toBe(fingerprintKey('a.mp4', 11))
  })
  it('parseAssetIds descarta ids peligrosos y duplicados', () => {
    expect(parseAssetIds('a,a,../x,b_1,<script>')).toEqual(['a', 'b_1'])
  })
})

d('importar -> material -> montaje -> MP4 -> original', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cerebro-mat-'))
  const f = (n: string) => path.join(dir, n)
  ff('-f', 'lavfi', '-i', 'color=c=0x4040d0:s=640x360:r=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('clip.mp4'))
  ff('-f', 'lavfi', '-i', 'color=c=0xd0a040:s=640x360', '-frames:v', '1', f('foto.png'))
  ff('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=8', '-ac', '2', f('tema.mp3'))
  const library = new Map<string, { id: string; asset_type: string; durationMs: number | null; file: string; provenance: Record<string, unknown>; sha: string }>()

  it('el recorrido completo conserva el original y la procedencia', async () => {
    const files = [['clip.mp4', 'video/mp4', 4000], ['foto.png', 'image/png', null], ['tema.mp3', 'audio/mpeg', 8000]] as const
    for (const [name, mime, dur] of files) {
      const c = classify(name, mime); expect(c.ok).toBe(true); if (!c.ok) return
      const id = `asset_${name.replace(/\W/g, '_')}`
      const type = c.kind === 'music' ? 'music' : c.kind
      library.set(id, { id, asset_type: type, durationMs: dur, file: f(name), provenance: { origin: 'upload', originalName: name, mime: c.mime, source: 'device' }, sha: await sha256File(f(name)) })
    }
    const ids = [...library.keys()]
    const href = manualEditorHref('proj1', ids)
    const parsed = parseAssetIds(new URL(href, 'http://x').searchParams.get('assets'))
    expect(parsed).toEqual(ids)
    const comp = compositionFromAssets({ title: 'Materiales', format: '16:9', assets: parsed.map(i => ({ id: i, asset_type: library.get(i)!.asset_type, durationMs: library.get(i)!.durationMs })) })
    expect(compositionAssetIds(comp).sort()).toEqual(ids.sort())
    const assets: Record<string, AssetFile> = Object.fromEntries([...library.values()].map(a => [a.id, { path: a.file, kind: (a.asset_type === 'video' ? 'video' : a.asset_type === 'image' ? 'image' : 'audio') as AssetFile['kind'] }]))
    const out = f('montaje.mp4')
    await renderProject({ composition: comp, assets, output: out, workDir: f('w'), fps: 10, preset: 'ultrafast' })
    const qc = await inspectMedia(out); expect(qc.ok).toBe(true)
    if (qc.ok) { expect(qc.info.framesDecoded).toBe(qc.info.framesDeclared); expect(qc.info.audio.hasStream).toBe(true); expect(Math.abs(qc.info.meta.durationMs - projectDurationMs(comp))).toBeLessThan(300) }
    // El original NO se ha tocado (hash idéntico) y sigue siendo recuperable por su id con su procedencia.
    for (const a of library.values()) { expect(await sha256File(a.file)).toBe(a.sha); expect(a.provenance.origin).toBe('upload') }
    // El resultado es un derivado distinto del original, con las entradas que lo componen.
    const derived = { asset_type: 'video', provenance: { purpose: 'render', inputs: compositionAssetIds(comp) } }
    expect(derived.provenance.inputs).toEqual(expect.arrayContaining(ids))
    expect(await sha256File(out)).not.toBe(library.get('asset_clip_mp4')!.sha)
  }, 180_000)

  it('un material cuyo archivo desaparece falla con error claro y no deja salida', async () => {
    const comp = compositionFromAssets({ title: 'x', format: '16:9', assets: [{ id: 'gone', asset_type: 'video', durationMs: 3000 }] })
    await expect(renderProject({ composition: comp, assets: { gone: { path: f('no-existe.mp4'), kind: 'video' } }, output: f('gone.mp4'), workDir: f('w2'), fps: 10, preset: 'ultrafast' })).rejects.toThrow(/Falta|archivo/i)
    expect(() => readFileSync(f('gone.mp4'))).toThrow()
    writeFileSync(f('vacio.mp4'), '')
    const bad = await inspectMedia(f('vacio.mp4')); expect(bad.ok).toBe(false)
  }, 60_000)
})
