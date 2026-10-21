/**
 * Edit decision list for a storyboard, stored in render_jobs.composition.
 * One clip per scene; assets are referenced by id so the same composition can be
 * rendered in the browser now or sent to a server render worker later.
 */

export type OutputFormat = '16:9' | '9:16' | '1:1'

/** fade = through black; cut = none; dissolve/slide/wipe/zoom blend into the next clip during the last fadeMs of this one. */
export type Transition = 'fade' | 'cut' | 'dissolve' | 'slide' | 'wipe' | 'zoom'
export const TRANSITIONS: Record<Transition, string> = { fade: 'Fundido a negro', dissolve: 'Disolvencia', slide: 'Deslizar', wipe: 'Cortinilla', zoom: 'Zoom', cut: 'Corte' }
export type TextAnimation = 'none' | 'fade' | 'pop' | 'slide' | 'typewriter'
export const TEXT_ANIMATIONS: Record<TextAnimation, string> = { none: 'Sin animación', fade: 'Aparecer', pop: 'Rebote', slide: 'Subir', typewriter: 'Máquina de escribir' }
/** How subtitles are drawn: classic box, big bold outlined text, or bold with the spoken word highlighted (Shorts style). */
export type CaptionStyle = 'box' | 'bold' | 'karaoke'
export const CAPTION_STYLES: Record<CaptionStyle, string> = { box: 'Clásico (caja)', bold: 'Grande y en negrita', karaoke: 'Palabra a palabra (resaltada)' }
export type TextFont = 'sans' | 'serif' | 'condensed' | 'mono'
export const TEXT_FONTS: Record<TextFont, { label: string; css: string }> = {
  sans: { label: 'Sans (moderna)', css: 'system-ui, -apple-system, Segoe UI, sans-serif' },
  serif: { label: 'Serif (clásica)', css: 'Georgia, "Times New Roman", serif' },
  condensed: { label: 'Condensada (impacto)', css: 'Impact, "Arial Narrow", "Roboto Condensed", sans-serif' },
  mono: { label: 'Monoespaciada', css: 'ui-monospace, Menlo, Consolas, monospace' },
}
export type TextOverlay = { content: string; position: 'top' | 'center' | 'bottom'; sizePct: number; animation?: TextAnimation; font?: TextFont; /** #rrggbb */ color?: string }
/** A title or text on its own track, independent of the clips: it has its own start and duration on the timeline. */
export type TextClip = TextOverlay & { id: string; startMs: number; durationMs: number }

/** Camera movement over the clip (images and videos). amount = how far it moves (0.02–0.5 of the frame). */
export type CameraKind = 'none' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down'
export const CAMERA_MOVES: Record<CameraKind, string> = { none: 'Fija', zoom_in: 'Acercar', zoom_out: 'Alejar', pan_left: 'Panorámica a la izquierda', pan_right: 'Panorámica a la derecha', pan_up: 'Subir', pan_down: 'Bajar' }
export type CameraMove = { kind: CameraKind; amount: number }

export type ExportSettings = { quality: 'normal' | 'high' }
/** Which style built this montage and the automatic result it started from (to compare with the owner's corrections). */
export type StyleRef = { profileId: string; profileName: string; version: number; appliedAt: string; baseline: Composition | null }

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
  /** Timed captions relative to the clip start (e.g. from a transcript). When present they replace the evenly spread narration. */
  cues?: Array<{ startMs: number; endMs: number; text: string }>
  /** Playback speed of a video clip (0.25–4). The clip consumes durationMs × speed of its source. */
  speed?: number
  /** Camera movement. When absent, the legacy `motion` applies (kenburns = slow zoom in on images). */
  camera?: CameraMove | null
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
  /** Set when the clip was placed by «efectos en los cortes», so those (and only those) can be removed or replaced in one go. */
  origin?: 'cut-sfx'
  /** Volume automation: fade in/out (ms) and points (time from the clip start, gain multiplier 0–2), joined linearly. */
  fadeInMs?: number
  fadeOutMs?: number
  envelope?: EnvelopePoint[]
}
export type EnvelopePoint = { atMs: number; gain: number }

/** Independent level of each kind of sound in the final mix. Solo on any track silences the tracks without solo. */
export type TrackKind = 'video' | 'voice' | 'music' | 'sfx'
export type TrackState = { gain: number; muted: boolean; solo: boolean }
export const TRACK_LABELS: Record<TrackKind, string> = { video: 'Audio de los vídeos', voice: 'Voz', music: 'Música', sfx: 'Efectos' }
const FLAT: TrackState = { gain: 1, muted: false, solo: false }

