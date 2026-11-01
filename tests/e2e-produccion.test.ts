// @vitest-environment node
/**
 * E2E de producción LOCAL con FFmpeg/FFprobe reales.
 * REAL: scriptToScenes, syncWithScenes (storyboard->montaje), SRT/VTT (exportSubtitles/parseSubtitles), motor de render offline
 *       (lib/render/engine = mismas funciones puras que el editor), FFmpeg/FFprobe, QC de medios (lib/qc/media inspectMedia).
 * SIMULADO: base de datos y almacenamiento (Supabase/R2): el paso "Biblioteca" usa un doble en memoria; NO es integración real.
 * NO CUBIERTO: el exportador del navegador (WebCodecs/MediaRecorder), que solo se puede probar en un Chromium real.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderProject, type AssetFile } from '@/lib/render/engine'
import { scriptToScenes } from '@/lib/scripts'
import { emptyComposition, exportPlan, projectDurationMs, syncWithScenes, type Composition } from '@/lib/editor/composition'
import { exportSubtitles, parseSubtitles } from '@/lib/editor/subtitles'
import { inspectMedia } from '@/lib/qc/media'

const have = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
const d = have ? describe : describe.skip
const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
const probeJson = (f: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-print_format', 'json', '-show_format', '-show_streams', f]).toString())

d('E2E producción local (FFmpeg real)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cerebro-e2e-'))
  const f = (n: string) => path.join(dir, n)
  // Materiales locales de prueba (gratis, generados con lavfi): 2 vídeos de colores distintos, 2 imágenes, 1 pista de audio.
  ff('-f', 'lavfi', '-i', 'color=c=0xd02020:s=640x360:r=30', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('rojo.mp4'))
  ff('-f', 'lavfi', '-i', 'color=c=0x20c020:s=640x360:r=30', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('verde.mp4'))
  ff('-f', 'lavfi', '-i', 'color=c=0x2020d0:s=640x360', '-frames:v', '1', f('azul.png'))
  ff('-f', 'lavfi', '-i', 'color=c=0xe0e020:s=640x360', '-frames:v', '1', f('amarillo.png'))
  ff('-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=20', '-ac', '2', f('musica.wav'))
  const assets: Record<string, AssetFile> = {
    rojo: { path: f('rojo.mp4'), kind: 'video' }, verde: { path: f('verde.mp4'), kind: 'video' },
    azul: { path: f('azul.png'), kind: 'image' }, amarillo: { path: f('amarillo.png'), kind: 'image' }, musica: { path: f('musica.wav'), kind: 'audio' },
  }
  const visuals = ['rojo', 'azul', 'verde', 'amarillo']

  // Guion de 4 escenas (hook + 2 secciones + CTA) -> escenas del storyboard.
  const script = {
    id: 's1', version: 1, hook: 'Esta historia empieza con un silencio extraño en el puerto.', cta: 'Suscríbete para la segunda parte.',
    sections: [
      { id: 'a', heading: 'Normalidad', basis: 'verified_fact' as const, text: 'Durante años el puerto funcionó como un reloj, sin incidentes ni retrasos notables en sus muelles.', sources: ['x'] },
      { id: 'b', heading: 'Ruptura', basis: 'reconstruction' as const, text: 'Una mañana de niebla, las grúas dejaron de moverse y nadie supo explicar por qué.', sources: [] },
    ],
  }
  const planned = scriptToScenes(script)
  const scenes = planned.map((p, i) => ({ id: `sc${i + 1}`, position: p.position, duration_ms: p.duration_ms, narration: p.narration }))
  const buildComp = (opts: { music?: boolean; subtitles?: boolean } = {}): Composition => {
    const base = syncWithScenes(emptyComposition('sb1', 'E2E puerto', '16:9'), scenes)
    return { ...base, subtitles: opts.subtitles ?? true, musicAssetId: opts.music === false ? null : 'musica', clips: base.clips.map((c, i) => ({ ...c, visualAssetId: visuals[i], durationMs: Math.max(2000, c.durationMs) })) }
  }
  const avgColor = (file: string, atSec: number) => {
    const out = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-']).toString('binary')
    return [out.charCodeAt(0), out.charCodeAt(1), out.charCodeAt(2)]
  }

  it('Guion -> Storyboard: 4 escenas ordenadas, con duración estimada y trazabilidad', () => {
    expect(scenes).toHaveLength(4)
    expect(scenes.map(s => s.position)).toEqual([1, 2, 3, 4])
    expect(planned.every(p => p.metadata.duration_is_estimate === true)).toBe(true)
  })

  it('Storyboard -> Montaje es idempotente y conserva lo asignado a mano', () => {
    const c = buildComp()
    const again = syncWithScenes(c, scenes)
    expect(again.clips.map(k => k.visualAssetId)).toEqual(visuals)
    expect(again.clips).toHaveLength(4)
    const reordered = syncWithScenes(c, [...scenes].reverse().map((s, i) => ({ ...s, position: i + 1 })))
    expect(reordered.clips.map(k => k.sceneId)).toEqual(['sc4', 'sc3', 'sc2', 'sc1'])
    expect(reordered.clips[0].visualAssetId).toBe('amarillo')
  })

  it('Montaje -> MP4 real: resolución, FPS, duración, códec, integridad, sincronía y fotogramas', async () => {
    const comp = buildComp()
    const out = f('final.mp4')
    await renderProject({ composition: comp, assets, output: out, workDir: f('w-ok'), fps: 10, preset: 'ultrafast' })
    const plan = exportPlan(comp), expectMs = projectDurationMs(comp)
    const p = probeJson(out)
    const v = p.streams.find((s: { codec_type: string }) => s.codec_type === 'video'), a = p.streams.find((s: { codec_type: string }) => s.codec_type === 'audio')
    console.log('FFPROBE', JSON.stringify({ file: out, codec: v.codec_name, w: v.width, h: v.height, fps: v.avg_frame_rate, frames: v.nb_read_frames, vdur: v.duration, adur: a?.duration, acodec: a?.codec_name, format: p.format.duration, expectMs }))
    expect(v.codec_name).toBe('h264'); expect(a.codec_name).toBe('aac')
    expect([v.width, v.height]).toEqual([plan.width, plan.height])
    expect(v.avg_frame_rate).toBe('10/1')
    expect(Math.abs(Number(p.format.duration) * 1000 - expectMs)).toBeLessThan(250)
    expect(Number(v.nb_read_frames)).toBe(Math.round(expectMs / 100))
    expect(Math.abs(Number(a.duration) - Number(v.duration))).toBeLessThan(0.15) // sincronía A/V al final
    const qc = await inspectMedia(out)
    expect(qc.ok).toBe(true)
    if (qc.ok) { expect(qc.info.framesDecoded).toBe(qc.info.framesDeclared); expect(qc.info.audio.decodable).toBe(true) }
    // Fotogramas: cada escena muestra su color en su tramo.
    const starts = [0]; for (const c of comp.clips) starts.push(starts[starts.length - 1] + c.durationMs)
    const dom = (rgb: number[]) => ['r', 'g', 'b'][rgb.indexOf(Math.max(...rgb))]
    const mid = (i: number) => (starts[i] + comp.clips[i].durationMs / 2) / 1000
    expect(dom(avgColor(out, mid(0)))).toBe('r'); expect(dom(avgColor(out, mid(1)))).toBe('b'); expect(dom(avgColor(out, mid(2)))).toBe('g')
    const y = avgColor(out, mid(3)); expect(y[0]).toBeGreaterThan(150); expect(y[1]).toBeGreaterThan(150); expect(y[2]).toBeLessThan(120)
  }, 180_000)

  it('Subtítulos SRT/VTT: salen del montaje, se leen de vuelta y cuadran en el tiempo', () => {
    const comp = buildComp()
    const srt = exportSubtitles(comp, 'srt'), vtt = exportSubtitles(comp, 'vtt')
    writeFileSync(f('subs.srt'), srt); writeFileSync(f('subs.vtt'), vtt)
    const back = parseSubtitles(readFileSync(f('subs.srt'), 'utf8'))
    expect(back.format).toBe('srt'); expect(back.cues.length).toBeGreaterThanOrEqual(4)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    const total = projectDurationMs(comp)
    expect(back.cues.every(q => q.startMs >= 0 && q.endMs > q.startMs && q.endMs <= total + 50)).toBe(true)
    // ffmpeg acepta el SRT real (prueba de formato válido, no solo de nuestro parser)
    expect(() => ff('-i', f('subs.srt'), f('subs-check.ass'))).not.toThrow()
  })

  it('Sin audio y con subtítulos desactivados: sigue siendo un MP4 válido', async () => {
    const comp = buildComp({ music: false, subtitles: false })
    const out = f('sin-audio.mp4')
    await renderProject({ composition: comp, assets, output: out, workDir: f('w-noaudio'), fps: 10, preset: 'ultrafast' })
    const qc = await inspectMedia(out)
    expect(qc.ok).toBe(true)
    if (qc.ok) expect(qc.info.framesDecoded).toBe(qc.info.framesDeclared)
  }, 180_000)

  it('Cancelación: no queda archivo final ni parcial con nombre de terminado', async () => {
    const comp = buildComp(); const out = f('cancel.mp4'); const ac = new AbortController()
    const p = renderProject({ composition: comp, assets, output: out, workDir: f('w-cancel'), fps: 10, preset: 'ultrafast', signal: ac.signal, onEvent: e => { if (e.phase === 'plan') setTimeout(() => ac.abort(), 30) } })
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(existsSync(out)).toBe(false)
  }, 120_000)

  it('Fallo de FFmpeg: rechaza, no deja el MP4 final y un reintento posterior funciona', async () => {
    const comp = buildComp(); const out = f('fallo.mp4')
    await expect(renderProject({ composition: comp, assets, output: out, workDir: f('w-fail'), fps: 10, preset: 'ultrafast', ffmpeg: '/bin/false' })).rejects.toThrow()
    expect(existsSync(out)).toBe(false)
    await renderProject({ composition: comp, assets, output: out, workDir: f('w-fail'), fps: 10, preset: 'ultrafast' })
    const qc = await inspectMedia(out); expect(qc.ok).toBe(true)
  }, 180_000)

  it('Material ausente o montaje sin clips: error claro y sin archivo final', async () => {
    const comp = buildComp(); const out = f('falta.mp4')
    await expect(renderProject({ composition: comp, assets: { ...assets, rojo: { path: f('no-existe.mp4'), kind: 'video' } }, output: out, workDir: f('w-miss'), fps: 10, preset: 'ultrafast' })).rejects.toThrow(/Falta|material|archivo/i)
    expect(existsSync(out)).toBe(false)
    const vacio = { ...comp, clips: [] }
    await expect(renderProject({ composition: vacio, assets, output: f('vacio.mp4'), workDir: f('w-empty'), fps: 10, preset: 'ultrafast' })).rejects.toThrow()
    expect(existsSync(f('vacio.mp4'))).toBe(false)
  }, 120_000)

  it('Dos exportaciones simultáneas a destinos distintos terminan válidas', async () => {
    const comp = buildComp()
    await Promise.all([1, 2].map(n => renderProject({ composition: comp, assets, output: f(`par${n}.mp4`), workDir: f(`w-par${n}`), fps: 10, preset: 'ultrafast' })))
    for (const n of [1, 2]) { const qc = await inspectMedia(f(`par${n}.mp4`)); expect(qc.ok).toBe(true) }
  }, 240_000)

  it('Dos exportaciones al MISMO destino y misma carpeta de trabajo: archivo final válido y sin restos', async () => {
    const comp = buildComp(); const out = f('mismo.mp4'); const work = f('w-mismo')
    await Promise.all([1, 2].map(() => renderProject({ composition: comp, assets, output: out, workDir: work, fps: 10, preset: 'ultrafast' })))
    const qc = await inspectMedia(out); expect(qc.ok).toBe(true)
    if (qc.ok) expect(qc.info.framesDecoded).toBe(qc.info.framesDeclared)
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(dir).filter(n => n.startsWith('mismo.mp4.') && n.endsWith('.part.mp4'))).toEqual([])
  }, 240_000)

  it('Un render fallido o cancelado nunca sustituye un MP4 final válido existente', async () => {
    const comp = buildComp(); const out = f('valido.mp4')
    await renderProject({ composition: comp, assets, output: out, workDir: f('w-v1'), fps: 10, preset: 'ultrafast' })
    const before = readFileSync(out)
    await expect(renderProject({ composition: comp, assets, output: out, workDir: f('w-v2'), fps: 10, preset: 'ultrafast', ffmpeg: '/bin/false' })).rejects.toThrow()
    const ac = new AbortController(); ac.abort()
    await expect(renderProject({ composition: comp, assets, output: out, workDir: f('w-v3'), fps: 10, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(readFileSync(out).equals(before)).toBe(true)
    const qc = await inspectMedia(out); expect(qc.ok).toBe(true)
  }, 240_000)

  it('Biblioteca (SIMULADA): un render incompleto no figura como terminado', async () => {
    const { incompleteRenderNotice } = await import('@/lib/editor/composition')
    const comp = buildComp(); const incomplete = { ...comp, clips: comp.clips.map((c, i) => (i === 1 ? { ...c, visualAssetId: null } : c)) }
    // Hallazgo honesto: con narración y SIN voz el montaje ya se considera incompleto (correcto: el vídeo no llevaría esa narración).
    expect(incompleteRenderNotice(comp)).toMatch(/sin voz/)
    const sinNarracion = { ...comp, clips: comp.clips.map(c => ({ ...c, narration: null })) }
    expect(incompleteRenderNotice(sinNarracion)).toBeNull()
    expect(incompleteRenderNotice({ ...sinNarracion, clips: sinNarracion.clips.map((c, i) => (i === 1 ? { ...c, visualAssetId: null } : c)) })).toMatch(/sin imagen ni vídeo/)
    void incomplete
  })
})
