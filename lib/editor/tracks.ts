/**
 * Multitrack editing: tracks (create, delete, duplicate, rename, reorder, lock, hide, mute, solo), overlays, selections of several
 * items, groups, copy/paste, split at the playhead, snapping and markers. Pure functions on the composition, like timeline.ts,
 * so manual edits and written instructions share the same undo history.
 */
import {
  audioStartMs, audioTrackId, clipStarts, DEFAULT_TRANSFORM, MAX_TIMELINE_MS, projectDurationMs, textTrackId, tracksOf,
  type AudioClip, type Clip, type Composition, type Marker, type OverlayClip, type TextClip, type TrackMeta, type TrackType,
} from './composition'
import { splitKeyframes } from './motion'
import { withEndDuration } from './reverse'
import { deleteAudioClip, deleteClip, deleteTextClip, splitClip, updateAudioClip, updateTextClip } from './timeline'

export type ItemKind = 'clip' | 'audio' | 'text' | 'overlay'
export type ItemRef = { kind: ItemKind; id: string }
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`
const sameRef = (a: ItemRef, b: ItemRef) => a.kind === b.kind && a.id === b.id

// ---------- Tracks ----------
/** The composition with its track list written out (so it can be edited). */
export function withTracks(c: Composition): Composition { return { ...c, tracks: tracksOf(c) } }

const TYPE_NAMES: Record<TrackType, string> = { main: 'Vídeo principal', overlay: 'Superposición', text: 'Texto', voice: 'Voz', music: 'Música', sfx: 'Efectos' }

/** Adds a track of a type. Overlays go right above the main track (or above `afterId`); the rest at the end of their kind. */
export function addTrack(c: Composition, type: Exclude<TrackType, 'main'>, name?: string): { composition: Composition; trackId: string } {
  const tracks = tracksOf(c)
  const id = newId(type === 'overlay' ? 'ov' : type)
  const count = tracks.filter(t => t.type === type).length + 1
  const meta: TrackMeta = { id, type, name: (name?.trim() || `${TYPE_NAMES[type]} ${count}`).slice(0, 40) }
  const list = [...tracks]
  if (type === 'overlay') list.splice(0, 0, meta)
  else {
    const lastSame = list.map(t => t.type).lastIndexOf(type)
    list.splice(lastSame < 0 ? list.length : lastSame + 1, 0, meta)
  }
  return { composition: { ...c, tracks: list }, trackId: id }
}

export function updateTrack(c: Composition, id: string, patch: Partial<Pick<TrackMeta, 'name' | 'locked' | 'hidden' | 'muted' | 'solo'>>): Composition {
  const tracks = tracksOf(c).map(t => (t.id === id ? { ...t, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 40) || t.name } : {}) } : t))
  return { ...c, tracks }
}

/** Removes a track and everything on it (the main track cannot be removed; clear it instead). */
export function deleteTrack(c: Composition, id: string): Composition {
  const tracks = tracksOf(c)
  const t = tracks.find(x => x.id === id)
  if (!t || t.type === 'main') return c
  let out: Composition = { ...c, tracks: tracks.filter(x => x.id !== id) }
  if (t.type === 'overlay') out = { ...out, overlays: (c.overlays ?? []).filter(o => o.trackId !== id) }
  else if (t.type === 'text') out = { ...out, textClips: (c.textClips ?? []).filter(x => textTrackId(x) !== id) }
  else out = { ...out, audioClips: (c.audioClips ?? []).filter(a => audioTrackId(a) !== id) }
  return out
}

/** Copies a track with all its clips (new ids) right after it. */
export function duplicateTrack(c: Composition, id: string): Composition {
  const tracks = tracksOf(c)
  const i = tracks.findIndex(x => x.id === id)
  const t = tracks[i]
  if (!t || t.type === 'main') return c
  const copyId = newId(t.type === 'overlay' ? 'ov' : t.type)
  const list = [...tracks]
  list.splice(t.type === 'overlay' ? i : i + 1, 0, { ...t, id: copyId, name: `${t.name} (copia)`.slice(0, 40), solo: false })
  const out: Composition = { ...c, tracks: list }
  if (t.type === 'overlay') return { ...out, overlays: [...(c.overlays ?? []), ...(c.overlays ?? []).filter(o => o.trackId === id).map(o => ({ ...o, id: newId('ov'), trackId: copyId, groupId: undefined }))] }
  if (t.type === 'text') return { ...out, textClips: [...(c.textClips ?? []), ...(c.textClips ?? []).filter(x => textTrackId(x) === id).map(x => ({ ...x, id: newId('text'), trackId: copyId, groupId: undefined }))] }
  return { ...out, audioClips: [...(c.audioClips ?? []), ...(c.audioClips ?? []).filter(a => audioTrackId(a) === id).map(a => ({ ...a, id: newId(a.kind), trackId: copyId, linkedClipId: null, startMs: audioStartMs(c, a), groupId: undefined }))] }
}

/** Moves a track one place up or down. Overlays stay above the main track and every other track stays below it. */
export function moveTrack(c: Composition, id: string, dir: -1 | 1): Composition {
  const list = [...tracksOf(c)]
  const i = list.findIndex(x => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length || list[i].type === 'main' || list[j].type === 'main') return c
  ;[list[i], list[j]] = [list[j], list[i]]
  return { ...c, tracks: list }
}

export const trackOf = (c: Composition, ref: ItemRef): string | null => {
  if (ref.kind === 'clip') return 'main'
  if (ref.kind === 'overlay') return (c.overlays ?? []).find(o => o.id === ref.id)?.trackId ?? null
  if (ref.kind === 'audio') { const a = (c.audioClips ?? []).find(x => x.id === ref.id); return a ? audioTrackId(a) : null }
  const t = (c.textClips ?? []).find(x => x.id === ref.id); return t ? textTrackId(t) : null
}
export const isLocked = (c: Composition, ref: ItemRef) => { const id = trackOf(c, ref); return !!id && !!tracksOf(c).find(t => t.id === id)?.locked }

// ---------- Overlays ----------
export function addOverlay(c: Composition, o: Partial<OverlayClip> & Pick<OverlayClip, 'assetId' | 'startMs' | 'durationMs'> & { trackId?: string }): { composition: Composition; id: string } {
  let comp = c
  let trackId = o.trackId
  if (!trackId || !tracksOf(c).some(t => t.id === trackId && t.type === 'overlay')) {
    const first = tracksOf(c).find(t => t.type === 'overlay')
    if (first) trackId = first.id
    else { const r = addTrack(c, 'overlay'); comp = r.composition; trackId = r.trackId }
  }
  const id = newId('ov')
  const clip: OverlayClip = {
    id, trackId, assetId: o.assetId, startMs: Math.max(0, Math.round(o.startMs)), durationMs: Math.max(100, Math.min(Math.round(o.durationMs), MAX_TIMELINE_MS)), trimInMs: Math.max(0, Math.round(o.trimInMs ?? 0)),
    transform: { ...DEFAULT_TRANSFORM, ...(o.transform ?? {}) },
    ...(o.speed ? { speed: o.speed } : {}), ...(o.volume !== undefined ? { volume: o.volume } : {}), ...(o.muted ? { muted: true } : {}),
    ...(o.keyframes ? { keyframes: o.keyframes } : {}), ...(o.camera ? { camera: o.camera } : {}), ...(o.fadeInMs ? { fadeInMs: o.fadeInMs } : {}), ...(o.fadeOutMs ? { fadeOutMs: o.fadeOutMs } : {}),
  }
  return { composition: { ...comp, overlays: [...(comp.overlays ?? []), clip] }, id }
}
export function updateOverlay(c: Composition, id: string, patch: Partial<Omit<OverlayClip, 'id'>>): Composition {
  return {
    ...c, overlays: (c.overlays ?? []).map(o => {
      if (o.id !== id) return o
      const n = { ...o, ...patch }
      n.startMs = Math.max(0, Math.round(n.startMs)); n.durationMs = Math.max(100, Math.round(n.durationMs)); n.trimInMs = Math.max(0, Math.round(n.trimInMs))
      if (n.keyframes) n.keyframes = n.keyframes.map(k => ({ ...k, atMs: Math.min(Math.max(0, k.atMs), n.durationMs) })).sort((a, b) => a.atMs - b.atMs)
      return n
    }),
  }
}
export const deleteOverlay = (c: Composition, id: string): Composition => ({ ...c, overlays: (c.overlays ?? []).filter(o => o.id !== id) })

/** Adds or replaces a keyframe of an overlay at `atMs` (clip-relative) with its current values there. */
export function setKeyframe(c: Composition, id: string, atMs: number, values: Partial<OverlayClip['transform']>): Composition {
  const o = (c.overlays ?? []).find(x => x.id === id)
  if (!o) return c
  const at = Math.round(Math.min(Math.max(atMs, 0), o.durationMs))
  const others = (o.keyframes ?? []).filter(k => Math.abs(k.atMs - at) > 20)
  const prev = (o.keyframes ?? []).find(k => Math.abs(k.atMs - at) <= 20)
  return updateOverlay(c, id, { keyframes: [...others, { ...(prev ?? {}), ...values, atMs: at }].sort((a, b) => a.atMs - b.atMs).slice(0, 64) })
}
export function removeKeyframe(c: Composition, id: string, atMs: number): Composition {
  const o = (c.overlays ?? []).find(x => x.id === id)
  if (!o) return c
  const rest = (o.keyframes ?? []).filter(k => Math.abs(k.atMs - atMs) > 20)
  return updateOverlay(c, id, { keyframes: rest.length ? rest : undefined })
}

// ---------- Items (any kind) ----------
/** Absolute start and length on the timeline of any item. */
export function itemSpan(c: Composition, ref: ItemRef, starts = clipStarts(c)): { startMs: number; durationMs: number } | null {
  if (ref.kind === 'clip') { const i = c.clips.findIndex(k => k.id === ref.id); return i < 0 ? null : { startMs: starts[i], durationMs: c.clips[i].durationMs } }
  if (ref.kind === 'overlay') { const o = (c.overlays ?? []).find(x => x.id === ref.id); return o ? { startMs: o.startMs, durationMs: o.durationMs } : null }
  if (ref.kind === 'audio') { const a = (c.audioClips ?? []).find(x => x.id === ref.id); return a ? { startMs: audioStartMs(c, a), durationMs: a.durationMs } : null }
  const t = (c.textClips ?? []).find(x => x.id === ref.id); return t ? { startMs: t.startMs, durationMs: t.durationMs } : null
}

export function groupOf(c: Composition, ref: ItemRef): string | undefined {
  if (ref.kind === 'clip') return c.clips.find(k => k.id === ref.id)?.groupId
  if (ref.kind === 'overlay') return (c.overlays ?? []).find(o => o.id === ref.id)?.groupId
  if (ref.kind === 'audio') return (c.audioClips ?? []).find(a => a.id === ref.id)?.groupId
  return (c.textClips ?? []).find(t => t.id === ref.id)?.groupId
}
/** Every item of the given groups. */
export function expandGroups(c: Composition, refs: ItemRef[]): ItemRef[] {
  const groups = new Set(refs.map(r => groupOf(c, r)).filter((g): g is string => Boolean(g)))
  if (!groups.size) return refs
  const all: ItemRef[] = [
    ...c.clips.filter(k => k.groupId && groups.has(k.groupId)).map(k => ({ kind: 'clip' as const, id: k.id })),
    ...(c.overlays ?? []).filter(o => o.groupId && groups.has(o.groupId)).map(o => ({ kind: 'overlay' as const, id: o.id })),
    ...(c.audioClips ?? []).filter(a => a.groupId && groups.has(a.groupId)).map(a => ({ kind: 'audio' as const, id: a.id })),
    ...(c.textClips ?? []).filter(t => t.groupId && groups.has(t.groupId)).map(t => ({ kind: 'text' as const, id: t.id })),
  ]
  return [...refs, ...all.filter(a => !refs.some(r => sameRef(r, a)))]
}

function setGroup(c: Composition, refs: ItemRef[], groupId: string | undefined): Composition {
  const has = (kind: ItemKind, id: string) => refs.some(r => r.kind === kind && r.id === id)
  const tag = <T extends { id: string; groupId?: string }>(x: T, kind: ItemKind): T => {
    if (!has(kind, x.id)) return x
    if (groupId) return { ...x, groupId }
    const { groupId: _drop, ...rest } = x
    void _drop
    return rest as T
  }
  return {
    ...c,
    clips: c.clips.map(k => tag(k, 'clip')),
    overlays: c.overlays?.map(o => tag(o, 'overlay')),
    audioClips: c.audioClips?.map(a => tag(a, 'audio')),
    textClips: c.textClips?.map(t => tag(t, 'text')),
  }
}
/** Groups items so they are selected and moved together. */
export const groupItems = (c: Composition, refs: ItemRef[]) => (refs.length < 2 ? c : setGroup(c, refs, newId('g')))
export const ungroupItems = (c: Composition, refs: ItemRef[]) => setGroup(c, expandGroups(c, refs), undefined)

export function deleteItems(c: Composition, refs: ItemRef[]): Composition {
  let out = c
  for (const r of refs) {
    if (isLocked(out, r)) continue
    if (r.kind === 'clip') out = deleteClip(out, r.id)
    else if (r.kind === 'audio') out = deleteAudioClip(out, r.id)
    else if (r.kind === 'text') out = deleteTextClip(out, r.id)
    else out = deleteOverlay(out, r.id)
  }
  return out
}

/**
 * Moves the free-standing items (overlays, audio, texts) by `deltaMs`; main-track clips are sequential and do not move this way.
 * The whole move is limited so nothing goes before 0. Linked audio becomes absolute.
 */
export function moveItems(c: Composition, refs: ItemRef[], deltaMs: number): Composition {
  const spans = refs.filter(r => r.kind !== 'clip' && !isLocked(c, r)).map(r => ({ r, s: itemSpan(c, r) })).filter((x): x is { r: ItemRef; s: { startMs: number; durationMs: number } } => !!x.s)
  if (!spans.length) return c
  const d = Math.max(deltaMs, -Math.min(...spans.map(x => x.s.startMs)))
  let out = c
  for (const { r, s } of spans) {
    const start = Math.round(s.startMs + d)
    if (r.kind === 'overlay') out = updateOverlay(out, r.id, { startMs: start })
    else if (r.kind === 'audio') out = updateAudioClip(out, r.id, { linkedClipId: null, startMs: start })
    else out = updateTextClip(out, r.id, { startMs: start })
  }
  return out
}

/** Moves an overlay or audio clip to another track of a compatible type. */
export function moveToTrack(c: Composition, ref: ItemRef, trackId: string): Composition {
  const t = tracksOf(c).find(x => x.id === trackId)
  if (!t || t.locked) return c
  if (ref.kind === 'overlay' && t.type === 'overlay') return updateOverlay(c, ref.id, { trackId })
  if (ref.kind === 'text' && t.type === 'text') return updateTextClip(c, ref.id, { trackId: trackId === 'text' ? undefined : trackId })
  if (ref.kind === 'audio' && (t.type === 'voice' || t.type === 'music' || t.type === 'sfx')) return updateAudioClip(c, ref.id, { kind: t.type, trackId: trackId === t.type ? undefined : trackId })
  return c
}

/** Copied items, with times relative to the earliest one, ready to paste anywhere. */
export type Clipboard = { items: Array<{ kind: 'overlay'; v: OverlayClip; at: number } | { kind: 'audio'; v: AudioClip; at: number } | { kind: 'text'; v: TextClip; at: number } | { kind: 'clip'; v: Clip; at: number }> }
export function copyItems(c: Composition, refs: ItemRef[]): Clipboard | null {
  const starts = clipStarts(c)
  const items: Clipboard['items'] = []
  for (const r of expandGroups(c, refs)) {
    const s = itemSpan(c, r, starts)
    if (!s) continue
    if (r.kind === 'clip') items.push({ kind: 'clip', v: c.clips.find(k => k.id === r.id)!, at: s.startMs })
    else if (r.kind === 'overlay') items.push({ kind: 'overlay', v: (c.overlays ?? []).find(o => o.id === r.id)!, at: s.startMs })
    else if (r.kind === 'audio') items.push({ kind: 'audio', v: (c.audioClips ?? []).find(a => a.id === r.id)!, at: s.startMs })
    else items.push({ kind: 'text', v: (c.textClips ?? []).find(t => t.id === r.id)!, at: s.startMs })
  }
  if (!items.length) return null
  const t0 = Math.min(...items.map(i => i.at))
  return { items: items.map(i => ({ ...i, at: i.at - t0 })) as Clipboard['items'] }
}

/**
 * Pastes at `atMs`: free items keep their relative timing and tracks (a missing or locked track gets a new one of the same type);
 * main-track clips are inserted, in order, at the clip boundary nearest to the playhead. Returns the new items to select them.
 */
export function pasteItems(c: Composition, clip: Clipboard, atMs: number): { composition: Composition; refs: ItemRef[] } {
  let out = c
  const refs: ItemRef[] = []
  const group = clip.items.length > 1 && clip.items.some(i => (i.v as { groupId?: string }).groupId) ? newId('g') : undefined
  const mains = clip.items.filter(i => i.kind === 'clip')
  if (mains.length) {
    const starts = clipStarts(out)
    let index = out.clips.findIndex((k, i) => starts[i] + k.durationMs / 2 > atMs)
    if (index < 0) index = out.clips.length
    const clips = [...out.clips]
    const added = mains.map(m => ({ ...(m.v as Clip), id: newId('clip'), voiceAssetId: null, ...(group ? { groupId: group } : { groupId: undefined }) }))
    clips.splice(index, 0, ...added)
    out = { ...out, clips: clips.map((k, n) => ({ ...k, position: n + 1 })) }
    refs.push(...added.map(k => ({ kind: 'clip' as const, id: k.id })))
  }
  const usable = (id: string, type: TrackType) => { const t = tracksOf(out).find(x => x.id === id); return !!t && t.type === type && !t.locked }
  const remap = new Map<string, string>()
  const trackFor = (id: string, type: Exclude<TrackType, 'main'>) => {
    if (usable(id, type)) return id
    if (!remap.has(id)) { const r = addTrack(out, type); out = r.composition; remap.set(id, r.trackId) }
    return remap.get(id)!
  }
  for (const i of clip.items) {
    const start = Math.max(0, Math.round(atMs + i.at))
    if (i.kind === 'overlay') {
      const v = i.v as OverlayClip
      const id = newId('ov')
      out = { ...out, overlays: [...(out.overlays ?? []), { ...v, id, startMs: start, trackId: trackFor(v.trackId, 'overlay'), groupId: group }] }
      refs.push({ kind: 'overlay', id })
    } else if (i.kind === 'audio') {
      const v = i.v as AudioClip
      const id = newId(v.kind)
      const tid = trackFor(audioTrackId(v), v.kind)
      out = { ...out, audioClips: [...(out.audioClips ?? []), { ...v, id, linkedClipId: null, startMs: start, trackId: tid === v.kind ? undefined : tid, groupId: group }] }
      refs.push({ kind: 'audio', id })
    } else if (i.kind === 'text') {
      const v = i.v as TextClip
      const id = newId('text')
      const tid = trackFor(textTrackId(v), 'text')
      out = { ...out, textClips: [...(out.textClips ?? []), { ...v, id, startMs: start, trackId: tid === 'text' ? undefined : tid, groupId: group }] }
      refs.push({ kind: 'text', id })
    }
  }
  return { composition: out, refs }
}

/** Duplicates items right after themselves (free items) or after the clip (main track). */
export function duplicateItems(c: Composition, refs: ItemRef[]): { composition: Composition; refs: ItemRef[] } {
  const cb = copyItems(c, refs)
  if (!cb) return { composition: c, refs: [] }
  const spans = expandGroups(c, refs).map(r => itemSpan(c, r)).filter((s): s is { startMs: number; durationMs: number } => !!s)
  const end = Math.max(...spans.map(s => s.startMs + s.durationMs))
  return pasteItems(c, cb, end)
}

/**
 * Cuts every item under the playhead in two (on unlocked tracks), or only the selected ones. Main-track halves keep at least 1 s;
 * other items at least 100 ms.
 */
export function splitAt(c: Composition, atMs: number, refs?: ItemRef[]): { composition: Composition; cut: number } {
  let out = c
  let cut = 0
  const only = refs?.length ? expandGroups(c, refs) : null
  const wants = (r: ItemRef) => (!only || only.some(x => sameRef(x, r))) && !isLocked(out, r)
  const starts = clipStarts(out)
  const i = out.clips.findIndex((k, n) => atMs > starts[n] && atMs < starts[n] + k.durationMs)
  if (i >= 0 && wants({ kind: 'clip', id: out.clips[i].id })) {
    const before = out.clips.length
    out = splitClip(out, out.clips[i].id, atMs - starts[i])
    if (out.clips.length > before) cut++
  }
  for (const o of [...(out.overlays ?? [])]) {
    if (!(atMs > o.startMs + 100 && atMs < o.startMs + o.durationMs - 100) || !wants({ kind: 'overlay', id: o.id })) continue
    const first = atMs - o.startMs
    const [k1, k2] = splitKeyframes(o.keyframes, { ...o.transform }, first)
    const second: OverlayClip = { ...o, id: newId('ov'), startMs: atMs, durationMs: o.durationMs - first, trimInMs: o.reverse ? o.trimInMs : o.trimInMs + Math.round(first * (o.speed ?? 1)), keyframes: k2, fadeInMs: undefined }
    const firstTrim = o.reverse ? Math.round(o.trimInMs + (o.durationMs - first) * (o.speed ?? 1)) : o.trimInMs
    out = { ...out, overlays: (out.overlays ?? []).flatMap(x => (x.id === o.id ? [{ ...x, durationMs: first, trimInMs: firstTrim, keyframes: k1, fadeOutMs: undefined }, second] : [x])) }
    cut++
  }
  for (const a of [...(out.audioClips ?? [])]) {
    const s = audioStartMs(out, a)
    if (!(atMs > s + 100 && atMs < s + a.durationMs - 100) || !wants({ kind: 'audio', id: a.id })) continue
    const first = atMs - s
    const env = a.envelope
    const second: AudioClip = { ...a, id: newId(a.kind), linkedClipId: null, startMs: atMs, trimInMs: a.trimInMs + first, durationMs: a.durationMs - first, fadeInMs: undefined, ...(env ? { envelope: env.filter(p => p.atMs >= first).map(p => ({ ...p, atMs: p.atMs - first })) } : {}) }
    out = { ...out, audioClips: (out.audioClips ?? []).flatMap(x => (x.id === a.id ? [{ ...x, linkedClipId: null, startMs: s, durationMs: first, fadeOutMs: undefined, ...(env ? { envelope: env.filter(p => p.atMs <= first) } : {}) }, second] : [x])) }
    cut++
  }
  for (const t of [...(out.textClips ?? [])]) {
    if (!(atMs > t.startMs + 300 && atMs < t.startMs + t.durationMs - 300) || !wants({ kind: 'text', id: t.id })) continue
    const first = atMs - t.startMs
    out = { ...out, textClips: (out.textClips ?? []).flatMap(x => (x.id === t.id ? [{ ...x, durationMs: first }, { ...x, id: newId('text'), startMs: atMs, durationMs: t.durationMs - first }] : [x])) }
    cut++
  }
  return { composition: out, cut }
}

/** Trims the start of a free item (its left edge): later start, later in the source, shorter. */
export function trimItemStart(c: Composition, ref: ItemRef, deltaMs: number): Composition {
  if (isLocked(c, ref)) return c
  if (ref.kind === 'overlay') {
    const o = (c.overlays ?? []).find(x => x.id === ref.id)
    if (!o) return c
    // A reversed layer reads its file backwards: its left edge is the END of the source window, so the in-point stays.
    const d = Math.min(Math.max(deltaMs, -o.startMs, o.reverse ? -Infinity : -o.trimInMs / (o.speed ?? 1)), o.durationMs - 100)
    return updateOverlay(c, o.id, { startMs: o.startMs + d, durationMs: o.durationMs - d, trimInMs: o.reverse ? o.trimInMs : o.trimInMs + d * (o.speed ?? 1), keyframes: o.keyframes?.map(k => ({ ...k, atMs: k.atMs - d })).filter(k => k.atMs >= 0) })
  }
  if (ref.kind === 'audio') {
    const a = (c.audioClips ?? []).find(x => x.id === ref.id)
    if (!a) return c
    const s = audioStartMs(c, a)
    const d = Math.min(Math.max(deltaMs, -s, -a.trimInMs), a.durationMs - 100)
    return updateAudioClip(c, a.id, { linkedClipId: null, startMs: s + d, trimInMs: a.trimInMs + d, durationMs: a.durationMs - d, ...(a.envelope ? { envelope: a.envelope.map(p => ({ ...p, atMs: p.atMs - d })).filter(p => p.atMs >= 0) } : {}) })
  }
  if (ref.kind === 'text') {
    const t = (c.textClips ?? []).find(x => x.id === ref.id)
    if (!t) return c
    const d = Math.min(Math.max(deltaMs, -t.startMs), t.durationMs - 300)
    return updateTextClip(c, t.id, { startMs: t.startMs + d, durationMs: t.durationMs - d })
  }
  return c
}
/** Changes the end of a free item (its right edge). */
export function setItemEnd(c: Composition, ref: ItemRef, endMs: number): Composition {
  if (isLocked(c, ref)) return c
  const s = itemSpan(c, ref)
  if (!s) return c
  const dur = Math.max(ref.kind === 'text' ? 300 : 100, Math.round(endMs - s.startMs))
  if (ref.kind === 'overlay') { const o = (c.overlays ?? []).find(x => x.id === ref.id); return updateOverlay(c, ref.id, o?.reverse ? withEndDuration(o, dur) : { durationMs: dur }) }
  if (ref.kind === 'audio') return updateAudioClip(c, ref.id, { durationMs: dur })
  if (ref.kind === 'text') return updateTextClip(c, ref.id, { durationMs: dur })
  return c
}

// ---------- Snapping ----------
/** Times things stick to: every clip edge, the playhead, markers and (optionally) beats; items being moved are left out. */
export function snapPoints(c: Composition, exclude: ItemRef[] = [], extra: number[] = []): number[] {
  const starts = clipStarts(c)
  const pts = new Set<number>([0, projectDurationMs(c), ...extra])
  const skip = (r: ItemRef) => exclude.some(x => sameRef(x, r))
  c.clips.forEach((k, i) => { if (!skip({ kind: 'clip', id: k.id })) { pts.add(starts[i]); pts.add(starts[i] + k.durationMs) } })
  for (const o of c.overlays ?? []) if (!skip({ kind: 'overlay', id: o.id })) { pts.add(o.startMs); pts.add(o.startMs + o.durationMs) }
  for (const a of c.audioClips ?? []) if (!skip({ kind: 'audio', id: a.id })) { const s = audioStartMs(c, a); pts.add(s); pts.add(s + a.durationMs) }
  for (const t of c.textClips ?? []) if (!skip({ kind: 'text', id: t.id })) { pts.add(t.startMs); pts.add(t.startMs + t.durationMs) }
  for (const m of c.markers ?? []) pts.add(m.atMs)
  return [...pts].sort((a, b) => a - b)
}
/** The nearest snap point within `toleranceMs`, or the value itself. */
export function snap(ms: number, points: number[], toleranceMs: number): number {
  let best = ms, d = toleranceMs + 1
  for (const p of points) { const x = Math.abs(p - ms); if (x < d) { d = x; best = p } }
  return d <= toleranceMs ? best : ms
}
/** Snaps a moving block by whichever of its two edges is closer to a point. Returns the snapped start. */
export function snapBlock(startMs: number, durationMs: number, points: number[], toleranceMs: number): number {
  const a = snap(startMs, points, toleranceMs), b = snap(startMs + durationMs, points, toleranceMs) - durationMs
  const da = Math.abs(a - startMs), db = Math.abs(b - startMs)
  if (a === startMs && b === startMs) return startMs
  if (a !== startMs && (b === startMs || da <= db)) return a
  return b
}

// ---------- Markers ----------
export function addMarker(c: Composition, atMs: number, label = ''): Composition {
  const at = Math.max(0, Math.round(atMs))
  if ((c.markers ?? []).some(m => Math.abs(m.atMs - at) < 30)) return c
  const n = (c.markers?.length ?? 0) + 1
  const m: Marker = { id: newId('mk'), atMs: at, label: (label || `Marcador ${n}`).slice(0, 60) }
  return { ...c, markers: [...(c.markers ?? []), m].sort((a, b) => a.atMs - b.atMs) }
}
export const updateMarker = (c: Composition, id: string, patch: Partial<Omit<Marker, 'id'>>): Composition => ({ ...c, markers: (c.markers ?? []).map(m => (m.id === id ? { ...m, ...patch, atMs: Math.max(0, Math.round(patch.atMs ?? m.atMs)) } : m)).sort((a, b) => a.atMs - b.atMs) })
export const deleteMarker = (c: Composition, id: string): Composition => ({ ...c, markers: (c.markers ?? []).filter(m => m.id !== id) })

/** Every item in a time range (for «seleccionar del minuto 2 al 3» on all tracks). */
export function itemsInRange(c: Composition, fromMs: number, toMs: number): ItemRef[] {
  const starts = clipStarts(c)
  const hit = (s: number, d: number) => s < toMs && s + d > fromMs
  return [
    ...c.clips.flatMap((k, i) => (hit(starts[i], k.durationMs) ? [{ kind: 'clip' as const, id: k.id }] : [])),
    ...(c.overlays ?? []).flatMap(o => (hit(o.startMs, o.durationMs) ? [{ kind: 'overlay' as const, id: o.id }] : [])),
    ...(c.audioClips ?? []).flatMap(a => (hit(audioStartMs(c, a), a.durationMs) ? [{ kind: 'audio' as const, id: a.id }] : [])),
    ...(c.textClips ?? []).flatMap(t => (hit(t.startMs, t.durationMs) ? [{ kind: 'text' as const, id: t.id }] : [])),
  ]
}


// ---------- Missing files ----------
/** Every asset the montage uses, with where it is used (for the «missing file» notice). */
export function assetUses(c: Composition): Map<string, string[]> {
  const uses = new Map<string, string[]>()
  const add = (id: string | null | undefined, where: string) => { if (id) uses.set(id, [...(uses.get(id) ?? []), where]) }
  c.clips.forEach((k, i) => { add(k.visualAssetId, `clip ${i + 1}`); add(k.voiceAssetId, `voz del clip ${i + 1}`) })
  ;(c.overlays ?? []).forEach((o, i) => add(o.assetId, `superposición ${i + 1}`))
  ;(c.audioClips ?? []).forEach(a => add(a.assetId, a.kind === 'music' ? 'música' : a.kind === 'voice' ? 'voz' : 'efecto'))
  add(c.musicAssetId, 'música de fondo')
  return uses
}
/** Assets the montage uses that are not in the list given (deleted from the Library, or not loaded). */
export function missingAssets(c: Composition, known: Array<{ id: string }>): Array<{ id: string; uses: string[] }> {
  const have = new Set(known.map(a => a.id))
  return [...assetUses(c).entries()].filter(([id]) => !have.has(id)).map(([id, uses]) => ({ id, uses: [...new Set(uses)] }))
}
/** Points every use of one asset to another (relinking a missing file): timing, effects and everything else stay as they were. */
export function replaceAsset(c: Composition, from: string, to: string): Composition {
  return {
    ...c,
    clips: c.clips.map(k => ({ ...k, ...(k.visualAssetId === from ? { visualAssetId: to } : {}), ...(k.voiceAssetId === from ? { voiceAssetId: to } : {}) })),
    overlays: c.overlays?.map(o => (o.assetId === from ? { ...o, assetId: to } : o)),
    audioClips: c.audioClips?.map(a => (a.assetId === from ? { ...a, assetId: to } : a)),
    musicAssetId: c.musicAssetId === from ? to : c.musicAssetId,
  }
}


// ---------- Main-clip animation (keyframed framing) ----------
export function setClipKeyframe(c: Composition, id: string, atMs: number, values: Partial<import('./composition').ClipFrame>): Composition {
  const k = c.clips.find(x => x.id === id)
  if (!k) return c
  const at = Math.round(Math.min(Math.max(atMs, 0), k.durationMs))
  const others = (k.keyframes ?? []).filter(x => Math.abs(x.atMs - at) > 20)
  const prev = (k.keyframes ?? []).find(x => Math.abs(x.atMs - at) <= 20)
  return { ...c, clips: c.clips.map(x => (x.id === id ? { ...x, keyframes: [...others, { ...(prev ?? {}), ...values, atMs: at }].sort((a, b) => a.atMs - b.atMs).slice(0, 64) } : x)) }
}
export function setClipKeyframes(c: Composition, id: string, keyframes: import('./composition').ClipKeyframe[] | undefined): Composition {
  return { ...c, clips: c.clips.map(x => (x.id === id ? { ...x, keyframes: keyframes?.length ? [...keyframes].sort((a, b) => a.atMs - b.atMs) : undefined } : x)) }
}
