import { backCopyOf, sourceAt, withEndDuration } from './reverse'
import { splitKeyframes } from './motion'
import { audioStartMs, clipStarts, envelopeAt, MAX_CLIP_MS, MAX_TIMELINE_MS, MIN_CLIP_MS, totalDurationMs, type AudioClip, type Clip, type Composition, type TextClip } from './composition'

/**
 * Pure editing operations for the manual (timeline) editor. Every function returns a new composition,
 * so the page can keep an undo/redo history of immutable snapshots.
 */

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`
const clampDur = (ms: number) => Math.min(Math.max(Math.round(ms), MIN_CLIP_MS), MAX_CLIP_MS)

/**
 * Converts an automatic (scene-based) edit into a manual timeline: clip voices become linked voice
 * clips on the audio track, so visuals can be split, reordered or duplicated without cutting the voice.
 * Idempotent: an already manual composition is returned unchanged.
 */
export function toManual(c: Composition, voiceDurations: Record<string, number> = {}): Composition {
  if (c.editedManually) return c
  const audioClips: AudioClip[] = [...(c.audioClips ?? [])]
  const clips = c.clips.map(clip => {
    if (clip.voiceAssetId) {
      const voiceMs = voiceDurations[clip.voiceAssetId]
      audioClips.push({
        id: newId('voice'), assetId: clip.voiceAssetId, kind: 'voice', linkedClipId: clip.id, offsetMs: 0, startMs: 0, trimInMs: 0,
        durationMs: Math.min(voiceMs ?? clip.durationMs, clip.durationMs), volume: 1, muted: false,
      })
    }
    return { ...clip, voiceAssetId: null }
  })
  const autoSnapshot = c.autoSnapshot ?? { takenAt: new Date().toISOString(), clips: c.clips.map(k => ({ durationMs: k.durationMs, transition: k.transition ?? 'fade', hasText: Boolean(k.text?.content), muted: k.muted === true })), sfx: audioClips.filter(a => a.kind === 'sfx').length, musicVolume: c.musicVolume, subtitles: c.subtitles }
  return { ...c, clips, audioClips, editedManually: true, autoSnapshot }
}

export function moveClip(c: Composition, clipId: string, toIndex: number): Composition {
  const from = c.clips.findIndex(k => k.id === clipId)
  if (from < 0) return c
  const clips = [...c.clips]
  const [item] = clips.splice(from, 1)
  clips.splice(Math.min(Math.max(toIndex, 0), clips.length), 0, item)
  return { ...c, clips: clips.map((k, i) => ({ ...k, position: i + 1 })) }
}

export function updateClip(c: Composition, clipId: string, patch: Partial<Omit<Clip, 'id'>>): Composition {
  return { ...c, clips: c.clips.map(k => {
    if (k.id !== clipId) return k
    // A reversed clip changes length at the END of its block = the START of its source window: the in-point moves, not the out-point.
    // (Callers that set the window themselves — speed changes, start trims — pass trimInMs / speed and are left alone.)
    const adj = k.reverse && patch.durationMs !== undefined && patch.trimInMs === undefined && patch.speed === undefined ? withEndDuration(k, clampDur(patch.durationMs)) : null
    return { ...k, ...patch, ...(adj ? adj : patch.durationMs !== undefined ? { durationMs: clampDur(patch.durationMs) } : {}) }
  }) }
}

export function setDuration(c: Composition, clipId: string, durationMs: number) {
  return updateClip(c, clipId, { durationMs })
}

/** Cues inside [fromMs, toMs) of a clip, re-timed so fromMs becomes 0. Used when a clip with transcript cues is trimmed or split. */
export function sliceCues(cues: Clip['cues'], fromMs: number, toMs: number): Clip['cues'] {
  if (!cues) return undefined
  return cues.filter(q => q.endMs > fromMs && q.startMs < toMs).map(q => ({ text: q.text, startMs: Math.max(q.startMs, fromMs) - fromMs, endMs: Math.min(q.endMs, toMs) - fromMs }))
}

/**
 * Trims the start of a clip: the visible part starts `deltaMs` later in the source (video) and the clip
 * gets shorter by the same amount. Negative delta extends back towards the source start.
 */
export function trimStart(c: Composition, clipId: string, deltaMs: number): Composition {
  const clip = c.clips.find(k => k.id === clipId)
  if (!clip) return c
  if (clip.reverse) {
    // Reversed: the start of the block is the END of the source window; the in-point stays and the window just gets shorter (or longer).
    const duration = clampDur(clip.durationMs - deltaMs)
    return updateClip(c, clipId, { trimInMs: clip.trimInMs ?? 0, durationMs: duration, ...(clip.cues ? { cues: sliceCues(clip.cues, clip.durationMs - duration, clip.durationMs) } : {}) })
  }
  const trimIn = Math.max((clip.trimInMs ?? 0) + deltaMs, 0)
  const applied = trimIn - (clip.trimInMs ?? 0)
  const duration = clampDur(clip.durationMs - applied)
  const realApplied = clip.durationMs - duration
  return updateClip(c, clipId, { trimInMs: (clip.trimInMs ?? 0) + realApplied, durationMs: duration, ...(clip.cues ? { cues: sliceCues(clip.cues, realApplied, clip.durationMs) } : {}) })
}

/** Splits a clip at `atMs` (relative to its start). Both halves must be at least the minimum clip length. */
export function splitClip(c: Composition, clipId: string, atMs: number): Composition {
  const i = c.clips.findIndex(k => k.id === clipId)
  if (i < 0) return c
  const clip = c.clips[i]
  if (atMs < MIN_CLIP_MS || clip.durationMs - atMs < MIN_CLIP_MS) return c
  const [k1, k2] = splitKeyframes(clip.keyframes, { zoom: clip.zoom ?? 1, focusX: clip.focusX ?? 0.5, focusY: clip.focusY ?? 0.5, rotation: clip.rotation ?? 0, opacity: clip.opacity ?? 1 }, Math.round(atMs))
  const first: Clip = { ...clip, durationMs: Math.round(atMs), transition: 'cut', transitionMs: undefined, transitionOpts: undefined, ...(k1 ? { keyframes: k1 } : {}), ...(clip.cues ? { cues: sliceCues(clip.cues, 0, Math.round(atMs)) } : {}) }
  // Reversed clips read the file backwards: the part that comes FIRST in time is the part of the source window nearest its end.
  const s = clip.speed ?? 1, cut = Math.round(atMs)
  if (clip.reverse) { first.trimInMs = Math.round((clip.trimInMs ?? 0) + (clip.durationMs - cut) * s) }
  const second: Clip = { ...clip, id: newId('clip'), durationMs: clip.durationMs - Math.round(atMs), trimInMs: clip.reverse || clip.freeze ? (clip.trimInMs ?? 0) : (clip.trimInMs ?? 0) + Math.round(atMs * (clip.speed ?? 1)), voiceAssetId: null, narration: null, text: clip.text ?? null, ...(k2 ? { keyframes: k2 } : {}), ...(clip.cues ? { cues: sliceCues(clip.cues, Math.round(atMs), clip.durationMs) } : {}) }
  const clips = [...c.clips]
  clips.splice(i, 1, first, second)
  // Subtitles: keep the narration on the first half only (it was timed to the whole clip).
  return { ...c, clips: clips.map((k, n) => ({ ...k, position: n + 1 })) }
}

/** Turns a clip's reversal on or off (or sets it). Only this clip changes; the file and the other clips that use it stay as they are. */
export function setReverse(c: Composition, clipId: string, reverse?: boolean): Composition {
  const clip = c.clips.find(k => k.id === clipId)
  if (!clip) return c
  const on = reverse ?? !clip.reverse
  if (!!clip.reverse === on) return c
  const { reverse: _drop, ...rest } = clip
  void _drop
  return { ...c, clips: c.clips.map(k => (k.id === clipId ? ((on ? { ...rest, reverse: true } : rest) as Clip) : k)) }
}

/**
 * «Crear bucle ida y vuelta»: puts a reversed copy of the clip right after it (same file, no new media). The copy is one frame shorter at
 * each end so A → reversed A → A shows no frame twice. The copy has no voice/narration and no text of its own.
 */
export function makeBounceLoop(c: Composition, clipId: string, cycles = 1): Composition {
  const i = c.clips.findIndex(k => k.id === clipId)
  if (i < 0) return c
  const clip = c.clips[i]
  if (!clip.visualAssetId) return c
  const back = backCopyOf(clip)
  if (!back) return c
  const n = Math.min(Math.max(Math.round(cycles), 1), 50)
  const cut = { transition: 'cut' as const, transitionMs: undefined, transitionOpts: undefined }
  const out: Clip[] = []
  for (let r = 0; r < n; r++) {
    const last = r === n - 1
    // The first A is the clip itself; further forward copies are plain duplicates (same file, no voice or text of their own).
    out.push(r === 0 ? { ...clip, ...cut } : { ...clip, id: newId('clip'), voiceAssetId: null, narration: null, cues: undefined, ...cut })
    out.push({ ...clip, id: newId('clip'), voiceAssetId: null, narration: null, text: null, cues: undefined, keyframes: undefined, reverse: clip.reverse ? undefined : true, trimInMs: back.trimInMs, durationMs: back.durationMs, ...(last ? { transition: clip.transition, transitionMs: clip.transitionMs, transitionOpts: clip.transitionOpts } : cut) })
  }
  const clips = [...c.clips]
  clips.splice(i, 1, ...out)
  return { ...c, clips: clips.map((k, p) => ({ ...k, position: p + 1 })) }
}

export function duplicateClip(c: Composition, clipId: string): Composition {
  const i = c.clips.findIndex(k => k.id === clipId)
  if (i < 0) return c
  const copy: Clip = { ...c.clips[i], id: newId('clip'), voiceAssetId: null }
  const clips = [...c.clips]
  clips.splice(i + 1, 0, copy)
  return { ...c, clips: clips.map((k, n) => ({ ...k, position: n + 1 })) }
}

/** Removes a clip. Audio linked to it becomes unlinked at the same absolute time (never silently dropped). */
export function deleteClip(c: Composition, clipId: string): Composition {
  const clips = c.clips.filter(k => k.id !== clipId)
  if (clips.length === c.clips.length) return c
  const audioClips = (c.audioClips ?? []).map(a => (a.linkedClipId === clipId ? { ...a, linkedClipId: null, startMs: audioStartMs(c, a) } : a))
  return { ...c, clips: clips.map((k, n) => ({ ...k, position: n + 1 })), audioClips }
}

export function addClip(c: Composition, visualAssetId: string | null, durationMs = 5000, index = c.clips.length): Composition {
  const clip: Clip = {
    id: newId('clip'), sceneId: c.clips[index - 1]?.sceneId ?? c.clips[0]?.sceneId ?? 'manual', position: 0, narration: null,
    visualAssetId, voiceAssetId: null, durationMs: clampDur(durationMs), motion: 'none', focusX: 0.5, focusY: 0.5, zoom: 1,
    trimInMs: 0, volume: 1, muted: false, transition: 'fade', text: null,
  }
  const clips = [...c.clips]
  clips.splice(index, 0, clip)
  return { ...c, clips: clips.map((k, n) => ({ ...k, position: n + 1 })) }
}

export function addAudioClip(c: Composition, a: Omit<AudioClip, 'id'>): Composition {
  return { ...c, audioClips: [...(c.audioClips ?? []), { ...a, id: newId(a.kind) }] }
}

export function updateAudioClip(c: Composition, id: string, patch: Partial<Omit<AudioClip, 'id'>>): Composition {
  return { ...c, audioClips: (c.audioClips ?? []).map(a => (a.id === id ? { ...a, ...patch, durationMs: Math.max(100, Math.round(patch.durationMs ?? a.durationMs)) } : a)) }
}

export function deleteAudioClip(c: Composition, id: string): Composition {
  return { ...c, audioClips: (c.audioClips ?? []).filter(a => a.id !== id) }
}

// ---------- Text track ----------
const clampText = (t: TextClip): TextClip => ({ ...t, startMs: Math.max(0, Math.round(t.startMs)), durationMs: Math.min(Math.max(Math.round(t.durationMs), 300), MAX_CLIP_MS), content: t.content.slice(0, 200) })
export function addTextClip(c: Composition, t: Omit<TextClip, 'id'>): Composition {
  return { ...c, textClips: [...(c.textClips ?? []), clampText({ ...t, id: newId('text') })] }
}
export function updateTextClip(c: Composition, id: string, patch: Partial<Omit<TextClip, 'id'>>): Composition {
  return { ...c, textClips: (c.textClips ?? []).map(t => (t.id === id ? clampText({ ...t, ...patch }) : t)) }
}
export function deleteTextClip(c: Composition, id: string): Composition {
  return { ...c, textClips: (c.textClips ?? []).filter(t => t.id !== id) }
}
export function duplicateTextClip(c: Composition, id: string): Composition {
  const t = (c.textClips ?? []).find(x => x.id === id)
  return t ? addTextClip(c, { ...t, startMs: t.startMs + t.durationMs }) : c
}

/** Changes a video clip's speed keeping the same stretch of source: faster = shorter on the timeline. */
export function setSpeed(c: Composition, clipId: string, speed: number): Composition {
  const clip = c.clips.find(k => k.id === clipId)
  if (!clip) return c
  const next = Math.min(Math.max(Math.round(speed * 100) / 100, 0.25), 4)
  const sourceMs = clip.durationMs * (clip.speed ?? 1)
  return updateClip(c, clipId, { speed: next, durationMs: sourceMs / next, ...(clip.cues ? { cues: clip.cues.map(q => ({ ...q, startMs: Math.round(q.startMs * (clip.speed ?? 1) / next), endMs: Math.round(q.endMs * (clip.speed ?? 1) / next) })) } : {}) })
}

/** Moves an audio clip to an absolute time; this unlinks it from its visual clip. */
export function moveAudioClip(c: Composition, id: string, startMs: number): Composition {
  return updateAudioClip(c, id, { linkedClipId: null, startMs: Math.max(0, Math.round(startMs)) })
}

/** Timeline layout for drawing: start/end of every visual and audio clip. */
export function layout(c: Composition) {
  const starts = clipStarts(c)
  return {
    totalMs: totalDurationMs(c),
    visual: c.clips.map((k, i) => ({ id: k.id, startMs: starts[i], endMs: starts[i] + k.durationMs })),
    audio: (c.audioClips ?? []).map(a => { const s = audioStartMs(c, a); return { id: a.id, startMs: s, endMs: s + a.durationMs } }),
  }
}

/** Undo/redo history of immutable snapshots. */
export type History = { past: Composition[]; present: Composition; future: Composition[] }
export const HISTORY_LIMIT = 100

export function historyOf(c: Composition): History { return { past: [], present: c, future: [] } }
export function commit(h: History, next: Composition): History {
  if (next === h.present) return h
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] }
}
export function undo(h: History): History {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}
export function redo(h: History): History {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

/**
 * The part of a composition that starts at a clip, for previewing from that point.
 * Absolute audio is shifted and trimmed so it stays in sync; audio that ended before is dropped.
 */
export function fromClip(c: Composition, clipId: string): Composition {
  const i = c.clips.findIndex(k => k.id === clipId)
  if (i <= 0) return c
  const offset = clipStarts(c)[i]
  const kept = new Set(c.clips.slice(i).map(k => k.id))
  const audioClips = (c.audioClips ?? []).flatMap(a => {
    if (a.linkedClipId) return kept.has(a.linkedClipId) ? [a] : []
    const end = a.startMs + a.durationMs
    if (end <= offset) return []
    const cut = Math.max(offset - a.startMs, 0)
    return [{ ...a, startMs: Math.max(a.startMs - offset, 0), trimInMs: a.trimInMs + cut, durationMs: a.durationMs - cut }]
  })
  return { ...c, clips: c.clips.slice(i), audioClips, hookText: null }
}

// ---------- Volume automation ----------
/**
 * Sets an audio clip's level to `gain` between `fromMs` and `toMs` (clip-relative), with `rampMs` ramps in and out. Points outside
 * keep their values (the level just before and after the stretch is preserved); points inside are replaced.
 */
export function setLevelBetween(a: AudioClip, fromMs: number, toMs: number, gain: number, rampMs = 300): AudioClip {
  const from = Math.max(0, Math.min(fromMs, a.durationMs)), to = Math.max(from, Math.min(toMs, a.durationMs))
  if (to - from < 50) return a
  const g = Math.min(2, Math.max(0, gain))
  const base = { ...a, fadeInMs: 0, fadeOutMs: 0 }
  const before = Math.max(0, from - rampMs), after = Math.min(a.durationMs, to + rampMs)
  const keep = (a.envelope ?? []).filter(p => p.atMs < before || p.atMs > after)
  const pts = [
    ...keep,
    ...(from > 0 ? [{ atMs: before, gain: envelopeAt(base, before) }] : []),
    { atMs: from, gain: g }, { atMs: to, gain: g },
    ...(to < a.durationMs ? [{ atMs: after, gain: envelopeAt(base, after) }] : []),
  ].sort((x, y) => x.atMs - y.atMs)
  return { ...a, envelope: pts.filter((p, i) => i === 0 || p.atMs !== pts[i - 1].atMs).slice(0, 64) }
}

/**
 * Adds a video of any length: up to MAX_CLIP_MS it is one clip; a longer one (a 90-minute recording) becomes consecutive pieces
 * with straight cuts that play the whole file, so nothing is lost and each piece can be edited on its own.
 */
export function addVideo(c: Composition, assetId: string, durationMs: number, index = c.clips.length): Composition {
  const total = Math.min(MAX_TIMELINE_MS, Math.max(MIN_CLIP_MS, Math.round(Number.isFinite(durationMs) ? durationMs : MIN_CLIP_MS)))
  if (total <= MAX_CLIP_MS) return addClip(c, assetId, total, index)
  const pieces = Math.ceil(total / MAX_CLIP_MS)
  const len = Math.ceil(total / pieces)
  let out = c
  for (let p = 0; p < pieces; p++) {
    const d = Math.min(len, total - p * len)
    if (d < MIN_CLIP_MS) break
    out = addClip(out, assetId, d, index + p)
    out = updateClip(out, out.clips[index + p].id, { trimInMs: p * len, transition: p < pieces - 1 ? 'cut' : 'fade' })
  }
  return out
}

/** A point on an automation lane of `width`×`height` px for a clip of `durationMs`: x → time, y → gain (top = 200 %, bottom = 0). */
export function envelopePointAt(x: number, y: number, width: number, height: number, durationMs: number): { atMs: number; gain: number } {
  const atMs = Math.round(Math.min(Math.max(x / Math.max(1, width), 0), 1) * durationMs)
  const gain = Math.round(Math.min(Math.max(2 * (1 - y / Math.max(1, height)), 0), 2) * 100) / 100
  return { atMs, gain }
}

/** Moves envelope point `i`, keeping it between its neighbours (points never cross) and inside the clip. */
export function moveEnvelopePoint(a: AudioClip, i: number, p: { atMs: number; gain: number }): AudioClip {
  const pts = [...(a.envelope ?? [])]
  if (!pts[i]) return a
  const lo = i > 0 ? pts[i - 1].atMs + 10 : 0, hi = i < pts.length - 1 ? pts[i + 1].atMs - 10 : a.durationMs
  pts[i] = { atMs: Math.round(Math.min(Math.max(p.atMs, lo), Math.max(lo, hi))), gain: Math.min(Math.max(p.gain, 0), 2) }
  return { ...a, envelope: pts }
}

/** Adds a point (kept sorted; at most 64). */
export function addEnvelopePoint(a: AudioClip, p: { atMs: number; gain: number }): AudioClip {
  const pts = [...(a.envelope ?? []).filter(x => Math.abs(x.atMs - p.atMs) > 5), { atMs: Math.round(p.atMs), gain: Math.min(Math.max(p.gain, 0), 2) }].sort((x, y) => x.atMs - y.atMs)
  return { ...a, envelope: pts.slice(0, 64) }
}

/**
 * «Congelar fotograma»: detiene el vídeo en el fotograma de `atMs` (tiempo local del clip) durante `holdMs`. Divide el clip en ese punto
 * (o, si queda a menos de un clip mínimo de un borde, lo inserta justo antes o después) y coloca un clip congelado entre las dos mitades.
 * No toca el archivo; el clip congelado usa el mismo archivo y va sin sonido.
 */
export function freezeFrame(c: Composition, clipId: string, atMs: number, holdMs = 2000): Composition {
  const i = c.clips.findIndex(k => k.id === clipId)
  const clip = c.clips[i]
  if (!clip || !clip.visualAssetId || clip.freeze) return c
  const at = Math.min(Math.max(Math.round(atMs), 0), clip.durationMs)
  const src = Math.max(0, Math.round(sourceAt(clip, Math.min(at, clip.durationMs - 1))))
  const still: Clip = {
    ...clip, id: newId('clip'), freeze: true, reverse: undefined, speed: 1, trimInMs: src, durationMs: clampDur(holdMs), voiceAssetId: null, narration: null, text: null,
    cues: undefined, keyframes: undefined, transition: 'cut', transitionMs: undefined, transitionOpts: undefined,
  }
  let list = [...c.clips]
  if (at < MIN_CLIP_MS) list.splice(i, 0, still)
  else if (clip.durationMs - at < MIN_CLIP_MS) list.splice(i + 1, 0, still)
  else {
    const s = splitClip(c, clipId, at)
    list = [...s.clips]
    list.splice(i + 1, 0, still)
  }
  return { ...c, clips: list.map((k, n) => ({ ...k, position: n + 1 })) }
}
