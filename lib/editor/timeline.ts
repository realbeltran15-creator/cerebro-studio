import { audioStartMs, clipStarts, MAX_CLIP_MS, MIN_CLIP_MS, totalDurationMs, type AudioClip, type Clip, type Composition } from './composition'

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
  return { ...c, clips, audioClips, editedManually: true }
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
  return { ...c, clips: c.clips.map(k => (k.id === clipId ? { ...k, ...patch, ...(patch.durationMs !== undefined ? { durationMs: clampDur(patch.durationMs) } : {}) } : k)) }
}

export function setDuration(c: Composition, clipId: string, durationMs: number) {
  return updateClip(c, clipId, { durationMs })
}

/**
 * Trims the start of a clip: the visible part starts `deltaMs` later in the source (video) and the clip
 * gets shorter by the same amount. Negative delta extends back towards the source start.
 */
export function trimStart(c: Composition, clipId: string, deltaMs: number): Composition {
  const clip = c.clips.find(k => k.id === clipId)
  if (!clip) return c
  const trimIn = Math.max((clip.trimInMs ?? 0) + deltaMs, 0)
  const applied = trimIn - (clip.trimInMs ?? 0)
  const duration = clampDur(clip.durationMs - applied)
  const realApplied = clip.durationMs - duration
  return updateClip(c, clipId, { trimInMs: (clip.trimInMs ?? 0) + realApplied, durationMs: duration })
}

/** Splits a clip at `atMs` (relative to its start). Both halves must be at least the minimum clip length. */
export function splitClip(c: Composition, clipId: string, atMs: number): Composition {
  const i = c.clips.findIndex(k => k.id === clipId)
  if (i < 0) return c
  const clip = c.clips[i]
  if (atMs < MIN_CLIP_MS || clip.durationMs - atMs < MIN_CLIP_MS) return c
  const first: Clip = { ...clip, durationMs: Math.round(atMs), transition: 'cut' }
  const second: Clip = { ...clip, id: newId('clip'), durationMs: clip.durationMs - Math.round(atMs), trimInMs: (clip.trimInMs ?? 0) + Math.round(atMs), voiceAssetId: null, narration: null, text: clip.text ?? null }
  const clips = [...c.clips]
  clips.splice(i, 1, first, second)
  // Subtitles: keep the narration on the first half only (it was timed to the whole clip).
  return { ...c, clips: clips.map((k, n) => ({ ...k, position: n + 1 })) }
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
