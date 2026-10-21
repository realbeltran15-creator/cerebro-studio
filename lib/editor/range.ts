/**
 * Fragments («selección de fragmentos»): a time range marked on the timeline, so an operation touches only that part.
 * Pure functions; every result is a new composition (one undo step in the editor).
 */
import { audioStartMs, clipStarts, MIN_CLIP_MS, totalDurationMs, type AudioClip, type Composition, type TextClip } from './composition'
import { splitClip } from './timeline'

export type Range = { startMs: number; endMs: number }

export const normRange = (r: Range, total: number): Range | null => {
  const a = Math.max(0, Math.min(r.startMs, r.endMs)), b = Math.min(total, Math.max(r.startMs, r.endMs))
  return b - a >= 100 ? { startMs: Math.round(a), endMs: Math.round(b) } : null
}

/** Ids of the clips that overlap the range by at least 100 ms. */
export function clipIdsInRange(c: Composition, r: Range): string[] {
  const st = clipStarts(c)
  return c.clips.filter((k, i) => Math.min(st[i] + k.durationMs, r.endMs) - Math.max(st[i], r.startMs) >= 100).map(k => k.id)
}

/**
 * Splits the clips at the range edges so the range is made of whole clips. When an edge falls less than the minimum
 * clip length from a clip boundary, that boundary is used instead (the range «snaps» to it). Returns the clips inside.
 */
export function isolateRange(input: Composition, r: Range): { composition: Composition; ids: string[]; range: Range } {
  let c = input
  const cutAt = (ms: number) => {
    const st = clipStarts(c)
    const i = c.clips.findIndex((k, n) => ms > st[n] && ms < st[n] + k.durationMs)
    if (i < 0) return ms
    const local = ms - st[i]
    if (local < MIN_CLIP_MS) return st[i]
    if (c.clips[i].durationMs - local < MIN_CLIP_MS) return st[i] + c.clips[i].durationMs
    c = splitClip(c, c.clips[i].id, local)
    return ms
  }
  const a = cutAt(r.startMs)
  const b = cutAt(r.endMs)
  const st = clipStarts(c)
  const ids = c.clips.filter((k, i) => st[i] >= a - 1 && st[i] + k.durationMs <= b + 1).map(k => k.id)
  return { composition: c, ids, range: { startMs: a, endMs: b } }
}

/** Shifts and cuts timed items (absolute audio, texts) around a removed stretch [a, b): before stays, inside goes, after moves back. */
function ripple<T extends { startMs: number; durationMs: number }>(items: T[], a: number, b: number, split: (t: T, cutFromStartMs: number) => T): T[] {
  const gap = b - a
  return items.flatMap(t => {
    const s = t.startMs, e = t.startMs + t.durationMs
    if (e <= a) return [t]
    if (s >= b) return [{ ...t, startMs: s - gap }]
    if (s >= a && e <= b) return []
    const out: T[] = []
    if (s < a) out.push({ ...t, durationMs: a - s })
    if (e > b) out.push({ ...split(t, b - s), startMs: a, durationMs: e - b })
    return out
  })
}

/** Removes a fragment and closes the gap: clips inside go, audio and texts after it move back, audio that spans it keeps both ends in sync. */
export function deleteRange(input: Composition, r: Range): { composition: Composition; removedMs: number } {
  const { composition: c, ids, range } = isolateRange(input, r)
  if (!ids.length) return { composition: input, removedMs: 0 }
  const gone = new Set(ids)
  const a = range.startMs, b = range.endMs
  // Audio linked to a removed clip becomes absolute at its time first (then the ripple removes or trims it).
  const abs = (c.audioClips ?? []).map(x => (x.linkedClipId && gone.has(x.linkedClipId) ? { ...x, linkedClipId: null, startMs: audioStartMs(c, x) } : x))
  const linked = abs.filter(x => x.linkedClipId), free = abs.filter(x => !x.linkedClipId)
  let n = 0
  const audio = ripple<AudioClip>(free, a, b, (t, cut) => ({ ...t, id: `${t.id}-r${++n}`, trimInMs: t.trimInMs + cut }))
  const texts = ripple<TextClip>(c.textClips ?? [], a, b, t => ({ ...t, id: `${t.id}-r${++n}` }))
  const clips = c.clips.filter(k => !gone.has(k.id)).map((k, i) => ({ ...k, position: i + 1 }))
  return { composition: { ...c, clips, audioClips: [...linked, ...audio], textClips: texts }, removedMs: totalDurationMs(c) - clips.reduce((s, k) => s + k.durationMs, 0) }
}
