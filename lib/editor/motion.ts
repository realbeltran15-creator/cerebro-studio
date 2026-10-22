/**
 * Pure maths for transitions and text animations, shared by the renderer (canvas) and the tests.
 * Transitions happen inside the last `fadeMs` of the outgoing clip, so the total duration never changes.
 */
import type { CameraMove, TextAnimation, Transition } from './composition'

/** How the outgoing (A) and incoming (B) clips are drawn at progress t (0 → 1) of the transition. */
export type TransitionFrame = {
  /** Opacity of a black layer over everything (fade through black). */
  black: number
  /** Opacity of a white layer over both clips (flash of light). */
  white: number
  aAlpha: number; bAlpha: number
  /** Incoming clip offset as a fraction of the width / height (slides; negative = from the other side). */
  bOffsetX: number; bOffsetY: number
  /** Fraction of B revealed (wipes) and from which edge. */
  bReveal: number; bRevealY: number; bRevealFrom: 'left' | 'right' | 'top' | 'bottom'
  /** Extra zoom applied to A (zoom in) and to B (zoom out). */
  aScale: number; bScale: number
  /** Blur of each clip in % of the frame height (blur transition). */
  aBlur: number; bBlur: number
}
export type TransitionDirection = 'left' | 'right' | 'up' | 'down'
export type TransitionEasing = 'smooth' | 'linear' | 'in' | 'out'
export type TransitionOpts = { direction?: TransitionDirection; intensity?: number; easing?: TransitionEasing }
export const EASINGS: Record<TransitionEasing, string> = { smooth: 'Suave (entra y sale despacio)', linear: 'Lineal', in: 'Acelera', out: 'Frena al final' }
export const DIRECTIONS: Record<TransitionDirection, string> = { left: 'Hacia la izquierda', right: 'Hacia la derecha', up: 'Hacia arriba', down: 'Hacia abajo' }
/** Transitions with a direction, and with an intensity. */
export const HAS_DIRECTION: ReadonlySet<Transition> = new Set<Transition>(['slide', 'wipe', 'slide_up', 'wipe_down'])
export const HAS_INTENSITY: ReadonlySet<Transition> = new Set<Transition>(['zoom', 'zoom_out', 'blur', 'flash'])

const smooth = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const ease = smooth
export const easeBy = (e: TransitionEasing | undefined, t: number) => (e === 'linear' ? t : e === 'in' ? t * t : e === 'out' ? 1 - (1 - t) * (1 - t) : smooth(t))
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** Transitions that draw the next clip during the overlap (the rest only touch the outgoing clip). */
export const BLENDS: ReadonlySet<Transition> = new Set<Transition>(['dissolve', 'slide', 'wipe', 'zoom', 'zoom_out', 'blur', 'slide_up', 'wipe_down', 'flash'])

export function transitionFrame(kind: Transition, rawT: number, o: TransitionOpts = {}): TransitionFrame {
  const t = clamp01(rawT), e = easeBy(o.easing, t)
  const k = Math.min(3, Math.max(0.1, o.intensity ?? 1))
  const base: TransitionFrame = { black: 0, white: 0, aAlpha: 1, bAlpha: 0, bOffsetX: 0, bOffsetY: 0, bReveal: 1, bRevealY: 1, bRevealFrom: 'left', aScale: 1, bScale: 1, aBlur: 0, bBlur: 0 }
  const dir: TransitionDirection = o.direction ?? (kind === 'slide_up' ? 'up' : kind === 'wipe_down' ? 'down' : kind === 'wipe' ? 'right' : 'left')
  switch (kind) {
    case 'dissolve': return { ...base, bAlpha: e }
    // Slides: the incoming clip travels in the chosen direction (left = enters from the right edge).
    case 'slide': case 'slide_up': {
      const r = 1 - e
      return { ...base, bAlpha: 1, bOffsetX: dir === 'left' ? r : dir === 'right' ? -r : 0, bOffsetY: dir === 'up' ? r : dir === 'down' ? -r : 0 }
    }
    // Wipes: the edge of the incoming clip moves in the chosen direction (right = reveals from the left edge).
    case 'wipe': case 'wipe_down': {
      if (dir === 'up' || dir === 'down') return { ...base, bAlpha: 1, bRevealY: e, bRevealFrom: dir === 'down' ? 'top' : 'bottom' }
      return { ...base, bAlpha: 1, bReveal: e, bRevealFrom: dir === 'right' ? 'left' : 'right' }
    }
    case 'zoom': return { ...base, aScale: 1 + 0.35 * k * e, bAlpha: clamp01((t - 0.35) / 0.65) }
    case 'zoom_out': return { ...base, bScale: 1 + 0.35 * k * (1 - e), bAlpha: e }
    // The outgoing clip blurs out while the incoming one comes in blurred and sharpens.
    case 'blur': return { ...base, aBlur: 3 * k * e, bBlur: 3 * k * (1 - e), bAlpha: e }
    // A flash of light: everything goes bright, the cut happens at the brightest point, then the light fades.
    case 'flash': return { ...base, bAlpha: t >= 0.5 ? 1 : 0, white: Math.min(1, k) * (1 - Math.abs(2 * e - 1)) }
    default: return base
  }
}

