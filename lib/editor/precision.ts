/**
 * Edición de precisión (como Premiere / DaVinci / Final Cut): deslizar contenido (slip), deslizar clip (slide), corte rodante (roll),
 * y cortes en J / en L (el sonido entra antes o sale después que la imagen). Todo no destructivo y sobre la pista principal magnética.
 */
import type { Composition } from './composition'
import { clipStarts, MIN_CLIP_MS } from './composition'

/** SLIP: el clip conserva posición y duración; cambia QUÉ parte del archivo se ve (+ = más adelante). Limitado al archivo. */
export function slipClip(c: Composition, clipId: string, deltaMs: number): Composition {
  const k = c.clips.find(x => x.id === clipId)
  if (!k) return c
  const s = k.speed ?? 1, window = k.durationMs * s, trim = k.trimInMs ?? 0
  const max = k.sourceDurationMs !== undefined ? Math.max(0, k.sourceDurationMs - window) : Infinity
  const next = Math.round(Math.min(Math.max(trim + deltaMs, 0), max))
  if (next === trim) return c
  return { ...c, clips: c.clips.map(x => (x.id === clipId ? { ...x, trimInMs: next } : x)) }
}

/**
 * ROLL: mueve el corte entre el clip y el siguiente. Uno gana lo que el otro pierde; el total no cambia.
 * delta > 0: el corte se retrasa (el clip se alarga por el final y el siguiente empieza más tarde en su archivo).
 */
export function rollEdit(c: Composition, clipId: string, deltaMs: number): Composition {
  const i = c.clips.findIndex(x => x.id === clipId)
  const a = c.clips[i], b = c.clips[i + 1]
  if (!a || !b || a.reverse || b.reverse) return c
  const sa = a.speed ?? 1, sb = b.speed ?? 1
  let d = Math.round(deltaMs)
  // El siguiente no puede quedar por debajo del mínimo ni empezar antes del inicio de su archivo; A no puede pasar del final de su archivo.
  d = Math.min(d, b.durationMs - MIN_CLIP_MS)
  d = Math.max(d, MIN_CLIP_MS - a.durationMs)
  d = Math.max(d, -Math.floor(((b.trimInMs ?? 0)) / sb))
  if (a.sourceDurationMs !== undefined) d = Math.min(d, Math.floor((a.sourceDurationMs - (a.trimInMs ?? 0)) / sa - a.durationMs))
  if (d === 0) return c
  const clips = c.clips.map((x, n) => (n === i ? { ...x, durationMs: x.durationMs + d, ...(x.cues ? { cues: undefined } : {}) } : n === i + 1 ? { ...x, durationMs: x.durationMs - d, trimInMs: Math.round((x.trimInMs ?? 0) + d * sb), ...(x.cues ? { cues: undefined } : {}) } : x))
  return { ...c, clips }
}

/**
 * SLIDE: el clip se desplaza en la línea de tiempo y su contenido no cambia; el anterior se alarga o acorta por el final y el siguiente
 * por el principio. delta > 0 lo mueve hacia la derecha.
 */
export function slideClip(c: Composition, clipId: string, deltaMs: number): Composition {
  const i = c.clips.findIndex(x => x.id === clipId)
  const p = c.clips[i - 1], n = c.clips[i + 1]
  if (!p || !n || p.reverse || n.reverse || c.clips[i].reverse) return c
  const sp = p.speed ?? 1, sn = n.speed ?? 1
  let d = Math.round(deltaMs)
  d = Math.min(d, n.durationMs - MIN_CLIP_MS)
  d = Math.max(d, MIN_CLIP_MS - p.durationMs)
  d = Math.max(d, -Math.floor((n.trimInMs ?? 0) / sn))
  if (p.sourceDurationMs !== undefined) d = Math.min(d, Math.floor((p.sourceDurationMs - (p.trimInMs ?? 0)) / sp - p.durationMs))
  if (d === 0) return c
  const clips = c.clips.map((x, m) => (m === i - 1 ? { ...x, durationMs: x.durationMs + d, cues: undefined } : m === i + 1 ? { ...x, durationMs: x.durationMs - d, trimInMs: Math.round((x.trimInMs ?? 0) + d * sn), cues: undefined } : x))
  return { ...c, clips }
}

/**
 * Corte en J o en L: el sonido enlazado al clip empieza `ms` antes (J) del corte o el del clip anterior termina `ms` después (L).
 * Se implementa moviendo el desfase del audio enlazado al clip; ms > 0 siempre; el audio no puede empezar antes del inicio del montaje.
 */
export function splitEditJL(c: Composition, clipId: string, kind: 'J' | 'L', ms: number): Composition {
  const i = c.clips.findIndex(x => x.id === clipId)
  if (i < 0) return c
  const amount = Math.max(0, Math.round(ms))
  if (kind === 'J') {
    // Sonido del clip: entra antes de la imagen.
    const start = clipStarts(c)[i] ?? 0
    const back = Math.min(amount, start)
    if (back <= 0) return c
    return { ...c, audioClips: (c.audioClips ?? []).map(a => (a.linkedClipId === clipId ? { ...a, offsetMs: a.offsetMs - back, trimInMs: Math.max(0, a.trimInMs - back), durationMs: a.durationMs + Math.min(back, a.trimInMs) } : a)) }
  }
  // L: el sonido del clip sigue después del corte (se alarga por el final).
  return { ...c, audioClips: (c.audioClips ?? []).map(a => (a.linkedClipId === clipId ? { ...a, durationMs: a.durationMs + amount } : a)) }
}
