import type { AutoSnapshot, Composition } from './composition'
import { alignmentOfTimes } from './sync'

/**
 * Manual montage vs automatic montage: the same numbers read from both, the cuts paired up, and a list of plain differences.
 * Nothing is scored as «better»: it shows what differs so the owner decides, and so a learned style can be checked against what it produced.
 */
export type Lane = {
  label: string
  totalMs: number
  clips: Array<{ startMs: number; durationMs: number; hardCut: boolean }>
  cutsMs: number[]
  textOverlays: number
  mutedClips: number
  sfx: number
  musicVolume: number
  subtitles: boolean
  medianClipMs: number
  p10ClipMs: number
  p90ClipMs: number
  hardCutShare: number
}

const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] }

type Raw = { durs: number[]; hard: boolean[]; text: number; muted: number; sfx: number; music: number; subtitles: boolean }
function lane(label: string, r: Raw): Lane {
  let t = 0
  const clips = r.durs.map((d, i) => { const c = { startMs: t, durationMs: d, hardCut: r.hard[i] }; t += d; return c })
  return { label, totalMs: t, clips, cutsMs: clips.slice(1).map(c => c.startMs), textOverlays: r.text, mutedClips: r.muted, sfx: r.sfx, musicVolume: r.music, subtitles: r.subtitles,
    medianClipMs: Math.round(q(r.durs, 0.5)), p10ClipMs: Math.round(q(r.durs, 0.1)), p90ClipMs: Math.round(q(r.durs, 0.9)), hardCutShare: r.hard.length > 1 ? r.hard.slice(0, -1).filter(Boolean).length / (r.hard.length - 1) : 0 }
}

export const laneOfComposition = (c: Composition, label: string): Lane => lane(label, {
  durs: c.clips.map(k => k.durationMs), hard: c.clips.map(k => k.transition === 'cut'), text: c.clips.filter(k => k.text?.content).length, muted: c.clips.filter(k => k.muted).length,
  sfx: (c.audioClips ?? []).filter(a => a.kind === 'sfx').length, music: c.musicVolume, subtitles: c.subtitles,
})
export const laneOfSnapshot = (s: AutoSnapshot, label: string): Lane => lane(label, {
  durs: s.clips.map(k => k.durationMs), hard: s.clips.map(k => k.transition === 'cut'), text: s.clips.filter(k => k.hasText).length, muted: s.clips.filter(k => k.muted).length, sfx: s.sfx, music: s.musicVolume, subtitles: s.subtitles,
})

export type CutPair = { aMs: number; bMs: number; deltaMs: number }
export type Comparison = {
  a: Lane; b: Lane
  /** Cuts of A and B paired when they are within `toleranceMs` (each cut is used once). */
  matched: CutPair[]; onlyA: number[]; onlyB: number[]
  /** Share of all cuts (of both) that have a partner: 1 = the same cut pattern. */
  cutAgreement: number | null
  /** Beat alignment of each lane, when beats were given. */
  beats: { a: number | null; b: number | null } | null
  differences: string[]
}

export function compareLanes(a: Lane, b: Lane, opts: { toleranceMs?: number; beats?: readonly number[] } = {}): Comparison {
  const tol = opts.toleranceMs ?? 250
  const matched: CutPair[] = [], usedB = new Set<number>()
  const onlyA: number[] = []
  for (const t of a.cutsMs) {
    let best = -1
    b.cutsMs.forEach((u, j) => { if (!usedB.has(j) && Math.abs(u - t) <= tol && (best < 0 || Math.abs(u - t) < Math.abs(b.cutsMs[best] - t))) best = j })
    if (best >= 0) { usedB.add(best); matched.push({ aMs: t, bMs: b.cutsMs[best], deltaMs: b.cutsMs[best] - t }) } else onlyA.push(t)
  }
  const onlyB = b.cutsMs.filter((_, j) => !usedB.has(j))
  const all = a.cutsMs.length + b.cutsMs.length
  const cutAgreement = all ? Math.round(2 * matched.length / all * 100) / 100 : null
  const beats = opts.beats?.length ? { a: alignmentOfTimes(a.cutsMs, opts.beats, 120).share, b: alignmentOfTimes(b.cutsMs, opts.beats, 120).share } : null
  const s = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`
  const d: string[] = []
  if (a.clips.length !== b.clips.length) d.push(`${a.label} tiene ${a.clips.length} clips y ${b.label} ${b.clips.length}.`)
  if (Math.abs(a.medianClipMs - b.medianClipMs) >= 300) d.push(`El clip típico dura ${s(a.medianClipMs)} en ${a.label} y ${s(b.medianClipMs)} en ${b.label}.`)
  if (Math.abs(a.totalMs - b.totalMs) >= 1000) d.push(`La duración total es ${s(a.totalMs)} frente a ${s(b.totalMs)}.`)
  if (onlyA.length) d.push(`${onlyA.length} cortes de ${a.label} no existen en ${b.label} (a menos de ${tol} ms).`)
  if (onlyB.length) d.push(`${onlyB.length} cortes de ${b.label} no existen en ${a.label}.`)
  const mm = matched.filter(p => Math.abs(p.deltaMs) >= 50)
  if (mm.length) d.push(`${mm.length} cortes coinciden pero no exactamente (desfase mediano ${Math.round(q(mm.map(p => Math.abs(p.deltaMs)), 0.5))} ms).`)
  if (Math.abs(a.hardCutShare - b.hardCutShare) >= 0.2) d.push(`Cortes secos: ${Math.round(a.hardCutShare * 100)} % en ${a.label} y ${Math.round(b.hardCutShare * 100)} % en ${b.label} (el resto son fundidos).`)
  if (a.sfx !== b.sfx) d.push(`Efectos de sonido: ${a.sfx} en ${a.label} y ${b.sfx} en ${b.label}.`)
  if (a.textOverlays !== b.textOverlays) d.push(`Textos en pantalla: ${a.textOverlays} y ${b.textOverlays}.`)
  if (a.mutedClips !== b.mutedClips) d.push(`Clips silenciados: ${a.mutedClips} y ${b.mutedClips}.`)
  if (Math.abs(a.musicVolume - b.musicVolume) >= 0.05) d.push(`Volumen de la música: ${Math.round(a.musicVolume * 100)} % y ${Math.round(b.musicVolume * 100)} %.`)
  if (a.subtitles !== b.subtitles) d.push(`Subtítulos: ${a.subtitles ? 'sí' : 'no'} en ${a.label} y ${b.subtitles ? 'sí' : 'no'} en ${b.label}.`)
  if (beats && beats.a !== null && beats.b !== null && Math.abs(beats.a - beats.b) >= 0.15) d.push(`Cortes en el pulso de la música: ${Math.round(beats.a * 100)} % en ${a.label} y ${Math.round(beats.b * 100)} % en ${b.label}.`)
  if (!d.length) d.push('Los dos montajes son prácticamente iguales en lo que se mide.')
  return { a, b, matched, onlyA, onlyB, cutAgreement, beats, differences: d }
}

