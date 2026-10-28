/**
 * «Invertir vídeo»: a non-destructive, per-clip property (`reverse`). The file is never rewritten; the clip just reads its stretch of the
 * source backwards. Everything that needs «where in the source is this clip at local time t?» goes through `sourceAt`, so the preview and
 * the exporter cannot disagree.
 *
 * A clip consumes the source window [trimInMs, trimInMs + durationMs × speed]. Forward it reads that window from the start; reversed it
 * reads it from the end. Sampling sits half a source frame (at 30 fps) inside the window so that the last source frame is shown first and
 * the first one last (frame centres, never on a frame boundary where rounding could pick the neighbour).
 */
import type { Clip, Composition, OverlayClip } from './composition'

/** One frame at the editor's reference rate (30 fps), in ms. */
export const FRAME_MS = 1000 / 30
/** Half a source frame: how far inside the window a reversed clip samples. */
const HALF_FRAME_MS = FRAME_MS / 2

type Reversible = Pick<Clip, 'trimInMs' | 'speed' | 'durationMs' | 'reverse'> | Pick<OverlayClip, 'trimInMs' | 'speed' | 'durationMs' | 'reverse'>

/** Position in the source file (ms) of a clip at `local` ms from its start. */
export function sourceAt(clip: Reversible, local: number): number {
  const trim = clip.trimInMs ?? 0, s = clip.speed ?? 1
  if (!clip.reverse) return trim + local * s
  const window = clip.durationMs * s
  return Math.max(trim, trim + window - local * s - HALF_FRAME_MS * s)
}

/** Source window [from, to) a clip reads (ms), in source order whatever the direction. */
export const sourceWindow = (clip: Reversible) => ({ from: clip.trimInMs ?? 0, to: (clip.trimInMs ?? 0) + clip.durationMs * (clip.speed ?? 1) })

/**
 * The clip's duration changes at its END (the right edge of the timeline block). Forward, the source window just gets shorter or longer
 * at its far end. Reversed, the end of the block is the START of the source window, so the in-point moves instead.
 */
export function withEndDuration<T extends Reversible>(clip: T, durationMs: number): Pick<T, 'trimInMs' | 'durationMs'> {
  if (!clip.reverse) return { trimInMs: clip.trimInMs, durationMs } as Pick<T, 'trimInMs' | 'durationMs'>
  const s = clip.speed ?? 1, trim = clip.trimInMs ?? 0
  const wanted = trim + (clip.durationMs - durationMs) * s
  const nextTrim = Math.max(0, Math.round(wanted))
  // The in-point cannot go below the start of the file: the block then only grows as far as the file allows.
  const dur = nextTrim === Math.round(wanted) ? durationMs : clip.durationMs - (nextTrim - trim) / s
  return { trimInMs: nextTrim, durationMs: dur } as Pick<T, 'trimInMs' | 'durationMs'>
}

/** Clips that read their source backwards (their own sound is not played: reversed speech/music would be noise). */
export const isReversed = (c: Pick<Clip, 'reverse'> | undefined | null) => !!c?.reverse

/** Does the montage contain any reversed video? (cheap check before opening reverse decoders) */
export const hasReverse = (c: Composition) => c.clips.some(k => k.reverse) || (c.overlays ?? []).some(o => o.reverse)

/**
 * «Crear bucle ida y vuelta»: the copy that follows `clip` plays the same stretch backwards, one frame shorter at each end so the joins
 * (A → reversed A → A) never show the same frame twice: A ends on frame N-1, the reversed copy starts on N-2 and ends on 1, A starts on 0.
 * The loop is therefore 2N-2 frames long, and `loopDurationMs` says so.
 */
export function backCopyOf(clip: Clip): { trimInMs: number; durationMs: number } | null {
  const s = clip.speed ?? 1
  const cut = FRAME_MS // on the timeline: one frame at each end
  const durationMs = Math.round(clip.durationMs - 2 * cut)
  if (durationMs < 100) return null
  return { trimInMs: Math.round((clip.trimInMs ?? 0) + cut * s), durationMs }
}
export const loopDurationMs = (clip: Clip) => { const b = backCopyOf(clip); return clip.durationMs + (b ? b.durationMs : 0) }
