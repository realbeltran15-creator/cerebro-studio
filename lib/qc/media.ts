/**
 * Adaptador LOCAL de QC multimedia con ffprobe/ffmpeg (Fase 4B.2). Solo lee un archivo local: sin red.
 * Los argumentos van como array (execFile, sin shell): un nombre de archivo no puede inyectar comandos.
 * FAIL = ilegible, contenedor/decodificacion corruptos, material obligatorio ausente o render incompleto.
 * WARN/REVIEW = silencio, negro, posible duplicado: nunca rechazan solos un vídeo artístico.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { checkAudio, checkBlackFrames, checkFormat, checkIncomplete, verdictOf, type AudioMeta, type BlackSegment, type FormatSpec, type QcFinding, type QcVerdict, type SceneSpan, type VideoMeta } from './validators'

type Exec = { code: number; stdout: string; stderr: string }
const run = (cmd: string, args: string[], timeoutMs = 120_000): Promise<Exec> =>
  new Promise(resolve => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })

/** SHA-256 de un archivo local (para detectar cualquier alteración posterior al render). */
export const sha256File = (file: string) => new Promise<string>((res, rej) => {
  const h = createHash('sha256'); const st = createReadStream(file)
  st.on('data', c => h.update(c)); st.on('error', rej); st.on('end', () => res(h.digest('hex')))
})

export type MediaInfo = { framesDecoded: number | null; framesDeclared: number | null; meta: VideoMeta; audio: AudioMeta; fps: number; videoCodec: string | null; audioCodec: string | null; black: BlackSegment[]; integrityErrors: string[] }

const parseFps = (r: string | undefined) => { const [a, b] = (r ?? '0/1').split('/').map(Number); return b ? a / b : 0 }

export type MediaProbe = { ok: true; info: MediaInfo } | { ok: false; code: 'file_missing' | 'file_unreadable'; message: string }