/** Effective gain of each track (mute and solo applied). */
export function trackGains(mix: Partial<Record<TrackKind, TrackState>> | undefined): Record<TrackKind, number> {
  const kinds: TrackKind[] = ['video', 'voice', 'music', 'sfx']
  const st = (k: TrackKind) => mix?.[k] ?? FLAT
  const solo = kinds.some(k => st(k).solo)
  return Object.fromEntries(kinds.map(k => [k, st(k).muted || (solo && !st(k).solo) ? 0 : st(k).gain])) as Record<TrackKind, number>
}

/** Gain multiplier of an audio clip at `ms` from its start: envelope points (linear between them, flat at the ends) × fade in × fade out. */
export function envelopeAt(a: Pick<AudioClip, 'durationMs' | 'fadeInMs' | 'fadeOutMs' | 'envelope'>, ms: number): number {
  const pts = a.envelope ?? []
  let g = 1
  if (pts.length) {
    if (ms <= pts[0].atMs) g = pts[0].gain
    else if (ms >= pts[pts.length - 1].atMs) g = pts[pts.length - 1].gain
    else { const i = pts.findIndex(p => p.atMs > ms); const p0 = pts[i - 1], p1 = pts[i]; g = p0.gain + (p1.gain - p0.gain) * (ms - p0.atMs) / Math.max(1, p1.atMs - p0.atMs) }
  }
  const fi = a.fadeInMs ?? 0, fo = a.fadeOutMs ?? 0
  if (fi > 0 && ms < fi) g *= Math.max(0, ms / fi)
  if (fo > 0 && ms > a.durationMs - fo) g *= Math.max(0, (a.durationMs - ms) / fo)
  return g
}

/** The automation as a list of (time, multiplier) breakpoints to schedule (envelope points plus fade corners), inside the clip. */
export function envelopeBreakpoints(a: Pick<AudioClip, 'durationMs' | 'fadeInMs' | 'fadeOutMs' | 'envelope'>): EnvelopePoint[] {
  const times = new Set<number>([0, a.durationMs])
  for (const p of a.envelope ?? []) if (p.atMs > 0 && p.atMs < a.durationMs) times.add(p.atMs)
  if ((a.fadeInMs ?? 0) > 0) times.add(Math.min(a.fadeInMs!, a.durationMs))
  if ((a.fadeOutMs ?? 0) > 0) times.add(Math.max(0, a.durationMs - a.fadeOutMs!))
  return [...times].sort((x, y) => x - y).map(t => ({ atMs: t, gain: envelopeAt(a, t) }))
}

/** What the automatic edit looked like when the montage was first opened by hand: just the numbers needed to compare it with the manual result later. */
export type AutoSnapshot = {
  takenAt: string
  clips: Array<{ durationMs: number; transition: Transition; hasText: boolean; muted: boolean }>
  sfx: number
  musicVolume: number
  subtitles: boolean
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
  /** Subtitle look. Default «box». */
  captionStyle?: CaptionStyle
  fadeMs: number
  /** Large on-screen text for the opening seconds (Shorts hook). */
  hookText?: string | null
  hookMs?: number
  /** Set when the composition was derived from another one (e.g. a Short). */
  origin?: { kind: 'repurpose'; sourceJobId: string } | null
  /** True once opened in the manual editor: the automatic editor no longer re-syncs it with the storyboard. */
  editedManually?: boolean
  /** The automatic version this montage came from (taken once, when it first became manual). */
  autoSnapshot?: AutoSnapshot | null
  /** Titles and texts on their own track. */
  textClips?: TextClip[]
  exportSettings?: ExportSettings
  styleRef?: StyleRef | null
  /** Level, mute and solo of each kind of sound. */
  mix?: Partial<Record<TrackKind, TrackState>>
}

export type SceneLike = { id: string; position: number; duration_ms: number; narration: string | null }

export const formatSize: Record<OutputFormat, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
}

export const MIN_CLIP_MS = 1000
export const MAX_CLIP_MS = 120000
/** Longest position on the timeline the editor stores (4 h): long-form edits of 90 min or more fit with room to spare. */
export const MAX_TIMELINE_MS = 4 * 3600_000

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

const HEX = /^#[0-9a-f]{6}$/i
function parseText(t: unknown): TextOverlay | null {
  if (!t || typeof t !== 'object') return null
  const v = t as Partial<TextOverlay>
  const content = typeof v.content === 'string' ? v.content.trim().slice(0, 200) : ''
  if (!content) return null
  return {
    content, position: v.position === 'top' || v.position === 'center' ? v.position : 'bottom', sizePct: clamp(v.sizePct, 2, 15, 6),
    animation: typeof v.animation === 'string' && v.animation in TEXT_ANIMATIONS ? v.animation : 'none',
    font: typeof v.font === 'string' && v.font in TEXT_FONTS ? v.font : 'sans',
    color: typeof v.color === 'string' && HEX.test(v.color) ? v.color.toLowerCase() : '#ffffff',
  }
}

