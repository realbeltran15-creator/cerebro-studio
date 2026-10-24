/**
 * Offline renderer (no browser). Usage:
 *   node scripts/render.mjs render project.json --assets assets.json --out video.mp4 [--work DIR] [--fps 30] [--from SEC --to SEC] [--crf 20]
 *   node scripts/render.mjs ticket paquete-render.json --out video.mp4 [--work DIR]   (package downloaded from the editor: materials are fetched, then rendered)
 *   node scripts/render.mjs lofi --music song.mp3 --scenes a.mp4,b.jpg --minutes 90 --out lofi.mp4 [--clip 30] [--res 1080] [--work DIR]
 * assets.json: { "<assetId>": { "path": "/file", "kind": "video" | "image" | "audio" } }. project.json: a Composition (or a render_jobs row).
 * Run it again with the same --work folder to resume or to reuse segments.
 */
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseComposition } from '../lib/editor/composition'
import { buildLoopMontage } from '../lib/editor/loop-montage'
import { readTicket } from '../lib/render/ticket'
import { downloadTicketAssets } from '../lib/render/download'
import { renderProject, type AssetFile, type RenderEvent } from '../lib/render/engine'

const args = process.argv.slice(2)
const cmd = args[0]
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const need = (n: string) => { const v = opt(n); if (!v) { console.error(`Falta --${n}`); process.exit(2) } return v }

const fmt = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return `${h ? `${h} h ` : ''}${m} min ${Math.round(s % 60)} s` }
let last = 0
const onEvent = (e: RenderEvent) => {
  if (e.phase === 'plan') console.error(`Plan: ${e.totalFrames} fotogramas · ${e.segments} trozos (${e.unique} distintos, ${e.reused} repetidos, ${e.cached} ya hechos)`)
  else if (e.phase === 'video' && Date.now() - last > 4000) { last = Date.now(); console.error(`Vídeo ${(e.doneFrames / e.totalFrames * 100).toFixed(1)} % · trozo ${e.segment}/${e.segments}${e.fps ? ` · ${e.fps.toFixed(1)} fps` : ''}`) }
  else if (e.phase === 'audio' && Date.now() - last > 4000) { last = Date.now(); console.error(`Audio ${(e.doneMs / e.totalMs * 100).toFixed(1)} %`) }
  else if (e.phase === 'warning') console.error(`AVISO: ${e.message}`)
  else if (e.phase === 'mux') console.error('Uniendo trozos y audio…')
  else if (e.phase === 'done') console.error(`Listo en ${fmt(e.seconds)}: ${e.output}`)
}

function probeFile(file: string) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString()) as { streams: Array<{ codec_type: string; codec_name: string; nb_frames?: string; duration?: string }>; format: { duration?: string } }
  const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio')
  const still = v && /^(mjpeg|png|bmp|webp|gif|tiff)$/.test(v.codec_name) && (v.nb_frames === '1' || !j.format.duration || Number(j.format.duration) < 0.5)
  return { kind: (v ? (still || /\.(jpe?g|png|webp|bmp)$/i.test(file) ? 'image' : 'video') : a ? 'audio' : null) as AssetFile['kind'] | null, durationMs: Math.round(Number(j.format.duration ?? 0) * 1000) }
}

async function main() {
  const out = path.resolve(need('out'))
  if (cmd === 'render') {
    const raw = JSON.parse(await fs.readFile(args[1], 'utf8'))
    const composition = parseComposition(raw.composition ?? raw)
    if (!composition) throw new Error('El proyecto no es un montaje válido.')
    const assets = JSON.parse(await fs.readFile(need('assets'), 'utf8')) as Record<string, AssetFile>
    const from = opt('from'), to = opt('to')
    const r = await renderProject({ composition, assets, output: out, workDir: path.resolve(opt('work') ?? `${out}.work`), fps: Number(opt('fps') ?? 30), crf: Number(opt('crf') ?? 20), fontFiles: (opt('font') ?? '').split(',').filter(Boolean), onEvent, ...(from || to ? { rangeMs: { from: Number(from ?? 0) * 1000, to: Number(to ?? 1e9) * 1000 } } : {}) })
    console.log(JSON.stringify(r))
  } else if (cmd === 'ticket') {
    const ticket = readTicket(JSON.parse(await fs.readFile(args[1], 'utf8')))
    const work = path.resolve(opt('work') ?? `${out}.work`)
    let shown = 0
    const assets = await downloadTicketAssets(ticket, path.join(work, 'materiales'), { onProgress: p => { if (Date.now() - shown > 3000) { shown = Date.now(); console.error(`Descargando material ${p.index}/${p.count}: ${(p.done / 1048576).toFixed(0)} MB${p.total ? ` de ${(p.total / 1048576).toFixed(0)}` : ''}`) } } })
    const r = await renderProject({ composition: ticket.composition, assets, output: out, workDir: work, fps: Number(opt('fps') ?? 30), crf: Number(opt('crf') ?? 20), fontFiles: (opt('font') ?? '').split(',').filter(Boolean), onEvent })
    console.log(JSON.stringify(r))
  } else if (cmd === 'lofi') {
    const work = path.resolve(opt('work') ?? `${out}.work`)
    await fs.mkdir(work, { recursive: true })
    const music = path.resolve(need('music'))
    const scenes = need('scenes').split(',').map(s => path.resolve(s.trim()))
    const assets: Record<string, AssetFile> = {}
    const mp = probeFile(music); assets.music = { path: music, kind: 'audio' }
    const sc = scenes.map((f, i) => { const p = probeFile(f); if (p.kind !== 'video' && p.kind !== 'image') throw new Error(`${f} no es un vídeo ni una imagen.`); assets[`scene${i}`] = { path: f, kind: p.kind }; return { assetId: `scene${i}`, kind: p.kind, durationMs: p.durationMs } })
    const built = buildLoopMontage({ title: opt('title') ?? 'Lo-fi', scenes: sc, music: { assetId: 'music', durationMs: mp.durationMs }, targetMs: Number(need('minutes')) * 60_000, clipMs: Number(opt('clip') ?? 30) * 1000, resolution: (opt('res') ?? '1080') as '1080', transitionMs: Number(opt('transition') ?? 1.5) * 1000 })
    for (const w of built.warnings) console.error(`Aviso: ${w}`)
    await fs.writeFile(path.join(work, 'project.json'), JSON.stringify(built.composition))
    await fs.writeFile(path.join(work, 'assets.json'), JSON.stringify(assets, null, 1))
    const r = await renderProject({ composition: built.composition, assets, output: out, workDir: work, fps: Number(opt('fps') ?? 30), crf: Number(opt('crf') ?? 20), fontFiles: (opt('font') ?? '').split(',').filter(Boolean), onEvent })
    console.log(JSON.stringify({ ...r, clips: built.clips }))
  } else { console.error('Uso: render <project.json> --assets assets.json --out video.mp4 | lofi --music m.mp3 --scenes a.mp4,b.jpg --minutes 90 --out lofi.mp4'); process.exit(2) }
}
main().catch(e => { console.error(`Error: ${e instanceof Error ? e.message : e}`); process.exit(1) })
