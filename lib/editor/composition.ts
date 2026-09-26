/**
 * Edit decision list for a storyboard, stored in render_jobs.composition.
 * One clip per scene; assets are referenced by id so the same composition can be
 * rendered in the browser now or sent to a server render worker later.
 */

export type OutputFormat = '16:9' | '9:16' | '1:1'

export type Clip = {
  sceneId: string
  position: number
  narration: string | null
  visualAssetId: string | null
  voiceAssetId: string | null
  durationMs: number
  motion: 'kenburns' | 'none'
  /** Horizontal focus 0..1 used when the visual is cropped to a narrower frame (reframing). */
  focusX?: number
}

export type Composition = {
  version: 1
  storyboardId: string
  title: string
  format: OutputFormat
  clips: Clip[]
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

/** Parses whatever is stored in jsonb into a valid composition, or null. */
export function parseComposition(value: unknown): Composition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Partial<Composition>
  if (typeof v.storyboardId !== 'string' || !Array.isArray(v.clips)) return null
  const format: OutputFormat = v.format === '9:16' || v.format === '1:1' ? v.format : '16:9'
  const id = (x: unknown) => (typeof x === 'string' && x ? x : null)
  return {
    version: 1,
    storyboardId: v.storyboardId,
    title: typeof v.title === 'string' ? v.title : '',
    format,
    clips: v.clips.flatMap(c => (c && typeof c.sceneId === 'string' ? [{
      sceneId: c.sceneId,
      position: Number(c.position) || 0,
      narration: typeof c.narration === 'string' ? c.narration : null,
      visualAssetId: id(c.visualAssetId),
      voiceAssetId: id(c.voiceAssetId),
      durationMs: clampMs(Number(c.durationMs) || 5000),
      motion: c.motion === 'none' ? 'none' : 'kenburns',
      focusX: typeof c.focusX === 'number' ? Math.min(Math.max(c.focusX, 0), 1) : 0.5,
    } satisfies Clip] : [])),
    musicAssetId: id(v.musicAssetId),
    musicVolume: Math.min(Math.max(Number(v.musicVolume ?? 0.25), 0), 1),
    duckMusic: v.duckMusic !== false,
    subtitles: v.subtitles !== false,
    fadeMs: Math.min(Math.max(Number(v.fadeMs ?? 300), 0), 1500),
    hookText: typeof v.hookText === 'string' && v.hookText.trim() ? v.hookText.trim().slice(0, 120) : null,
    hookMs: Math.min(Math.max(Number(v.hookMs ?? 3000), 1000), 8000),
    origin: v.origin && v.origin.kind === 'repurpose' && typeof v.origin.sourceJobId === 'string' ? v.origin : null,
  }
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
  c.clips.forEach((clip, i) => {
    if (!clip.visualAssetId) issues.push({ sceneId: clip.sceneId, message: `Escena ${i + 1}: sin imagen ni vídeo (se renderizará en negro).`, blocking: false })
    if (!clip.voiceAssetId && clip.narration?.trim()) issues.push({ sceneId: clip.sceneId, message: `Escena ${i + 1}: tiene narración pero no voz asignada.`, blocking: false })
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
