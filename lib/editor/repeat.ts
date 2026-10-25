/**
 * Mass duplication: «repeat this clip N times» or «repeat until the project lasts T».
 *
 * Architecture (chosen after checking the engine and the player): every repetition is an ordinary, independent clip instance that points at the
 * SAME media asset (`visualAssetId`). Nothing is copied on disk or in the cloud; an instance costs ~0.4 KB in the saved montage (a 5 h music video
 * of 30 s clips is ~600 instances ≈ 250 KB). Each instance has its own id, position and settings, so any repetition can be edited, trimmed,
 * replaced or given its own transition. The timeline already draws only the clips on screen, the player only opens the clips around the
 * playhead, and the offline engine fingerprints segments so identical repetitions are rendered once and reused. A «virtual repetition block»
 * would not allow editing a single repetition without expanding it, so it was rejected.
 */
import { MAX_TIMELINE_MS, MIN_CLIP_MS, totalDurationMs, type Clip, type Composition } from './composition'
import { planBatchTransitions, type BatchOptions, type BatchPlan, type FailurePolicy, type TransitionSettings } from './batch-transitions'
import { sliceCues } from './timeline'
import type { MediaKindOf } from './transition-window'

export const MAX_CLIPS = 5000 // the montage parser's own limit
let seq = 0
const newId = () => `clip-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Inserts `total - 1` copies right after the clip (so `total` includes the original). Copies share the media and carry the clip's settings. */
export function repeatClip(c: Composition, clipId: string, total: number): { composition: Composition; ids: string[] } {
  const i = c.clips.findIndex(k => k.id === clipId)
  const n = Math.max(1, Math.floor(total))
  if (i < 0 || n <= 1) return { composition: c, ids: [] }
  const src = c.clips[i]
  const copies: Clip[] = []
  for (let r = 1; r < n; r++) copies.push({ ...src, id: newId(), voiceAssetId: null, groupId: undefined })
  const clips = [...c.clips.slice(0, i + 1), ...copies, ...c.clips.slice(i + 1)].map((k, p) => (k.position === p + 1 ? k : { ...k, position: p + 1 }))
  return { composition: { ...c, clips }, ids: copies.map(k => k.id) }
}

/** The most repetitions (original included) that fit the montage limits. */
export function maxRepeats(c: Composition, clipId: string): number {
  const k = c.clips.find(x => x.id === clipId)
  if (!k) return 1
  const others = totalDurationMs(c) - k.durationMs
  return Math.max(1, Math.min(MAX_CLIPS - (c.clips.length - 1), Math.floor((MAX_TIMELINE_MS - others) / Math.max(1, k.durationMs))))
}

export type RepeatRequest =
  | { mode: 'count'; count: number }
  | { mode: 'target'; targetMs: number; /** Trim the end of the last repetition so the project lasts exactly the target (when it can be done without damaging a transition). */ exact: boolean }
export type RepeatTransition = { settings: TransitionSettings; allowTrim?: boolean; onFail?: FailurePolicy }
export type RepeatPlan = {
  composition: Composition
  /** Repetitions including the original. */
  total: number
  /** Ids of the new instances (not the original). */
  ids: string[]
  plan: BatchPlan | null
  beforeMs: number
  finalMs: number
  /** How much the last repetition was shortened to hit the target exactly (0 = not adjusted). */
  adjustedMs: number
  warnings: string[]
  ok: boolean
}

/** Length lost at every cut between identical repetitions once the transition has its material (measured on three repetitions). */
export function lossPerCut(c: Composition, clipId: string, tr: RepeatTransition | null, kindOf: MediaKindOf): number {
  const k = c.clips.find(x => x.id === clipId)
  if (!k || !tr) return 0
  const three = repeatClip({ ...c, clips: [k] }, clipId, 3).composition
  const p = planBatchTransitions(three, { kind: 'all' }, { action: 'apply', settings: tr.settings, allowTrim: tr.allowTrim, onFail: tr.onFail }, kindOf)
  return Math.max(0, (3 * k.durationMs - p.afterMs) / 2)
}

/** Builds the whole result (instances + transitions) without touching the input. Pure, so the dialog can preview it. */
export function planRepeat(c: Composition, clipId: string, req: RepeatRequest, tr: RepeatTransition | null, kindOf: MediaKindOf): RepeatPlan {
  const k = c.clips.find(x => x.id === clipId)
  const beforeMs = totalDurationMs(c)
  const fail = (msg: string): RepeatPlan => ({ composition: c, total: 1, ids: [], plan: null, beforeMs, finalMs: beforeMs, adjustedMs: 0, warnings: [msg], ok: false })
  if (!k) return fail('Selecciona un clip.')
  const cap = maxRepeats(c, clipId)
  const warnings: string[] = []
  const settingsOf = (): BatchOptions | null => (tr ? { action: 'apply', settings: tr.settings, allowTrim: tr.allowTrim, onFail: tr.onFail } : null)

  const build = (n: number) => {
    const r = repeatClip(c, clipId, n)
    const i = r.composition.clips.findIndex(x => x.id === clipId)
    let plan: BatchPlan | null = null, comp = r.composition
    const o = settingsOf()
    if (o && n > 1) {
      const from = i + 1, to = i + n - 1 // cuts between the repetitions only (the cuts to the neighbours keep their own transition)
      plan = planBatchTransitions(comp, { kind: 'range', from, to }, o, kindOf)
      comp = plan.composition
    }
    return { r, comp, plan }
  }

  let n: number
  if (req.mode === 'count') n = Math.max(1, Math.floor(req.count))
  else {
    const others = beforeMs - k.durationMs
    const loss = lossPerCut(c, clipId, tr, kindOf)
    const step = k.durationMs - loss
    if (step <= 0) return fail('La transición se come toda la duración del clip: usa una más corta.')
    n = req.targetMs <= others + k.durationMs ? 1 : 1 + Math.ceil((req.targetMs - others - k.durationMs) / step)
  }
  if (n > cap) { warnings.push(`El editor admite como máximo ${cap} repeticiones aquí (${MAX_CLIPS} clips y ${MAX_TIMELINE_MS / 3600_000} h): se limita.`); n = cap }

  let b = build(n)
  if (req.mode === 'target') {
    // The estimate is exact for identical repetitions; verify against the real plan and correct by one repetition either way.
    for (let guard = 0; guard < 4; guard++) {
      const f = totalDurationMs(b.comp)
      if (f < req.targetMs && n < cap) { n++; b = build(n); continue }
      if (n > 1 && f - (b.comp.clips[b.comp.clips.findIndex(x => x.id === b.r.ids[b.r.ids.length - 1])]?.durationMs ?? 0) >= req.targetMs) { n--; b = build(n); continue }
      break
    }
  }
  let comp = b.comp
  let adjustedMs = 0
  let finalMs = totalDurationMs(comp)
  if (req.mode === 'target') {
    if (finalMs < req.targetMs) warnings.push(`No se llega a la duración pedida: el máximo posible es ${fmt(finalMs)}.`)
    else if (req.exact && finalMs > req.targetMs) {
      const lastId = b.r.ids[b.r.ids.length - 1] ?? clipId
      const li = comp.clips.findIndex(x => x.id === lastId), L = comp.clips[li]
      const ms = Math.max(tr?.settings.ms ?? 0, L.transitionMs ?? 0)
      const minDur = tr ? Math.max(MIN_CLIP_MS, Math.round(ms * 2) + 200) : MIN_CLIP_MS
      const want = L.durationMs - (finalMs - req.targetMs)
      if (L && want >= minDur) {
        comp = { ...comp, clips: comp.clips.map((x, p) => (p === li ? { ...x, durationMs: Math.round(want), ...(x.cues ? { cues: sliceCues(x.cues, 0, Math.round(want)) } : {}) } : x)) }
        adjustedMs = L.durationMs - Math.round(want); finalMs = totalDurationMs(comp)
      } else warnings.push(`No se ajusta el último clip al minuto exacto sin dañar la transición o dejarlo demasiado corto: el proyecto dura ${fmt(finalMs)} (${fmt(finalMs - req.targetMs)} más).`)
    }
  }
  if (b.plan?.shortened.length) warnings.push(`${b.plan.shortened.length} corte(s) usan una transición más corta que la pedida (no hay material suficiente).`)
  if (b.plan?.skipped.length) warnings.push(`${b.plan.skipped.length} corte(s) quedan sin transición (los clips son demasiado cortos).`)
  return { composition: comp, total: n, ids: b.r.ids, plan: b.plan, beforeMs, finalMs, adjustedMs, warnings, ok: true }
}

export function fmt(ms: number): string {
  const h = Math.floor(ms / 3600_000), m = Math.floor(ms % 3600_000 / 60_000), s = Math.round(ms % 60_000 / 1000)
  return h ? `${h} h ${m} min ${s} s` : m ? `${m} min ${s} s` : `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`
}
