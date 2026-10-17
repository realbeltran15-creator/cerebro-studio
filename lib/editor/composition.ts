/**
 * Edit decision list for a storyboard, stored in render_jobs.composition.
 * One clip per scene; assets are referenced by id so the same composition can be
 * rendered in the browser now or sent to a server render worker later.
 */

export type OutputFormat = '16:9' | '9:16' | '1:1'

export type Transition = 'fade' | 'cut'
export type TextOverlay = { content: string; position: 'top' | 'center' | 'bottom'; sizePct: number }

export type Clip = {
  /** Unique within the composition. Automatic edits use the scene id; manual edits may duplicate/split. */
  id: string
  sceneId: string
  position: number
  /** Subtitle text for this clip (the scene narration in automatic edits). */
  narration: string | null
  visualAssetId: string | null
  /** Voice attached to the clip (automatic edits). Manual edits move voices to audio tracks. */
  voiceAssetId: string | null
  durationMs: number
  motion: 'kenburns' | 'none'
  /** Horizontal/vertical focus 0..1 used when the visual is cropped to the frame (reframing/position). */
  focusX?: number
  focusY?: number
  /** Static zoom (1 = cover the frame). */
  zoom?: number
  /** Video only: where playback starts inside the source (trim in). */
  trimInMs?: number
  /** Video only: volume of the clip's own audio (0-2) and mute. */
  volume?: number
  muted?: boolean
  /** How this clip ends into the next one. Default fade (uses composition.fadeMs). */
  transition?: Transition
  text?: TextOverlay | null
}

/** Independent audio on the timeline: voice-over, music or effects. */
export type AudioClip = {
  id: string
  assetId: string
  kind: 'voice' | 'music' | 'sfx'
  /** When linked, the clip starts `offsetMs` after the start of that visual clip and follows it when reordered. */
  linkedClipId: string | null
  offsetMs: number
  /** Absolute start when not linked. */
  startMs: number
  trimInMs: number
  durationMs: number
  volume: number
  muted: boolean
}

export type Composition = {
  version: 1
  storyboardId: string
  title: string
  format: OutputFormat
  clips: Clip[]
  /** Extra audio tracks (manual editor). Voices here duck the music like clip voices. */
  audioClips?: AudioClip[]
  musicAssetId: string | null
  musicVolume: number
  duckMusic: boolean
  subtitles: boolean
  fadeMs: number
  /** Large on-screen text for the opening seconds (Shorts hook). */
  hookText?: string | null
  hookMs?: number
  /** Set when the composition was derived from another one (e.g. a Short). */
  origin?: { kind: 'repurpose'; sourceJobId: string } | null
  /** True once opened in the manual editor: the automatic editor no longer re-syncs it with the storyboard. */
  editedManually?: boolean
}

export type SceneLike = { id: string; position: number; duration_ms: number; narration: string | null }

export const formatSize: Record<OutputFormat, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
}

export const MIN_CLIP_MS = 1000
export const MAX_CLIP_MS = 120000

const clampMs = (ms: number) => Math.min(Math.max(Math.round(ms), MIN_CLIP_MS), MAX_CLIP_MS)

export function emptyComposition(storyboardId: string, title: string, format: OutputFormat = '16:9'): Composition {
  return { version: 1, storyboardId, title, format, clips: [], musicAssetId: null, musicVolume: 0.25, duckMusic: true, subtitles: true, fadeMs: 300, origin: null }
}

/** Keeps saved assignments for scenes that still exist, adds new scenes and follows the storyboard order. */
export function syncWithScenes(saved: Composition, scenes: SceneLike[]): Composition {
  const bySceneId = new Map(saved.clips.map(c => [c.sceneId, c]))
  const clips = [...scenes].sort((a, b) => a.position - b.position).map(scene => {
    const prev = bySceneId.get(scene.id)
    return {
      ...prev,
      id: prev?.id ?? scene.id,
      sceneId: scene.id,
      position: scene.position,
      narration: scene.narration,
      visualAssetId: prev?.visualAssetId ?? null,
      voiceAssetId: prev?.voiceAssetId ?? null,
      durationMs: clampMs(prev?.durationMs ?? scene.duration_ms),
      motion: prev?.motion ?? 'kenburns',
      focusX: prev?.focusX ?? 0.5,
    } satisfies Clip
  })
  return { ...saved, clips }
}

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const x = Number(n)
  return Number.isFinite(x) ? Math.min(Math.max(x, min), max) : fallback
}
const idOf = (x: unknown) => (typeof x === 'string' && x ? x : null)