export type TextFrame = { alpha: number; scale: number; offsetY: number; visibleChars: number | null }
const IN_MS = 450, OUT_MS = 300

/** State of an on-screen text at `localMs` inside a clip of `durationMs`. It always ends fully readable before fading out. */
export function textFrame(anim: TextAnimation | undefined, localMs: number, durationMs: number, length: number): TextFrame {
  const shown: TextFrame = { alpha: 1, scale: 1, offsetY: 0, visibleChars: null }
  if (!anim || anim === 'none') return shown
  const inMs = Math.min(IN_MS, durationMs / 3)
  const outMs = Math.min(OUT_MS, durationMs / 4)
  const tin = clamp01(localMs / Math.max(1, inMs)), eIn = ease(tin)
  const fadeOut = localMs > durationMs - outMs ? clamp01((durationMs - localMs) / Math.max(1, outMs)) : 1
  switch (anim) {
    case 'fade': return { ...shown, alpha: eIn * fadeOut }
    case 'pop': {
      // Overshoots slightly (1.12) then settles at 1.
      const s = tin < 0.7 ? 0.6 + (1.12 - 0.6) * (tin / 0.7) : 1.12 - 0.12 * ((tin - 0.7) / 0.3)
      return { ...shown, alpha: Math.min(1, tin * 2) * fadeOut, scale: s }
    }
    case 'slide': return { ...shown, alpha: eIn * fadeOut, offsetY: (1 - eIn) * 0.08 }
    case 'typewriter': {
      // Types the text over the first 40% of the clip (at most 2.5 s), then holds.
      const typeMs = Math.min(2500, durationMs * 0.4)
      return { ...shown, alpha: fadeOut, visibleChars: Math.min(length, Math.ceil(length * clamp01(localMs / Math.max(1, typeMs)))) }
    }
    default: return shown
  }
}

export type CameraFrame = { zoom: number; focusX: number | null; focusY: number | null }
/**
 * Camera movement at progress p (0 → 1) of a clip: a zoom multiplier and, for pans, the crop focus on that axis
 * (pans zoom in by `amount` so there is room to travel). Linear, so cuts inside a movement stay continuous.
 */
export function cameraAt(cam: CameraMove | null | undefined, rawP: number): CameraFrame {
  const p = clamp01(rawP)
  if (!cam || cam.kind === 'none') return { zoom: 1, focusX: null, focusY: null }
  const a = cam.amount
  switch (cam.kind) {
    case 'zoom_in': return { zoom: 1 + a * p, focusX: null, focusY: null }
    case 'zoom_out': return { zoom: 1 + a * (1 - p), focusX: null, focusY: null }
    case 'pan_right': return { zoom: 1 + a, focusX: p, focusY: null }
    case 'pan_left': return { zoom: 1 + a, focusX: 1 - p, focusY: null }
    case 'pan_down': return { zoom: 1 + a, focusX: null, focusY: p }
    case 'pan_up': return { zoom: 1 + a, focusX: null, focusY: 1 - p }
  }
}

