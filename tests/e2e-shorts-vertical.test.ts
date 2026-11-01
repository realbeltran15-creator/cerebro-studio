// @vitest-environment node
/**
 * Shorts/Reels/TikTok: reencuadre 16:9 -> 9:16 y 1:1 con FFmpeg REAL.
 * Comprueba: tamaño de salida, que el encuadre es ajustable (focusX), que NO se deforma (un cuadrado sigue siendo cuadrado) y que el original no cambia.
 * REAL: composición + motor offline + FFmpeg. Sin BD ni proveedores.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyComposition, exportPlan, type Composition, type OutputFormat } from '@/lib/editor/composition'
import { addVideo } from '@/lib/editor/timeline'
import { renderProject, type AssetFile } from '@/lib/render/engine'
import { sha256File } from '@/lib/qc/media'

const have = spawnSync('ffmpeg', ['-version']).status === 0
const d = have ? describe : describe.skip
const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])

/** Fotograma en gris (w×h) del archivo en el segundo t. */
function gray(file: string, t: number, w: number, h: number) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 })
  return { buf, at: (x: number, y: number) => buf[y * w + x] }
}

d('reencuadre vertical (FFmpeg real)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cerebro-vert-'))
  const f = (n: string) => path.join(dir, n)
  // 16:9: mitad izquierda ROJA, mitad derecha AZUL, con un cuadrado blanco de 120×120 centrado en el borde (x 260..380, y 120..240).
  ff('-f', 'lavfi', '-i', 'color=c=red:s=320x360:r=30', '-f', 'lavfi', '-i', 'color=c=blue:s=320x360:r=30', '-filter_complex', '[0][1]hstack,drawbox=x=260:y=120:w=120:h=120:color=white:t=fill', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('src.mp4'))
  const assets: Record<string, AssetFile> = { src: { path: f('src.mp4'), kind: 'video' } }
  const make = (format: OutputFormat, focusX?: number): Composition => {
    const c = addVideo({ ...emptyComposition('sb', 'v', format), editedManually: true }, 'src', 3000)
    return { ...c, clips: c.clips.map(k => ({ ...k, ...(focusX === undefined ? {} : { focusX }) })) }
  }
  const render = async (c: Composition, name: string) => { const out = f(`${name}.mp4`); await renderProject({ composition: c, assets, output: out, workDir: f(`w-${name}`), fps: 10, preset: 'ultrafast' }); return out }
  const size = (file: string) => { const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]).toString()); return [j.streams[0].width, j.streams[0].height] }

  it('9:16, 1:1 y 16:9 salen con el tamaño del plan de exportación', async () => {
    for (const fmt of ['9:16', '1:1', '16:9'] as const) {
      const out = await render(make(fmt), `fmt-${fmt.replace(':', 'x')}`)
      const p = exportPlan(make(fmt)); expect(size(out)).toEqual([p.width, p.height])
    }
  }, 240_000)

  it('el encuadre es ajustable: focusX 0 muestra la parte izquierda y 1 la derecha (no se pierde nada sin poder corregirlo)', async () => {
    const W = 72, H = 128
    const izq = gray(await render(make('9:16', 0), 'f0'), 1, W, H), der = gray(await render(make('9:16', 1), 'f1'), 1, W, H)
    // Luma BT.709: rojo ≈ 53, azul ≈ 20. Con focusX=0 todo el ancho visible es rojo y con focusX=1 todo es azul.
    const reds = [izq.at(5, 120), izq.at(W - 6, 120)], blues = [der.at(5, 120), der.at(W - 6, 120)]
    for (const r of reds) for (const b of blues) expect(r - b).toBeGreaterThan(20)
    expect(Math.abs(reds[0] - reds[1])).toBeLessThan(10); expect(Math.abs(blues[0] - blues[1])).toBeLessThan(10)
  }, 240_000)

  it('no deforma: el cuadrado blanco sigue siendo cuadrado en 9:16 y en 1:1', async () => {
    for (const [fmt, W, H] of [['9:16', 144, 256], ['1:1', 200, 200]] as Array<['9:16' | '1:1', number, number]>) {
      const g = gray(await render(make(fmt, 0.5), `sq-${fmt.replace(':', 'x')}`), 1, W, H)
      let minX = W, maxX = -1, minY = H, maxY = -1
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.at(x, y) > 200) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
      expect(maxX).toBeGreaterThan(minX)
      const ratio = (maxX - minX + 1) / (maxY - minY + 1)
      expect(ratio).toBeGreaterThan(0.9); expect(ratio).toBeLessThan(1.1)
    }
  }, 240_000)

  it('el original no se modifica', async () => {
    const before = await sha256File(f('src.mp4')); await render(make('9:16'), 'again')
    expect(await sha256File(f('src.mp4'))).toBe(before)
  }, 120_000)
})
