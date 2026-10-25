/**
 * Transitions in bulk. A montage of 200–600 repetitions needs one transition configuration applied to many cuts, decided by the person
 * (all, selected, a range, every N, none, remove) and calculated BEFORE anything changes: the result of the plan is shown (final length,
 * how many cuts, how much material is given to the transitions) and only an explicit confirmation commits it as one undo step.
 *
 * It reuses the real two-clip system (`makeRoomForTransition`): every cut is the same transition between two real clips. Nothing here draws
 * or fakes an effect. No edge is ever trimmed twice: a cut only touches the end of its clip A and the start of its clip B, and the planner
 * checks each clip keeps at least MIN_CLIP_MS and that the windows of neighbouring cuts do not overlap.
 */
import { MIN_CLIP_MS, projectDurationMs, totalDurationMs, type Clip, type Composition, type Transition, type TransitionAlign, type TransitionOptions } from './composition'
import { BLENDS } from './motion'
import { makeRoomForTransition } from './transition-room'
import { transitionHandles, type MediaKindOf } from './transition-window'

/** Which cuts. A cut is identified by the index of the clip it ends (cut i = between clip i and clip i + 1; the UI shows i + 1). */
export type CutScope =
  | { kind: 'all' }
  | { kind: 'selected'; /** Ids of the clips whose outgoing cut is chosen (the selected transition) or that are selected together with the next clip. */ clipIds: string[] }
  | { kind: 'range'; /** 1-based, inclusive. */ from: number; to: number }
  | { kind: 'every'; n: number; /** 1-based first cut counted (default 1). */ from?: number; to?: number }

export type TransitionSettings = {
  transition: Transition
  ms: number
  align: TransitionAlign
  intensity?: number
  direction?: TransitionOptions['direction']
  easing?: TransitionOptions['easing']
}
export type FailurePolicy = 'reduce' | 'cut'
export type BatchOptions = {
  /** `apply` sets the transition; `remove` leaves the cuts as straight cuts. */
  action: 'apply' | 'remove'
  settings?: TransitionSettings
  /** Give the clips' own edges to the transitions when the files have no material around the cut (reported, never silent). Default true. */
  allowTrim?: boolean
  /** A cut that cannot get the full duration: use the longest that works (`reduce`) or leave it a straight cut (`cut`). Default `reduce`. */
  onFail?: FailurePolicy
}

export type CutReport = { cut: number; ms: number }
export type BatchPlan = {
  composition: Composition
  /** Cuts chosen by the scope (0-based indexes). */
  chosen: number[]
  applied: number
  /** Cuts that got a shorter transition than asked (full duration impossible without freezing a frame or emptying a clip). */
  shortened: CutReport[]
  /** Cuts left as straight cuts because not even the shortest transition fits. */
  skipped: number[]
  removed: number
  trimmedMs: number
  trimmedClips: number
  beforeMs: number
  afterMs: number
  /** Shortest clip after the plan. */
  minClipMs: number
  /** True when something in the plan needs the person to decide (shortened or skipped cuts). */
  needsDecision: boolean
}

export function cutsOf(c: Pick<Composition, 'clips'>, scope: CutScope): number[] {
  const last = c.clips.length - 2
  if (last < 0) return []
  const all = (from = 0, to = last) => { const out: number[] = []; for (let i = Math.max(0, from); i <= Math.min(last, to); i++) out.push(i); return out }
  if (scope.kind === 'all') return all()
  if (scope.kind === 'range') return all(Math.min(scope.from, scope.to) - 1, Math.max(scope.from, scope.to) - 1)
  if (scope.kind === 'every') {
    const n = Math.max(1, Math.floor(scope.n)), from = Math.max(1, Math.floor(scope.from ?? 1)) - 1, to = scope.to ? Math.floor(scope.to) - 1 : last
    const out: number[] = []
    for (let i = from; i <= Math.min(last, to); i += n) out.push(i)
    return out
  }
  const ids = new Set(scope.clipIds)
  const out: number[] = []
  for (let i = 0; i <= last; i++) if (ids.has(c.clips[i].id)) out.push(i)
  return out
}

/** The cuts «between selected clips»: both neighbours selected (a run of selected clips), or the selected transition. */
export function selectedCutClipIds(c: Pick<Composition, 'clips'>, selectedClipIds: string[], selectedTransition: string | null): string[] {
  const sel = new Set(selectedClipIds), out = new Set<string>()
  if (selectedTransition) out.add(selectedTransition)
  for (let i = 0; i < c.clips.length - 1; i++) if (sel.has(c.clips[i].id) && sel.has(c.clips[i + 1].id)) out.add(c.clips[i].id)
  return [...out]
}

const roundTo50 = (ms: number) => Math.floor(ms / 50) * 50