/** The camera a clip really uses: its own, or the legacy slow zoom of images (motion = kenburns). */
export function effectiveCamera(clip: { camera?: CameraMove | null; motion: 'kenburns' | 'none' }, isImage: boolean): CameraMove | null {
  if (clip.camera) return clip.camera
  return isImage && clip.motion === 'kenburns' ? { kind: 'zoom_in', amount: 0.08 } : null
}

/**
 * A text with an entry animation and, optionally, a different exit one. Without `out` it behaves exactly as before
 * (the entry animation's own fade-out). With `out`, the exit is the chosen animation played backwards over the last part.
 */
export function textFrameFor(t: { animation?: TextAnimation; outAnimation?: TextAnimation; content: string }, localMs: number, durationMs: number): TextFrame {
  if (!t.outAnimation) return textFrame(t.animation, localMs, durationMs, t.content.length)
  const outMs = Math.min(IN_MS, durationMs / 3)
  // Entry only: evaluate the entry animation as if the text lasted for ever (no built-in fade-out).
  const entry = textFrame(t.animation, localMs, 1e9, t.content.length)
  const remaining = durationMs - localMs
  if (t.outAnimation === 'none' || remaining >= outMs) return entry
  // Mirror of the exit animation's entry at the same distance from the end.
  const exit = t.outAnimation === 'typewriter'
    ? { alpha: 1, scale: 1, offsetY: 0, visibleChars: Math.max(0, Math.floor(t.content.length * clamp01(remaining / outMs))) }
    : textFrame(t.outAnimation, remaining * (IN_MS / outMs), 1e9, t.content.length)
  return {
    alpha: entry.alpha * exit.alpha, scale: entry.scale * exit.scale, offsetY: entry.offsetY + exit.offsetY,
    visibleChars: entry.visibleChars === null ? exit.visibleChars : exit.visibleChars === null ? entry.visibleChars : Math.min(entry.visibleChars, exit.visibleChars),
  }
}

/** Keyframed value of each transform property at `localMs` (between the keyframes that set it, with the curve of the keyframe it arrives at; flat outside them). */
export function transformAt<T extends Record<string, number>>(base: T, keyframes: Array<{ atMs: number; easing?: string } & Partial<T>> | undefined, localMs: number): T {
  if (!keyframes?.length) return base
  const out = { ...base }
  for (const key of Object.keys(base) as Array<keyof T>) {
    const ks = keyframes.filter(k => k[key] !== undefined)
    if (!ks.length) continue
    if (localMs <= ks[0].atMs) { out[key] = ks[0][key] as unknown as T[keyof T]; continue }
    const last = ks[ks.length - 1]
    if (localMs >= last.atMs) { out[key] = last[key] as unknown as T[keyof T]; continue }
    const i = ks.findIndex(k => k.atMs > localMs)
    const a = ks[i - 1], b = ks[i]
    const raw = (localMs - a.atMs) / Math.max(1, b.atMs - a.atMs)
    const p = b.easing === 'hold' ? 0 : easeBy(b.easing as TransitionEasing | undefined, raw)
    out[key] = ((a[key] as unknown as number) + ((b[key] as unknown as number) - (a[key] as unknown as number)) * p) as unknown as T[keyof T]
  }
  return out
}

/**
 * Splits keyframes at `atMs`: both halves get a keyframe at the cut with the value there, so the animation continues seamlessly;
 * the second half's times start at 0.
 */
export function splitKeyframes<K extends { atMs: number; easing?: string }>(keys: K[] | undefined, base: Record<string, number>, atMs: number): [K[] | undefined, K[] | undefined] {
  if (!keys?.length) return [keys, keys]
  const props = Object.keys(base).filter(p => keys.some(k => (k as Record<string, unknown>)[p] !== undefined))
  const at = transformAt(base, keys as unknown as Array<{ atMs: number } & Record<string, number>>, atMs)
  const edge = Object.fromEntries(props.map(p => [p, at[p]])) as Partial<K>
  const first = [...keys.filter(k => k.atMs < atMs), { ...edge, atMs } as K]
  const second = [{ ...edge, atMs: 0 } as K, ...keys.filter(k => k.atMs > atMs).map(k => ({ ...k, atMs: k.atMs - atMs }))]
  return [first, second]
}