export async function inspectMedia(file: string, o: { blackMinSec?: number; silenceMinSec?: number } = {}): Promise<MediaProbe> {
  const abs = path.resolve(file)
  let size = 0
  try { const s = await stat(abs); if (!s.isFile()) throw new Error('no es un archivo'); size = s.size } catch { return { ok: false, code: 'file_missing', message: 'El archivo no existe o no es legible.' } }
  if (size === 0) return { ok: false, code: 'file_unreadable', message: 'El archivo está vacío.' }
  const probe = await run('ffprobe', ['-v', 'error', '-count_frames', '-print_format', 'json', '-show_format', '-show_streams', abs])
  let j: { streams?: Array<Record<string, string | number>>; format?: Record<string, string> } = {}
  try { j = JSON.parse(probe.stdout) } catch { /* ilegible */ }
  const v = j.streams?.find(s => s.codec_type === 'video')
  if (probe.code !== 0 || !v || !j.format) return { ok: false, code: 'file_unreadable', message: 'ffprobe no puede leer el contenedor o no hay pista de vídeo.' }
  const a = j.streams?.find(s => s.codec_type === 'audio')
  const durationMs = Math.round(Number(j.format.duration ?? v.duration ?? 0) * 1000)
  const fmt = String(j.format.format_name ?? '')
  const meta: VideoMeta = { durationMs, width: Number(v.width), height: Number(v.height), mimeType: fmt.includes('mp4') ? 'video/mp4' : fmt.includes('webm') ? 'video/webm' : 'application/octet-stream', videoCodec: String(v.codec_name ?? ''), bytes: size }

  // Integridad: decodificar todo el archivo sin salida; cualquier error de ffmpeg es corrupcion.
  const dec = await run('ffmpeg', ['-v', 'error', '-xerror', '-i', abs, '-f', 'null', '-'])
  const integrityErrors = dec.code !== 0 || dec.stderr.trim() ? dec.stderr.trim().split('\n').filter(Boolean).slice(0, 5) : []

  const blk = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', abs, '-vf', `blackdetect=d=${o.blackMinSec ?? 0.5}:pic_th=0.98:pix_th=0.10`, '-an', '-f', 'null', '-'])
  const black: BlackSegment[] = [...blk.stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map(m => ({ startMs: Math.round(Number(m[1]) * 1000), endMs: Math.round(Number(m[2]) * 1000) }))

  let silentRatio = 0
  let decodable = true
  if (a) {
    const sil = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', abs, '-vn', '-af', `silencedetect=noise=-50dB:d=${o.silenceMinSec ?? 1}`, '-f', 'null', '-'])
    decodable = !/Error while decoding stream #\d+:\d+|Invalid data found/i.test(sil.stderr) && sil.code === 0
    const starts = [...sil.stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => Number(m[1]))
    const ends = [...sil.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => Number(m[1]))
    const total = durationMs / 1000
    let silent = 0
    starts.forEach((s, i) => { silent += (ends[i] ?? total) - s })
    silentRatio = total > 0 ? Math.min(1, silent / total) : 0
  }
  const num = (x: unknown) => (x !== undefined && x !== 'N/A' && Number.isFinite(Number(x)) ? Number(x) : null)
  return { ok: true, info: { framesDecoded: num(v.nb_read_frames), framesDeclared: num(v.nb_frames), meta, audio: { hasStream: !!a, decodable, silentRatio }, fps: parseFps(String(v.avg_frame_rate)), videoCodec: meta.videoCodec ?? null, audioCodec: a ? String(a.codec_name) : null, black, integrityErrors } }
}

export type QcRequest = {
  file: string
  spec: FormatSpec
  narrationExpected?: boolean
  audioExpected?: boolean
  scenes?: SceneSpan[]
  provenance?: Record<string, unknown> | null
  clips?: Array<{ id: string; visualAssetId: string | null; narration?: string | null; voiceAssetId?: string | null }>
  fingerprint?: string
  previousRenders?: Array<{ renderId: string; fingerprint: string }>
  minFps?: number
  /** SHA-256 registrado cuando se terminó el render: cualquier alteración posterior (incluso la que el decodificador disimula) es FAIL. */
  expectedSha256?: string
}
export type QcReport = { verdict: QcVerdict; findings: QcFinding[]; info: MediaInfo | null }

/** Ejecuta todos los controles sobre un MP4 real y devuelve fallo / advertencia / revisión humana / correcto. */
export async function runMediaQc(r: QcRequest): Promise<QcReport> {
  const probe = await inspectMedia(r.file)
  const findings: QcFinding[] = []
  if (!probe.ok) {
    findings.push({ check: 'file', severity: 'fail', code: probe.code, message: probe.message })
    return { verdict: 'fail', findings, info: null }
  }
  const { info } = probe
  if (info.integrityErrors.length) findings.push({ check: 'file', severity: 'fail', code: 'container_corrupt', message: `Errores al decodificar: ${info.integrityErrors[0]}` })
  if (info.framesDecoded !== null && info.framesDeclared !== null && info.framesDecoded < info.framesDeclared * 0.98 - 1) {
    findings.push({ check: 'file', severity: 'fail', code: 'frames_missing', message: `Se decodificaron ${info.framesDecoded} de ${info.framesDeclared} fotogramas.` })
  }
  if (r.expectedSha256 && (await sha256File(path.resolve(r.file))) !== r.expectedSha256) {
    findings.push({ check: 'file', severity: 'fail', code: 'integrity_hash_mismatch', message: 'El archivo no coincide con la huella registrada al terminar el render.' })
  }
  findings.push(...checkFormat(info.meta, r.spec))
  if (info.fps < (r.minFps ?? 5)) findings.push({ check: 'format', severity: 'fail', code: 'fps_too_low', message: `FPS ${info.fps.toFixed(1)} demasiado bajos.` })
  findings.push(...checkAudio(info.audio, { narrationExpected: r.narrationExpected === true, audioExpected: r.audioExpected === true }))
  findings.push(...checkBlackFrames(info.black, r.scenes ?? [], info.meta.durationMs))
  if (r.provenance !== undefined || r.clips) findings.push(...checkIncomplete({ provenance: r.provenance, clips: r.clips ?? [] }))
  if (r.fingerprint) {
    const dup = (r.previousRenders ?? []).filter(p => p.fingerprint === r.fingerprint)
    if (dup.length) findings.push({ check: 'duplicate', severity: 'warn', code: 'possible_duplicate', message: `Misma composición que el render ${dup[0].renderId}.` })
  }
  return { verdict: verdictOf(findings), findings, info }
}