function parseText(t: unknown): TextOverlay | null {
  if (!t || typeof t !== 'object') return null
  const v = t as Partial<TextOverlay>
  const content = typeof v.content === 'string' ? v.content.trim().slice(0, 200) : ''
  if (!content) return null
  return { content, position: v.position === 'top' || v.position === 'center' ? v.position : 'bottom', sizePct: clamp(v.sizePct, 2, 15, 6) }
}

function parseAudioClip(a: unknown): AudioClip | null {
  if (!a || typeof a !== 'object') return null
  const v = a as Partial<AudioClip>
  const assetId = idOf(v.assetId)
  if (!assetId || typeof v.id !== 'string') return null
  return {
    id: v.id, assetId, kind: v.kind === 'music' || v.kind === 'sfx' ? v.kind : 'voice',
    linkedClipId: idOf(v.linkedClipId), offsetMs: clamp(v.offsetMs, 0, MAX_CLIP_MS, 0), startMs: clamp(v.startMs, 0, 20 * 60_000, 0),
    trimInMs: clamp(v.trimInMs, 0, 60 * 60_000, 0), durationMs: clamp(v.durationMs, 100, 20 * 60_000, 5000),
    volume: clamp(v.volume, 0, 2, 1), muted: v.muted === true,
  }
}

/** Parses whatever is stored in jsonb into a valid composition, or null. Older compositions get defaults. */
export function parseComposition(value: unknown): Composition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Partial<Composition>
  if (typeof v.storyboardId !== 'string' || !Array.isArray(v.clips)) return null
  const format: OutputFormat = v.format === '9:16' || v.format === '1:1' ? v.format : '16:9'
  const seen = new Set<string>()
  const clips = v.clips.flatMap((c: Partial<Clip>) => {
    if (!c || typeof c.sceneId !== 'string') return []
    let id = typeof c.id === 'string' && c.id ? c.id : c.sceneId
    while (seen.has(id)) id = `${id}~`
    seen.add(id)
    return [{
      id,
      sceneId: c.sceneId,
      position: Number(c.position) || 0,
      narration: typeof c.narration === 'string' ? c.narration : null,
      visualAssetId: idOf(c.visualAssetId),
      voiceAssetId: idOf(c.voiceAssetId),
      durationMs: clampMs(Number(c.durationMs) || 5000),
      motion: c.motion === 'none' ? 'none' : 'kenburns',
      focusX: clamp(c.focusX, 0, 1, 0.5),
      focusY: clamp(c.focusY, 0, 1, 0.5),
      zoom: clamp(c.zoom, 1, 3, 1),
      trimInMs: clamp(c.trimInMs, 0, 60 * 60_000, 0),
      volume: clamp(c.volume, 0, 2, 1),
      muted: c.muted === true,
      transition: c.transition === 'cut' ? 'cut' : 'fade',
      text: parseText(c.text),
    } satisfies Clip]
  })
  const clipIds = new Set(clips.map(c => c.id))
  const audioClips = (Array.isArray(v.audioClips) ? v.audioClips : []).flatMap(a => {
    const p = parseAudioClip(a)
    if (!p) return []
    // A link to a clip that no longer exists becomes an absolute position.
    return [p.linkedClipId && !clipIds.has(p.linkedClipId) ? { ...p, linkedClipId: null } : p]
  })
  return {
    version: 1,
    storyboardId: v.storyboardId,
    title: typeof v.title === 'string' ? v.title : '',
    format,
    clips,
    audioClips,
    musicAssetId: idOf(v.musicAssetId),
    musicVolume: clamp(v.musicVolume ?? 0.25, 0, 1, 0.25),
    duckMusic: v.duckMusic !== false,
    subtitles: v.subtitles !== false,
    fadeMs: clamp(v.fadeMs ?? 300, 0, 1500, 300),
    hookText: typeof v.hookText === 'string' && v.hookText.trim() ? v.hookText.trim().slice(0, 120) : null,
    hookMs: clamp(v.hookMs ?? 3000, 1000, 8000, 3000),
    origin: v.origin && v.origin.kind === 'repurpose' && typeof v.origin.sourceJobId === 'string' ? v.origin : null,
    editedManually: v.editedManually === true,
  }
}

