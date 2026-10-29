/**
 * The real extent of a transition between two consecutive main-track clips A (index i) and B (i + 1).
 *
 * A transition belongs to the cut between the two clips. It does not move any clip: the timeline and the project length stay as they are.
 * It occupies a window of `ms` around the cut: `pre` ms before it (the last part of A) and `post` ms after it (the first part of B).
 *   before: the window ends at the cut (pre = ms)        — what every montage made before alignment existed does
 *   center: half on each side (pre = post = ms / 2)      — the professional default
 *   after:  the window starts at the cut (post = ms)
 * Inside the window both clips are on screen: A plays on past its end when its file has material there, B plays from before its start when
 * its file has material there. Where a file has no material the picture holds its nearest frame; `transitionHandles` reports exactly how much
 * is missing so the editor can say so (never silently).
 */
import type { Clip, Composition, Transition, TransitionAlign } from './composition'
import { BLENDS } from './motion'

type Plan = Pick<Composition, 'clips' | 'fadeMs'>

export const ALIGNS: Record<TransitionAlign, string> = { center: 'Centrada en el corte', before: 'Termina en el corte', after: 'Empieza en el corte' }
export const alignOf = (clip: Pick<Clip, 'transitionOpts'>): TransitionAlign => clip.transitionOpts?.align ?? 'before'
const fractions = (a: TransitionAlign) => (a === 'center' ? { pre: 0.5, post: 0.5 } : a === 'after' ? { pre: 0, post: 1 } : { pre: 1, post: 0 })

/** Length asked for, limited by the two clips around the cut (never longer than either). */
const rawMs = (c: Plan, i: number) => {
  const clip = c.clips[i]
  if (!clip) return 0
  return Math.min(Math.max(0, clip.transitionMs ?? c.fadeMs), clip.durationMs, c.clips[i + 1]?.durationMs ?? clip.durationMs)
}

/**
 * The window of the transition after clip i. Besides the length limit, a transition that reaches back into clip A may not run into the
 * part of A taken by the previous transition (its `post`), so the windows of two cuts never overlap.
 */
export function transitionWindow(c: Plan, i: number): { ms: number; pre: number; post: number } {
  const clip = c.clips[i]
  if (!clip) return { ms: 0, pre: 0, post: 0 }
  const f = fractions(alignOf(clip))
  let ms = rawMs(c, i)
  if (i > 0 && f.pre > 0) {
    const prev = c.clips[i - 1]
    const taken = fractions(alignOf(prev)).post * rawMs(c, i - 1)
    const room = Math.max(0, clip.durationMs - taken)
    if (ms * f.pre > room) ms = room / f.pre
  }
  ms = Math.round(ms)
  const pre = Math.round(ms * f.pre)
  return { ms, pre, post: ms - pre }
}

export type MediaKindOf = (assetId: string) => 'video' | 'image' | 'audio' | null
export type TransitionHandles = {
  ms: number; pre: number; post: number
  /** Milliseconds of the window in which a clip has no real material and would hold a frame. 0 = nothing missing. */
  missingA: number; missingB: number
  /** The longest window (same alignment) both files can fully cover; 0 when none. */
  maxCoveredMs: number
  /** True when a missing amount depends on a file length that is not known yet. */
  unknown: boolean
}

/** Does video clip A have material after its end for `postMs` of timeline, and video clip B before its start for `preMs`? */
function handleOf(clip: Clip | undefined, media: 'video' | 'image' | 'audio' | null, side: 'after-end' | 'before-start') {
  // Only a video can run out of frames: a photo (or a clip with no picture at all) has nothing to hold.
  if (!clip || media !== 'video') return { have: Infinity, unknown: false }
  // A reversed clip reads its file backwards: no material beyond either edge is used by a transition (it holds the nearest frame).
  if (clip.reverse || clip.freeze || clip.ramp !== undefined) return { have: 0, unknown: false }
  const rate = clip.speed ?? 1, trim = clip.trimInMs ?? 0
  if (side === 'before-start') return { have: trim / rate, unknown: false }
  if (!clip.sourceDurationMs) return { have: 0, unknown: true }
  return { have: Math.max(0, clip.sourceDurationMs - (trim + clip.durationMs * rate)) / rate, unknown: false }
}

export function transitionHandles(c: Plan, i: number, kindOf: MediaKindOf): TransitionHandles {
  const w = transitionWindow(c, i)
  const A = c.clips[i], B = c.clips[i + 1]
  const ha = handleOf(A, A?.visualAssetId ? kindOf(A.visualAssetId) : null, 'after-end')
  const hb = handleOf(B, B?.visualAssetId ? kindOf(B.visualAssetId) : null, 'before-start')
  const missingA = Math.max(0, Math.round(w.post - ha.have)), missingB = Math.max(0, Math.round(w.pre - hb.have))
  const f = fractions(alignOf(A))
  // Longest window whose post fits A's handle and whose pre fits B's handle (limited also by the clips' own lengths).
  const cap = Math.min(rawMs(c, i), 3000)
  const byA = f.post > 0 ? ha.have / f.post : Infinity, byB = f.pre > 0 ? hb.have / f.pre : Infinity
  const maxCoveredMs = Math.max(0, Math.floor(Math.min(cap, byA, byB)))
  return { ...w, missingA, missingB, maxCoveredMs, unknown: ha.unknown && w.post > 0 }
}

/**
 * Fields to set when a transition type is chosen for a cut. A blending transition chosen where there was none (or a dip) is centred on the cut;
 * one that already has an alignment keeps it, and a montage made before alignment existed keeps «ends at the cut» until the person changes it.
 */
export function transitionPatch(clip: Pick<Clip, 'transition' | 'transitionOpts'>, kind: Transition): Pick<Clip, 'transition'> & Partial<Pick<Clip, 'transitionOpts'>> {
  const wasBlend = BLENDS.has(clip.transition ?? 'fade')
  if (BLENDS.has(kind) && !wasBlend && clip.transitionOpts?.align === undefined) return { transition: kind, transitionOpts: { ...(clip.transitionOpts ?? {}), align: 'center' } }
  return { transition: kind }
}