function parseTextClip(t: unknown): TextClip | null {
  const base = parseText(t)
  const v = (t ?? {}) as Partial<TextClip>
  if (!base || typeof v.id !== 'string' || !v.id) return null
  return { ...base, id: v.id.slice(0, 60), startMs: Math.round(clamp(v.startMs, 0, 3 * 3600_000, 0)), durationMs: Math.round(clamp(v.durationMs, 300, MAX_CLIP_MS, 3000)) }
}

export function parseCamera(c: unknown): CameraMove | null {
  if (!c || typeof c !== 'object') return null
  const v = c as Partial<CameraMove>
  if (typeof v.kind !== 'string' || !(v.kind in CAMERA_MOVES)) return null
  return { kind: v.kind, amount: clamp(v.amount, 0.02, 0.5, 0.12) }
}

function parseAudioClip(a: unknown): AudioClip | null {
  if (!a || typeof a !== 'object') return null
  const v = a as Partial<AudioClip>
  const assetId = idOf(v.assetId)
  if (!assetId || typeof v.id !== 'string') return null
  return {
    id: v.id, assetId, kind: v.kind === 'music' || v.kind === 'sfx' ? v.kind : 'voice',
    linkedClipId: idOf(v.linkedClipId), offsetMs: clamp(v.offsetMs, 0, MAX_CLIP_MS, 0), startMs: clamp(v.startMs, 0, MAX_TIMELINE_MS, 0),
    trimInMs: clamp(v.trimInMs, 0, MAX_TIMELINE_MS, 0), durationMs: clamp(v.durationMs, 100, MAX_TIMELINE_MS, 5000),
    volume: clamp(v.volume, 0, 2, 1), muted: v.muted === true,
    ...(v.origin === 'cut-sfx' ? { origin: 'cut-sfx' as const } : {}),
    ...(Number(v.fadeInMs) > 0 ? { fadeInMs: clamp(v.fadeInMs, 0, 60_000, 0) } : {}),
    ...(Number(v.fadeOutMs) > 0 ? { fadeOutMs: clamp(v.fadeOutMs, 0, 60_000, 0) } : {}),
    ...(Array.isArray(v.envelope) && v.envelope.length ? { envelope: v.envelope.flatMap(p => { const at = Number(p?.atMs), g = Number(p?.gain); return Number.isFinite(at) && Number.isFinite(g) && at >= 0 ? [{ atMs: Math.round(at), gain: Math.min(2, Math.max(0, g)) }] : [] }).sort((x, y) => x.atMs - y.atMs).slice(0, 64) } : {}),
  }
}

/** Parses whatever is stored in jsonb into a valid composition, or null. Older compositions get defaults. */
export function parseComposition(value: unknown, depth = 0): Composition | null {
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
      transition: typeof c.transition === 'string' && c.transition in TRANSITIONS ? c.transition : 'fade',
      text: parseText(c.text),
      speed: clamp(c.speed, 0.25, 4, 1),
      camera: parseCamera(c.camera),
      ...(Array.isArray(c.cues) ? { cues: parseCues(c.cues, clampMs(Number(c.durationMs) || 5000)) } : {}),
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
    captionStyle: v.captionStyle === 'bold' || v.captionStyle === 'karaoke' ? v.captionStyle : 'box',
    fadeMs: clamp(v.fadeMs ?? 300, 0, 1500, 300),
    hookText: typeof v.hookText === 'string' && v.hookText.trim() ? v.hookText.trim().slice(0, 120) : null,
    hookMs: clamp(v.hookMs ?? 3000, 1000, 8000, 3000),
    origin: v.origin && v.origin.kind === 'repurpose' && typeof v.origin.sourceJobId === 'string' ? v.origin : null,
    editedManually: v.editedManually === true,
    autoSnapshot: parseSnapshot(v.autoSnapshot),
    textClips: (Array.isArray(v.textClips) ? v.textClips : []).flatMap(t => { const p = parseTextClip(t); return p ? [p] : [] }).slice(0, 300),
    exportSettings: { quality: v.exportSettings?.quality === 'high' ? 'high' : 'normal' },
    styleRef: parseStyleRef(v.styleRef, depth),
    mix: parseMix(v.mix),
  }
}

function parseMix(m: unknown): Partial<Record<TrackKind, TrackState>> | undefined {
  if (!m || typeof m !== 'object') return undefined
  const out: Partial<Record<TrackKind, TrackState>> = {}
  for (const k of ['video', 'voice', 'music', 'sfx'] as const) {
    const t = (m as Record<string, Partial<TrackState> | undefined>)[k]
    if (t && typeof t === 'object') out[k] = { gain: clamp(t.gain, 0, 2, 1), muted: t.muted === true, solo: t.solo === true }
  }
  return out
}