/** Absolute start of an audio clip on the timeline (linked clips follow their visual clip). */
export function audioStartMs(c: Pick<Composition, 'clips'>, a: Pick<AudioClip, 'linkedClipId' | 'offsetMs' | 'startMs'>) {
  if (a.linkedClipId) {
    const starts = clipStarts(c)
    const i = c.clips.findIndex(k => k.id === a.linkedClipId)
    if (i >= 0) return starts[i] + a.offsetMs
  }
  return a.startMs
}

export function totalDurationMs(c: Pick<Composition, 'clips'>) {
  return c.clips.reduce((t, clip) => t + clip.durationMs, 0)
}

/** Start offset of every clip on the timeline. */
export function clipStarts(c: Pick<Composition, 'clips'>) {
  let t = 0
  return c.clips.map(clip => { const start = t; t += clip.durationMs; return start })
}

export type CompositionIssue = { sceneId?: string; message: string; blocking: boolean }

export function compositionIssues(c: Composition): CompositionIssue[] {
  const issues: CompositionIssue[] = []
  if (c.clips.length === 0) issues.push({ message: 'El storyboard no tiene escenas.', blocking: true })
  const voicedClips = new Set((c.audioClips ?? []).filter(a => a.kind === 'voice' && a.linkedClipId).map(a => a.linkedClipId))
  const label = c.editedManually ? 'Clip' : 'Escena'
  c.clips.forEach((clip, i) => {
    if (!clip.visualAssetId) issues.push({ sceneId: clip.sceneId, message: `${label} ${i + 1}: sin imagen ni vídeo (se renderizará en negro).`, blocking: false })
    if (!c.editedManually && !clip.voiceAssetId && !voicedClips.has(clip.id) && clip.narration?.trim()) issues.push({ sceneId: clip.sceneId, message: `${label} ${i + 1}: tiene narración pero no voz asignada.`, blocking: false })
  })
  if (totalDurationMs(c) > 20 * 60 * 1000) issues.push({ message: 'El montaje supera 20 minutos: el render en el navegador no está pensado para esa duración.', blocking: true })
  return issues
}

/** Platform length limits for vertical video (checked before rendering a Short). */
export const shortPlatforms = [
  { id: 'youtube_shorts', label: 'YouTube Shorts', maxMs: 180_000 },
  { id: 'instagram_reels', label: 'Instagram Reels', maxMs: 90_000 },
  { id: 'tiktok', label: 'TikTok', maxMs: 600_000 },
] as const

/** Builds a vertical composition from selected clips of an existing one. */
export function toShort(source: Composition, sourceJobId: string, sceneIds: string[], hookText: string | null): Composition {
  const keep = new Set(sceneIds)
  return {
    ...source,
    title: `Short · ${source.title}`.slice(0, 160),
    format: '9:16',
    clips: source.clips.filter(c => keep.has(c.sceneId)).map(c => ({ ...c, focusX: c.focusX ?? 0.5 })),
    subtitles: true,
    hookText: hookText?.trim() || null,
    hookMs: 3000,
    origin: { kind: 'repurpose', sourceJobId },
  }
}

/**
 * Splits narration into caption chunks spread evenly across the clip.
 * Timing is proportional to word count: an approximation, not forced alignment.
 */
export function captionChunks(text: string | null, durationMs: number, maxWords = 10) {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '))
  let offset = 0
  return chunks.map(chunk => {
    const share = (chunk.split(' ').length / words.length) * durationMs
    const item = { text: chunk, startMs: offset, endMs: offset + share }
    offset += share
    return item
  })
}

/** Bitrate that keeps the output under the storage upload limit (with 10% headroom). */
export function videoBitrateFor(durationMs: number, maxBytes = 50 * 1024 * 1024, preferred = 2_500_000) {
  const seconds = Math.max(durationMs / 1000, 1)
  const audio = 128_000
  const budget = (maxBytes * 8 * 0.9) / seconds - audio
  return Math.max(Math.min(preferred, Math.floor(budget)), 250_000)
}
