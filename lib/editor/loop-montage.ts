import { addClip, updateClip } from './timeline'
import { emptyComposition, MAX_CLIP_MS, MAX_TIMELINE_MS, MIN_CLIP_MS, type CameraKind, type Composition, type ExportResolution, type OutputFormat, type Transition } from './composition'

/**
 * «Prepara un vídeo lo-fi de 90 minutos con esta música, estas escenas, transiciones suaves y exportación a 1080p».
 * Deterministic (no AI, no credits): the scenes are laid out one after another in a loop until the target length is reached, joined by
 * smooth transitions, with the music repeating under them. The montage is an ordinary Composition: the editor opens it, the browser
 * exporter and the offline engine render it.
 *
 * Videos play from the start of their file for `clipMs` (never longer than the file: the clip would freeze); photos get a slow camera move.
 */
export type LoopScene = { assetId: string; kind: 'video' | 'image'; /** Length of the file (ms). Required for videos. */ durationMs?: number | null }
export type LoopOptions = {
  title: string
  scenes: LoopScene[]
  music: { assetId: string; durationMs?: number | null } | null
  targetMs: number
  /** Length of each stretch of the loop (ms). Default 30 s. */
  clipMs?: number
  transition?: Transition
  transitionMs?: number
  format?: OutputFormat
  resolution?: ExportResolution
  musicVolume?: number
  camera?: CameraKind
}

export const LOOP_DEFAULTS = { clipMs: 30_000, transition: 'dissolve' as Transition, transitionMs: 1500, musicVolume: 0.9, resolution: '1080' as ExportResolution }

export function buildLoopMontage(o: LoopOptions): { composition: Composition; clips: number; warnings: string[] } {
  const warnings: string[] = []
  if (!o.scenes.length) throw new Error('Hace falta al menos una escena (vídeo o imagen).')
  const target = Math.round(Math.min(MAX_TIMELINE_MS, Math.max(MIN_CLIP_MS, o.targetMs)))
  if (o.targetMs > MAX_TIMELINE_MS) warnings.push(`El editor admite hasta ${MAX_TIMELINE_MS / 3600_000} h: se ha acortado.`)
  const want = Math.min(MAX_CLIP_MS, Math.max(MIN_CLIP_MS * 3, Math.round(o.clipMs ?? LOOP_DEFAULTS.clipMs)))
  const trans = o.transition ?? LOOP_DEFAULTS.transition
  const tMs = Math.max(0, Math.round(o.transitionMs ?? LOOP_DEFAULTS.transitionMs))
  let c: Composition = { ...emptyComposition(`loop-${globalThis.crypto.randomUUID()}`, o.title, o.format ?? '16:9'), editedManually: true, fadeMs: tMs, musicVolume: o.musicVolume ?? LOOP_DEFAULTS.musicVolume, duckMusic: false }
  c = { ...c, exportSettings: { quality: 'normal', resolution: o.resolution ?? LOOP_DEFAULTS.resolution, destination: 'download', mode: 'fast' } }
  // Each stretch is as long as `want`, or as long as the video file when that is shorter (a video clip never runs past its file).
  const lens = o.scenes.map(s => {
    if (s.kind === 'image') return want
    const d = Math.floor(s.durationMs ?? 0)
    if (d < MIN_CLIP_MS) { warnings.push('Un vídeo no tiene duración conocida o es muy corto: se usa su inicio unos segundos.'); return MIN_CLIP_MS * 3 }
    return Math.min(want, d)
  })
  let t = 0, i = 0
  while (t < target) {
    const s = o.scenes[i % o.scenes.length]
    let len = lens[i % o.scenes.length]
    // A transition overlaps the next clip (the incoming picture is held), so the loop needs no extra length; the last stretch is trimmed to fit.
    len = Math.min(len, target - t)
    if (len < MIN_CLIP_MS) { if (c.clips.length) { const last = c.clips[c.clips.length - 1]; c = updateClip(c, last.id, { durationMs: last.durationMs + len }); } break }
    c = addClip(c, s.assetId, len)
    const k = c.clips[c.clips.length - 1]
    c = updateClip(c, k.id, { transition: t + len >= target ? 'fade' : trans, transitionMs: tMs, trimInMs: 0, ...(s.kind === 'image' ? { camera: { kind: o.camera ?? (i % 2 ? 'zoom_out' : 'zoom_in'), amount: 0.08 } } : {}) })
    t += len; i++
  }
  if (o.music) {
    c = { ...c, musicAssetId: o.music.assetId }
    if (o.music.durationMs && o.music.durationMs < target) warnings.push('La música es más corta que el vídeo: se repite en bucle.')
  } else warnings.push('Sin música: el vídeo no tendrá audio de fondo.')
  return { composition: c, clips: c.clips.length, warnings }
}