function parseStyleRef(r: unknown, depth: number): StyleRef | null {
  if (!r || typeof r !== 'object') return null
  const v = r as Partial<StyleRef>
  if (typeof v.profileId !== 'string' || typeof v.profileName !== 'string') return null
  return {
    profileId: v.profileId.slice(0, 60), profileName: v.profileName.slice(0, 80), version: Math.max(1, Math.round(Number(v.version) || 1)),
    appliedAt: typeof v.appliedAt === 'string' ? v.appliedAt : new Date(0).toISOString(),
    // The baseline is the automatic result as built (one level deep: a baseline never carries its own baseline).
    baseline: depth === 0 && v.baseline ? parseComposition(v.baseline, 1) : null,
  }
}

function parseSnapshot(raw: unknown): AutoSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<AutoSnapshot>
  if (!Array.isArray(v.clips) || v.clips.length === 0 || v.clips.length > 5000) return null
  const clips = v.clips.flatMap(k => { const d = Number((k as { durationMs?: unknown })?.durationMs); return Number.isFinite(d) && d > 0 ? [{ durationMs: Math.round(d), transition: (k as { transition?: unknown }).transition === 'cut' ? 'cut' as const : 'fade' as const, hasText: (k as { hasText?: unknown }).hasText === true, muted: (k as { muted?: unknown }).muted === true }] : [] })
  if (!clips.length) return null
  return { takenAt: typeof v.takenAt === 'string' ? v.takenAt : '', clips, sfx: clamp(v.sfx, 0, 10000, 0), musicVolume: clamp(v.musicVolume, 0, 1, 0.25), subtitles: v.subtitles !== false }
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
/** Valid, ordered cues inside [0, durationMs]; at most 400 per clip. */
function parseCues(raw: unknown[], durationMs: number) {
  return raw.flatMap(q => {
    const c = q as { startMs?: unknown; endMs?: unknown; text?: unknown }
    const start = Math.max(0, Math.round(Number(c.startMs))), end = Math.min(durationMs, Math.round(Number(c.endMs)))
    return typeof c.text === 'string' && c.text.trim() && Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ startMs: start, endMs: end, text: c.text.trim().slice(0, 300) }] : []
  }).sort((a, b) => a.startMs - b.startMs).slice(0, 400)
}

/** Captions of one clip: its timed cues when it has them, otherwise the narration spread over the clip. */
export function clipCaptions(clip: Pick<Clip, 'narration' | 'durationMs' | 'cues'>) {
  return clip.cues?.length ? clip.cues.map(c => ({ text: c.text, startMs: c.startMs, endMs: Math.min(c.endMs, clip.durationMs) })) : captionChunks(clip.narration ?? null, clip.durationMs)
}

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

// ---------- Subtitle export (SRT / VTT) ----------
export type CaptionCue = { startMs: number; endMs: number; text: string }

/** The same caption cues the renderer burns into the video (same chunking and timing), on the montage's own timeline. */
export function compositionCues(c: Pick<Composition, 'clips'> & { subtitles?: boolean }): CaptionCue[] {
  const starts = clipStarts(c)
  return c.clips.flatMap((clip, i) => clipCaptions(clip).map(ch => ({ startMs: Math.round(starts[i] + ch.startMs), endMs: Math.round(starts[i] + ch.endMs), text: ch.text })))
}

const two = (n: number) => String(Math.floor(n)).padStart(2, '0')
function stampMs(ms: number, sep: ',' | '.') {
  const t = Math.max(0, Math.round(ms))
  return `${two(t / 3_600_000)}:${two((t % 3_600_000) / 60_000)}:${two((t % 60_000) / 1000)}${sep}${String(t % 1000).padStart(3, '0')}`
}
export const cuesToSrt = (cues: CaptionCue[]) => cues.map((q, i) => `${i + 1}\n${stampMs(q.startMs, ',')} --> ${stampMs(q.endMs, ',')}\n${q.text}\n`).join('\n')
export const cuesToVtt = (cues: CaptionCue[]) => `WEBVTT\n\n${cues.map(q => `${stampMs(q.startMs, '.')} --> ${stampMs(q.endMs, '.')}\n${q.text}\n`).join('\n')}`

/** Preferred video bitrate for the export quality (still capped by videoBitrateFor's size budget). */
export const preferredBitrate = (q: ExportSettings['quality'] | undefined) => (q === 'high' ? 5_000_000 : 2_500_000)

/** Text clips visible at `ms` on the timeline. */
export function activeTextClips(c: Pick<Composition, 'textClips'>, ms: number) {
  return (c.textClips ?? []).filter(t => ms >= t.startMs && ms < t.startMs + t.durationMs)
}