/** Plans (and builds) the bulk operation. Pure: the input composition is never mutated. */
export function planBatchTransitions(c: Composition, scope: CutScope, o: BatchOptions, kindOf: MediaKindOf): BatchPlan {
  const chosen = cutsOf(c, scope)
  const before = totalDurationMs(c)
  const clips = c.clips.slice()
  const shortened: CutReport[] = [], skipped: number[] = []
  const touched = new Set<number>()
  let applied = 0, removed = 0, trimmedMs = 0
  const s = o.settings
  const allowTrim = o.allowTrim !== false, onFail = o.onFail ?? 'reduce'
  const straight = (k: Clip): Clip => ({ ...k, transition: 'cut', transitionMs: undefined, transitionOpts: undefined })

  for (const i of chosen) {
    const A = clips[i], B = clips[i + 1]
    if (o.action === 'remove' || !s) {
      if (A.transition !== 'cut') { clips[i] = straight(A); removed++ }
      continue
    }
    const opts: TransitionOptions = { align: s.align, ...(s.direction ? { direction: s.direction } : {}), ...(s.intensity !== undefined ? { intensity: s.intensity } : {}), ...(s.easing ? { easing: s.easing } : {}) }
    const asked = Math.max(100, Math.round(s.ms))
    const set = (k: Clip, ms: number): Clip => ({ ...k, transition: s.transition, transitionMs: ms, transitionOpts: opts })
    if (!BLENDS.has(s.transition)) { clips[i] = set(A, asked); applied++; continue } // dips and cuts need no material from the neighbour
    // A small composition around the cut (previous clip, A, B): the window of a cut depends on the previous cut only.
    const lo = Math.max(0, i - 1), at = i - lo
    const mini = (ms: number): Composition => ({ ...c, clips: [...(i > 0 ? [clips[i - 1]] : []), set(A, ms), B] })
    let ms = asked, a = A, b = B, tA = 0, tB = 0, ok = true
    if (allowTrim) {
      const r = makeRoomForTransition(mini(asked), at, kindOf)
      if (r.failed) ok = false
      else { ms = r.ms; a = r.composition.clips[at]; b = r.composition.clips[at + 1]; tA = r.trimmedAMs; tB = r.trimmedBMs }
    } else {
      const h = transitionHandles(mini(asked), at, kindOf)
      if (!(h.missingA === 0 && h.missingB === 0 && h.ms === asked)) { const cap = roundTo50(Math.min(asked, h.maxCoveredMs)); if (cap >= 100) ms = cap; else ok = false }
    }
    if (!ok || (ms < asked && onFail === 'cut')) { clips[i] = straight(A); skipped.push(i); continue }
    clips[i] = set(a, ms)
    if (b !== B) clips[i + 1] = b
    if (tA || tB) { trimmedMs += tA + tB; touched.add(i); touched.add(i + 1) }
    if (ms < asked) shortened.push({ cut: i, ms })
    applied++
  }

  const composition: Composition = chosen.length ? { ...c, clips: clips.map((k, n) => (k.position === n + 1 ? k : { ...k, position: n + 1 })) } : c
  return {
    composition, chosen, applied, shortened, skipped, removed, trimmedMs, trimmedClips: touched.size, beforeMs: before, afterMs: totalDurationMs(composition),
    minClipMs: composition.clips.reduce((m, k) => Math.min(m, k.durationMs), Infinity),
    needsDecision: shortened.length > 0 || skipped.length > 0,
  }
}

/** Human summary of a plan (Spanish), shown before the person confirms. */
export function describePlan(p: BatchPlan, o: BatchOptions): string[] {
  const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} s`
  const dur = (ms: number) => { const h = Math.floor(ms / 3600_000), m = Math.floor(ms % 3600_000 / 60_000), s = Math.round(ms % 60_000 / 1000); return h ? `${h} h ${m} min ${s} s` : m ? `${m} min ${s} s` : `${s} s` }
  const out: string[] = []
  if (!p.chosen.length) return ['Ningún corte coincide con la selección.']
  if (o.action === 'remove') out.push(`Se quitará la transición de ${p.removed} corte${p.removed === 1 ? '' : 's'} (de ${p.chosen.length} elegidos); quedan como corte directo.`)
  else out.push(`Se aplicará la transición a ${p.applied} de ${p.chosen.length} corte${p.chosen.length === 1 ? '' : 's'}.`)
  if (p.trimmedMs > 0) out.push(`Para que los dos vídeos de cada corte se muevan durante la transición se recortan ${secs(p.trimmedMs)} en total de los extremos de ${p.trimmedClips} clips (el material recortado es el que se reproduce en el solape). Ningún clip queda por debajo de ${secs(MIN_CLIP_MS)}.`)
  if (p.beforeMs !== p.afterMs) out.push(`Duración del proyecto: ${dur(p.beforeMs)} → ${dur(p.afterMs)} (${secs(p.beforeMs - p.afterMs)} menos).`)
  else out.push(`La duración del proyecto no cambia (${dur(p.afterMs)}).`)
  if (p.shortened.length) out.push(`${p.shortened.length} corte${p.shortened.length === 1 ? '' : 's'} no admite${p.shortened.length === 1 ? '' : 'n'} la duración pedida sin congelar un fotograma: ${p.shortened.length === 1 ? 'usa' : 'usan'} la máxima posible (p. ej. el corte ${p.shortened[0].cut + 1}: ${secs(p.shortened[0].ms)}).`)
  if (p.skipped.length) out.push(`${p.skipped.length} corte${p.skipped.length === 1 ? '' : 's'} queda${p.skipped.length === 1 ? '' : 'n'} sin transición porque ni la más corta cabe (p. ej. el corte ${p.skipped[0] + 1}).`)
  return out
}

export { projectDurationMs }
