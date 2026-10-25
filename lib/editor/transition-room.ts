/**
 * Material for a transition. Two videos that are used whole have no frames after the end of A nor before the start of B, so a transition
 * between them could only show a frozen frame on one side. The editor's explicit solution (the same one iMovie or CapCut apply): the clips
 * give their own edge to the transition. The end of A and the start of B are trimmed by exactly what is missing, so the trimmed frames become
 * the material that plays during the overlap. Nothing is invented and nothing is lost silently: the project gets shorter by the trimmed
 * time (reported in the message), and the trim is one undo step. Only what is missing is trimmed.
 */
import { MIN_CLIP_MS, type Composition } from './composition'
import { BLENDS } from './motion'
import { sliceCues } from './timeline'
import { transitionHandles, type MediaKindOf } from './transition-window'

export type RoomResult = {
  composition: Composition
  /** Milliseconds trimmed from the end of A and from the start of B (0 = nothing was missing). */
  trimmedAMs: number; trimmedBMs: number
  /** The transition length after the operation (it is shortened only when the clips are too short to give that much). */
  ms: number
  limited: boolean
  /** The clips are too short to give any material: nothing was changed. */
  failed: boolean
  /** A's file length is not known yet, so its side could not be checked. */
  unknown: boolean
  message: string
}

const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} s`

export function makeRoomForTransition(c: Composition, i: number, kindOf: MediaKindOf): RoomResult {
  const A = c.clips[i], B = c.clips[i + 1]
  const none = (extra: Partial<RoomResult> = {}): RoomResult => ({ composition: c, trimmedAMs: 0, trimmedBMs: 0, ms: A ? Math.round(A.transitionMs ?? c.fadeMs) : 0, limited: false, failed: false, unknown: false, message: '', ...extra })
  if (!A || !B || !BLENDS.has(A.transition ?? 'fade')) return none()
  const asked = Math.max(0, Math.round(A.transitionMs ?? c.fadeMs))
  for (let ms = asked; ms >= 100; ms -= 50) {
    let cur: Composition = { ...c, clips: c.clips.map((k, n) => (n === i ? { ...k, transitionMs: ms } : k)) }
    let tA = 0, tB = 0, unknown = false
    for (let pass = 0; pass < 3; pass++) {
      const h = transitionHandles(cur, i, kindOf)
      unknown = unknown || h.unknown
      const needA = h.unknown ? 0 : h.missingA, needB = h.missingB
      if (!needA && !needB) break
      cur = { ...cur, clips: cur.clips.map((k, n) => {
        if (n === i && needA) return { ...k, durationMs: k.durationMs - needA, ...(k.cues ? { cues: sliceCues(k.cues, 0, k.durationMs - needA) } : {}) }
        if (n === i + 1 && needB) return { ...k, durationMs: k.durationMs - needB, trimInMs: (k.trimInMs ?? 0) + needB * (k.speed ?? 1), ...(k.cues ? { cues: sliceCues(k.cues, needB, k.durationMs) } : {}) }
        return k
      }) }
      tA += needA; tB += needB
    }
    const a = cur.clips[i], b = cur.clips[i + 1], h = transitionHandles(cur, i, kindOf)
    const fits = a.durationMs >= MIN_CLIP_MS && b.durationMs >= MIN_CLIP_MS && ms <= a.durationMs && ms <= b.durationMs && h.ms === ms && h.missingB === 0 && (h.unknown || h.missingA === 0)
    if (!fits) continue
    const parts = [tA ? `${secs(tA)} del final del clip ${i + 1}` : '', tB ? `${secs(tB)} del principio del clip ${i + 2}` : ''].filter(Boolean)
    const message = parts.length
      ? `Para que los dos vídeos se muevan durante la transición se recortaron ${parts.join(' y ')}: ese material se reproduce en el solape. El proyecto dura ${secs(tA + tB)} menos${ms < asked ? `; la transición se limitó a ${secs(ms)} porque los clips no daban más` : ''}. Ctrl+Z lo deshace.`
      : ''
    if (!tA && !tB && ms === asked) return none()
    return { composition: cur, trimmedAMs: tA, trimmedBMs: tB, ms, limited: ms < asked, failed: false, unknown, message }
  }
  return none({ failed: true, message: 'Los clips son demasiado cortos para crear material de transición: alarga alguno o usa una transición más corta.' })
}
