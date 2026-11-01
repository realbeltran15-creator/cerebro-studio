// @vitest-environment node
/**
 * Música y Sonido: mezcla REAL con FFmpeg (motor offline + medición con volumedetect/astats).
 * REAL: addAudioClip/composición, mezcla del motor (lib/render/engine), FFmpeg/FFprobe. Sin base de datos ni proveedores.
 * NO cubierto: la reproducción en vivo del navegador (WebAudio).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyComposition, projectDurationMs, type Composition } from '@/lib/editor/composition'
import { addAudioClip, addVideo } from '@/lib/editor/timeline'
import { renderProject, type AssetFile } from '@/lib/render/engine'
import { inspectMedia } from '@/lib/qc/media'

const have = spawnSync('ffmpeg', ['-version']).status === 0
const d = have ? describe : describe.skip
const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
/** Nivel medio (dB) del tramo [from, from+len) del audio del archivo. */
const level = (file: string, from = 0, len = 100) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(from), '-t', String(len), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr); return m ? Number(m[1]) : -Infinity
}

d('mezcla de música y sonido (FFmpeg real)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cerebro-mix-'))
  const f = (n: string) => path.join(dir, n)
  ff('-f', 'lavfi', '-i', 'color=c=0x303030:s=640x360:r=30', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('mudo.mp4'))       // vídeo SIN audio
  ff('-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=10', '-ac', '2', f('musica.wav'))
  ff('-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=2', '-ac', '2', f('efecto.wav'))
  const assets: Record<string, AssetFile> = { mudo: { path: f('mudo.mp4'), kind: 'video' }, musica: { path: f('musica.wav'), kind: 'audio' }, efecto: { path: f('efecto.wav'), kind: 'audio' } }
  const base = (): Composition => addVideo({ ...emptyComposition('sb', 'mix', '16:9'), editedManually: true }, 'mudo', 6000)
  const music = (c: Composition, o: Partial<Parameters<typeof addAudioClip>[1]> = {}) => addAudioClip(c, { assetId: 'musica', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 6000, volume: 1, muted: false, ...o })
  const render = async (c: Composition, name: string) => { const out = f(`${name}.mp4`); await renderProject({ composition: c, assets, output: out, workDir: f(`w-${name}`), fps: 10, preset: 'ultrafast' }); return out }

  it('vídeo sin audio + música: el MP4 tiene pista de audio decodificable y duración del vídeo', async () => {
    const c = music(base()); const out = await render(c, 'mudo-musica')
    const qc = await inspectMedia(out); expect(qc.ok).toBe(true)
    if (qc.ok) { expect(qc.info.audio.hasStream).toBe(true); expect(qc.info.audio.decodable).toBe(true); expect(Math.abs(qc.info.meta.durationMs - projectDurationMs(c))).toBeLessThan(300) }
    expect(level(out)).toBeGreaterThan(-40)
  }, 120_000)

  it('el volumen se aplica: 0,25 suena ~12 dB por debajo de 1 (±1,5 dB)', async () => {
    const alto = level(await render(music(base(), { volume: 1 }), 'vol1'))
    const bajo = level(await render(music(base(), { volume: 0.25 }), 'vol025'))
    expect(alto - bajo).toBeGreaterThan(10.5); expect(alto - bajo).toBeLessThan(13.5)
  }, 180_000)

  it('silenciada = silencio; sin música y vídeo mudo = pista de audio presente o ausente sin romper', async () => {
    const out = await render(music(base(), { muted: true }), 'muted')
    expect(level(out)).toBeLessThan(-60)
    const solo = await render(base(), 'solo-mudo'); const qc = await inspectMedia(solo); expect(qc.ok).toBe(true)
  }, 180_000)

  it('fundidos de entrada y salida: el principio y el final suenan más bajo que el centro', async () => {
    const out = await render(music(base(), { fadeInMs: 2000, fadeOutMs: 2000 }), 'fades')
    const ini = level(out, 0, 0.5), mid = level(out, 2.5, 1), fin = level(out, 5.5, 0.5)
    expect(mid - ini).toBeGreaterThan(6); expect(mid - fin).toBeGreaterThan(6)
  }, 120_000)

  it('recorte y desplazamiento: la música que empieza en 3 s deja el primer tramo en silencio', async () => {
    const out = await render(music(base(), { startMs: 3000, durationMs: 3000 }), 'offset')
    expect(level(out, 0, 2.5)).toBeLessThan(-60); expect(level(out, 3.5, 2)).toBeGreaterThan(-40)
  }, 120_000)

  it('varias pistas se suman (música + efecto) sin recortar: más fuerte que la música sola', async () => {
    const solo = level(await render(music(base(), { volume: 0.5 }), 'una'))
    const dos = level(await render(addAudioClip(music(base(), { volume: 0.5 }), { assetId: 'efecto', kind: 'sfx', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 2000, volume: 0.5, muted: false }), 'dos'), 0, 2)
    const unaIni = level(await render(music(base(), { volume: 0.5 }), 'una-b'), 0, 2)
    expect(dos).toBeGreaterThan(unaIni); expect(solo).toBeLessThan(0)
    const peak = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f('dos.mp4'), '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
    expect(Number(/max_volume:\s*(-?[\d.]+) dB/.exec(peak)?.[1])).toBeLessThanOrEqual(0.01)
  }, 240_000)
})
