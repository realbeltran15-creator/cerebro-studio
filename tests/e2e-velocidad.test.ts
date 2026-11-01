// @vitest-environment node
/**
 * Velocidad del clip de vídeo con FFmpeg REAL: el motor de exportación respeta `speed` (un clip de duración D con velocidad v consume D×v del original),
 * la duración de salida es la del proyecto y el original no cambia. Fuente: 2 s ROJO y luego 2 s AZUL.
 * REAL: composición + motor offline + FFmpeg. No prueba el reproductor del navegador.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyComposition, type Composition } from '@/lib/editor/composition'
import { addVideo } from '@/lib/editor/timeline'
import { renderProject, type AssetFile } from '@/lib/render/engine'
import { sha256File } from '@/lib/qc/media'

const have = spawnSync('ffmpeg', ['-version']).status === 0
const d = have ? describe : describe.skip
const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])

/** Luma media del fotograma central en el segundo t. */
function luma(file: string, t: number) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 })
  return buf[8 * 16 + 8]
}
const duration = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())

d('velocidad del clip (FFmpeg real)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cerebro-speed-'))
  const f = (n: string) => path.join(dir, n)
  ff('-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=2', '-filter_complex', '[0][1]concat=n=2:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('src.mp4'))
  const assets: Record<string, AssetFile> = { src: { path: f('src.mp4'), kind: 'video' } }
  const make = (speed: number | undefined, durationMs: number): Composition => {
    const c = addVideo({ ...emptyComposition('sb', 'v', '16:9'), editedManually: true }, 'src', durationMs)
    return { ...c, clips: c.clips.map(k => ({ ...k, ...(speed === undefined ? {} : { speed }) })) }
  }
  const render = async (c: Composition, name: string) => { const out = f(`${name}.mp4`); await renderProject({ composition: c, assets, output: out, workDir: f(`w-${name}`), fps: 10, preset: 'ultrafast' }); return out }
  // Rojo (luma ≈ 54 en BT.709) frente a azul (≈ 18): diferencia clara.
  const isRed = (v: number) => v > 36, isBlue = (v: number) => v <= 36

  it('velocidad 1: 2 s de clip muestran solo el rojo; velocidad 2: los mismos 2 s recorren rojo y luego azul', async () => {
    const normal = await render(make(1, 2000), 'v1'), rapido = await render(make(2, 2000), 'v2')
    expect(duration(normal)).toBeGreaterThan(1.8); expect(duration(normal)).toBeLessThan(2.3)
    expect(duration(rapido)).toBeGreaterThan(1.8); expect(duration(rapido)).toBeLessThan(2.3)
    expect(isRed(luma(normal, 0.5))).toBe(true); expect(isRed(luma(normal, 1.5))).toBe(true)
    expect(isRed(luma(rapido, 0.4))).toBe(true); expect(isBlue(luma(rapido, 1.6))).toBe(true)
  }, 240_000)

  it('velocidad 0.5: 2 s de clip solo recorren 1 s del original (todo rojo)', async () => {
    const lento = await render(make(0.5, 2000), 'v05')
    expect(isRed(luma(lento, 0.3))).toBe(true); expect(isRed(luma(lento, 1.7))).toBe(true)
  }, 240_000)

  it('el original no cambia', async () => {
    const before = await sha256File(f('src.mp4'))
    await render(make(2, 2000), 'v2b')
    expect(await sha256File(f('src.mp4'))).toBe(before)
  }, 240_000)
})
