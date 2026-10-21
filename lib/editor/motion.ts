/**
 * Pure maths for transitions and text animations, shared by the renderer (canvas) and the tests.
 * Transitions happen inside the last `fadeMs` of the outgoing clip, so the total duration never changes.
 */
import type { TextAnimation, Transition } from './composition'

/** How the outgoing (A) and incoming (B) clips are drawn at progress t (0 → 1) of the transition. */
export type TransitionFrame = {
  /** Opacity of a black layer over everything (fade through black). */
  black: number
  aAlpha: number; bAlpha: number
  /** Incoming clip offset as a fraction of the width (slide). */
  bOffsetX: number
  /** Fraction of the width revealed for B from the left (wipe); 1 = full frame. */
  bReveal: number
  /** Extra zoom applied to A (zoom transition). */
  aScale: number
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** Transitions that draw the next clip during the overlap (the rest only touch the outgoing clip). */
export const BLENDS: ReadonlySet<Transition> = new Set<Transition>(['dissolve', 'slide', 'wipe', 'zoom'])

export function transitionFrame(kind: Transition, rawT: number): TransitionFrame {
  const t = clamp01(rawT), e = ease(t)
  const base: TransitionFrame = { black: 0, aAlpha: 1, bAlpha: 0, bOffsetX: 0, bReveal: 1, aScale: 1 }
  switch (kind) {
    case 'dissolve': return { ...base, bAlpha: e }
    case 'slide': return { ...base, bAlpha: 1, bOffsetX: 1 - e }
    case 'wipe': return { ...base, bAlpha: 1, bReveal: e }
    case 'zoom': return { ...base, aScale: 1 + 0.35 * e, bAlpha: clamp01((t - 0.35) / 0.65) }
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
