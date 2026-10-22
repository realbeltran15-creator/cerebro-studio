/**
 * Edit decision list for a storyboard, stored in render_jobs.composition.
 * One clip per scene; assets are referenced by id so the same composition can be
 * rendered in the browser now or sent to a server render worker later.
 */

export type OutputFormat = '16:9' | '9:16' | '1:1' | 'custom'

/** fade = through black; cut = none; dissolve/slide/wipe/zoom blend into the next clip during the last fadeMs of this one. */
export type Transition = 'fade' | 'cut' | 'dissolve' | 'slide' | 'wipe' | 'zoom' | 'blur' | 'slide_up' | 'wipe_down'
export const TRANSITIONS: Record<Transition, string> = { fade: 'Fundido a negro', dissolve: 'Disolvencia', slide: 'Deslizar', slide_up: 'Deslizar hacia arriba', wipe: 'Cortinilla', wipe_down: 'Cortinilla vertical', zoom: 'Zoom', blur: 'Desenfoque', cut: 'Corte' }
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
export type TextOverlay = {
  content: string; position: 'top' | 'center' | 'bottom'; sizePct: number; animation?: TextAnimation; font?: TextFont; /** #rrggbb */ color?: string
  /** Free position of the text's centre (fractions of the frame); overrides `position` when set (dragged on the viewer). */
  x?: number; y?: number
  /** Exit animation (the entry one is `animation`). */
  outAnimation?: TextAnimation
  /** Outline colour (#rrggbb) and width (% of the font size, 0 = none). */
  outline?: string; outlineWidth?: number
  shadow?: boolean
  /** Box behind the text (#rrggbb), null = none; opacity 0..1. */
  background?: string | null; backgroundOpacity?: number
  bold?: boolean
}
/** A title or text on its own track, independent of the clips: it has its own start and duration on the timeline. */
export type TextClip = TextOverlay & { id: string; startMs: number; durationMs: number; trackId?: string; groupId?: string }

/** Camera movement over the clip (images and videos). amount = how far it moves (0.02–0.5 of the frame). */
export type CameraKind = 'none' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down'
export const CAMERA_MOVES: Record<CameraKind, string> = { none: 'Fija', zoom_in: 'Acercar', zoom_out: 'Alejar', pan_left: 'Panorámica a la izquierda', pan_right: 'Panorámica a la derecha', pan_up: 'Subir', pan_down: 'Bajar' }
export type CameraMove = { kind: CameraKind; amount: number }

export type ExportResolution = '480' | '720' | '1080' | '1440' | '2160'
export type ExportSettings = {
  quality: 'normal' | 'high'
  /** Short side of the frame. Absent = the editor's classic sizes (formatSize). */
  resolution?: ExportResolution
  /** Exact video bitrate in kbit/s (overrides quality). */
  videoKbps?: number | null
  /** library = uploaded to the Biblioteca (50 MB limit, bitrate reduced to fit); download = saved to the computer only (no limit). */
  destination?: 'library' | 'download'
  /** fast = frame by frame with WebCodecs (faster than real time when the browser can); realtime = played and recorded. */
  mode?: 'fast' | 'realtime'
}
/** Which style built this montage and the automatic result it started from (to compare with the owner's corrections). */
export type StyleRef = { profileId: string; profileName: string; version: number; appliedAt: string; baseline: Composition | null }

export type Filters = { brightness: number; contrast: number; saturation: number; blur: number }
export const NO_FILTERS: Filters = { brightness: 1, contrast: 1, saturation: 1, blur: 0 }
export const FILTER_PRESETS: Record<string, { label: string; f: Filters }> = {
  none: { label: 'Original', f: NO_FILTERS },
  vivid: { label: 'Vivo', f: { brightness: 1.05, contrast: 1.15, saturation: 1.35, blur: 0 } },
  warm: { label: 'Cálido suave', f: { brightness: 1.08, contrast: 1.05, saturation: 1.15, blur: 0 } },
  mono: { label: 'Blanco y negro', f: { brightness: 1, contrast: 1.15, saturation: 0, blur: 0 } },
  faded: { label: 'Desvaído', f: { brightness: 1.1, contrast: 0.85, saturation: 0.75, blur: 0 } },
  dramatic: { label: 'Dramático', f: { brightness: 0.92, contrast: 1.35, saturation: 0.9, blur: 0 } },
  dream: { label: 'Sueño', f: { brightness: 1.1, contrast: 0.95, saturation: 1.1, blur: 0.4 } },
}
export type Crop = { left: number; top: number; right: number; bottom: number }
/** Position of an overlay: centre (fractions of the frame), width as a fraction of the frame width, rotation in degrees, opacity 0..1. */
export type Transform = { x: number; y: number; scale: number; rotation: number; opacity: number }
export const DEFAULT_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 0.4, rotation: 0, opacity: 1 }
/** A keyframe (clip-relative time) with the properties it fixes; between keyframes values are interpolated with ease-in-out. */
export type Keyframe = { atMs: number } & Partial<Transform>
/** A picture or video above the main track (picture-in-picture, logos, stickers, a second camera). */
export type OverlayClip = {
  id: string; trackId: string; assetId: string
  startMs: number; durationMs: number
  /** Where it starts in the source (video), ms. */
  trimInMs: number
  speed?: number; volume?: number; muted?: boolean
  transform: Transform
  keyframes?: Keyframe[]
  crop?: Crop | null
  filters?: Filters | null
  /** Ken Burns style movement inside its box. */
  camera?: CameraMove | null
  fadeInMs?: number; fadeOutMs?: number
  groupId?: string
}
export type TrackType = 'main' | 'overlay' | 'text' | 'voice' | 'music' | 'sfx'
/** A track of the timeline. Order of `tracks` = order on screen (top to bottom); overlay tracks higher up are drawn on top. */
export type TrackMeta = { id: string; type: TrackType; name: string; locked?: boolean; hidden?: boolean; muted?: boolean; solo?: boolean }
export type Marker = { id: string; atMs: number; label: string; color?: string }

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
  /** Picture adjustments (brightness/contrast/saturation 1 = unchanged; blur in % of the frame height). */
  filters?: Filters | null
  /** Part of the source removed at each edge (fractions). */
  crop?: Crop | null
  /** Rotation in degrees and opacity 0..1 of the picture. */
  rotation?: number
  opacity?: number
  /** Transition length into the next clip (ms); absent = the montage's fadeMs. */
  transitionMs?: number
  groupId?: string
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
  /** Stereo position -1 (left) … 1 (right). */
  pan?: number
  /** Custom audio track; absent = the default track of its kind. */
  trackId?: string
  groupId?: string
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
  /** Layers above the main track. */
  overlays?: OverlayClip[]
  /** Tracks (names, order, lock, hide, mute, solo). Missing = the default set. */
  tracks?: TrackMeta[]
  markers?: Marker[]
  /** Frame size when format = 'custom' (even numbers, 240–3840). */
  customSize?: { width: number; height: number }
}

export type SceneLike = { id: string; position: number; duration_ms: number; narration: string | null }

export const formatSize: Record<OutputFormat, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
  custom: { width: 1280, height: 720 },
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
    ...(v.x !== undefined && v.y !== undefined && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y)) ? { x: clamp(v.x, 0, 1, 0.5), y: clamp(v.y, 0, 1, 0.5) } : {}),
    ...(typeof v.outAnimation === 'string' && v.outAnimation in TEXT_ANIMATIONS ? { outAnimation: v.outAnimation } : {}),
    ...(typeof v.outline === 'string' && HEX.test(v.outline) ? { outline: v.outline.toLowerCase() } : {}),
    ...(v.outlineWidth !== undefined ? { outlineWidth: clamp(v.outlineWidth, 0, 40, 10) } : {}),
    ...(v.shadow === true ? { shadow: true } : {}),
    ...(typeof v.background === 'string' && HEX.test(v.background) ? { background: v.background.toLowerCase(), backgroundOpacity: clamp(v.backgroundOpacity, 0, 1, 0.6) } : {}),
    ...(v.bold === false ? { bold: false } : {}),
  }
}

function parseTextClip(t: unknown): TextClip | null {
  const base = parseText(t)
  const v = (t ?? {}) as Partial<TextClip>
  if (!base || typeof v.id !== 'string' || !v.id) return null
  return { ...base, id: v.id.slice(0, 60), startMs: Math.round(clamp(v.startMs, 0, MAX_TIMELINE_MS, 0)), durationMs: Math.round(clamp(v.durationMs, 300, MAX_TIMELINE_MS, 3000)), ...(typeof v.trackId === 'string' && v.trackId ? { trackId: v.trackId.slice(0, 60) } : {}), ...(typeof v.groupId === 'string' && v.groupId ? { groupId: v.groupId.slice(0, 60) } : {}) }
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
    ...(Number(v.pan) ? { pan: clamp(v.pan, -1, 1, 0) } : {}),
    ...(typeof v.trackId === 'string' && v.trackId ? { trackId: v.trackId.slice(0, 60) } : {}),
    ...(typeof v.groupId === 'string' && v.groupId ? { groupId: v.groupId.slice(0, 60) } : {}),
    ...(Array.isArray(v.envelope) && v.envelope.length ? { envelope: v.envelope.flatMap(p => { const at = Number(p?.atMs), g = Number(p?.gain); return Number.isFinite(at) && Number.isFinite(g) && at >= 0 ? [{ atMs: Math.round(at), gain: Math.min(2, Math.max(0, g)) }] : [] }).sort((x, y) => x.atMs - y.atMs).slice(0, 64) } : {}),
  }
}

/** Parses whatever is stored in jsonb into a valid composition, or null. Older compositions get defaults. */
export function parseComposition(value: unknown, depth = 0): Composition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Partial<Composition>
  if (typeof v.storyboardId !== 'string' || !Array.isArray(v.clips)) return null
  const format: OutputFormat = v.format === '9:16' || v.format === '1:1' || v.format === 'custom' ? v.format : '16:9'
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
      trimInMs: clamp(c.trimInMs, 0, MAX_TIMELINE_MS, 0),
      volume: clamp(c.volume, 0, 2, 1),
      muted: c.muted === true,
      transition: typeof c.transition === 'string' && c.transition in TRANSITIONS ? c.transition : 'fade',
      text: parseText(c.text),
      speed: clamp(c.speed, 0.25, 4, 1),
      camera: parseCamera(c.camera),
      ...(c.filters ? { filters: parseFilters(c.filters) } : {}),
      ...(c.crop ? { crop: parseCrop(c.crop) } : {}),
      ...(Number(c.rotation) ? { rotation: clamp(c.rotation, -360, 360, 0) } : {}),
      ...(c.opacity !== undefined && Number(c.opacity) < 1 ? { opacity: clamp(c.opacity, 0, 1, 1) } : {}),
      ...(c.transitionMs !== undefined && Number.isFinite(Number(c.transitionMs)) ? { transitionMs: clamp(c.transitionMs, 0, 3000, 300) } : {}),
      ...(typeof c.groupId === 'string' && c.groupId ? { groupId: c.groupId.slice(0, 60) } : {}),
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
    exportSettings: parseExport(v.exportSettings),
    styleRef: parseStyleRef(v.styleRef, depth),
    mix: parseMix(v.mix),
    ...parseLayers(v),
  }
}

function parseFilters(f: unknown): Filters | null {
  if (!f || typeof f !== 'object') return null
  const v = f as Partial<Filters>
  const out = { brightness: clamp(v.brightness, 0, 3, 1), contrast: clamp(v.contrast, 0, 3, 1), saturation: clamp(v.saturation, 0, 3, 1), blur: clamp(v.blur, 0, 5, 0) }
  return out.brightness === 1 && out.contrast === 1 && out.saturation === 1 && out.blur === 0 ? null : out
}
function parseCrop(c: unknown): Crop | null {
  if (!c || typeof c !== 'object') return null
  const v = c as Partial<Crop>
  const out = { left: clamp(v.left, 0, 0.9, 0), top: clamp(v.top, 0, 0.9, 0), right: clamp(v.right, 0, 0.9, 0), bottom: clamp(v.bottom, 0, 0.9, 0) }
  if (out.left + out.right > 0.95) out.right = Math.max(0, 0.95 - out.left)
  if (out.top + out.bottom > 0.95) out.bottom = Math.max(0, 0.95 - out.top)
  return out.left || out.top || out.right || out.bottom ? out : null
}
function parseTransform(t: unknown): Transform {
  const v = (t && typeof t === 'object' ? t : {}) as Partial<Transform>
  return { x: clamp(v.x, -1, 2, 0.5), y: clamp(v.y, -1, 2, 0.5), scale: clamp(v.scale, 0.02, 4, 0.4), rotation: clamp(v.rotation, -720, 720, 0), opacity: clamp(v.opacity, 0, 1, 1) }
}
function parseKeyframes(k: unknown, durationMs: number): Keyframe[] | undefined {
  if (!Array.isArray(k) || !k.length) return undefined
  const keys: Array<keyof Transform> = ['x', 'y', 'scale', 'rotation', 'opacity']
  const out = k.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const at = Number((raw as Keyframe).atMs)
    if (!Number.isFinite(at)) return []
    const kf: Keyframe = { atMs: Math.round(Math.min(Math.max(at, 0), durationMs)) }
    const full = parseTransform(raw)
    for (const key of keys) if ((raw as Keyframe)[key] !== undefined) kf[key] = full[key]
    return [kf]
  }).sort((a, b) => a.atMs - b.atMs).slice(0, 64)
  return out.length ? out : undefined
}
const TRACK_TYPES: TrackType[] = ['main', 'overlay', 'text', 'voice', 'music', 'sfx']
function parseLayers(v: Partial<Composition>): Pick<Composition, 'overlays' | 'tracks' | 'markers' | 'customSize'> {
  const out: Pick<Composition, 'overlays' | 'tracks' | 'markers' | 'customSize'> = {}
  if (Array.isArray(v.tracks)) {
    const seen = new Set<string>()
    const tracks = v.tracks.flatMap(t => {
      if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id || seen.has(t.id) || !TRACK_TYPES.includes(t.type)) return []
      seen.add(t.id)
      return [{ id: t.id.slice(0, 60), type: t.type, name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 40) : t.id, ...(t.locked === true ? { locked: true } : {}), ...(t.hidden === true ? { hidden: true } : {}), ...(t.muted === true ? { muted: true } : {}), ...(t.solo === true ? { solo: true } : {}) }]
    }).slice(0, 40)
    if (tracks.length) out.tracks = tracks
  }
  if (Array.isArray(v.overlays)) {
    const overlays = v.overlays.flatMap(o => {
      if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !idOf(o.assetId) || typeof o.trackId !== 'string') return []
      const durationMs = Math.round(clamp(o.durationMs, 100, MAX_TIMELINE_MS, 5000))
      const kf = parseKeyframes(o.keyframes, durationMs)
      return [{
        id: o.id.slice(0, 60), trackId: o.trackId.slice(0, 60), assetId: o.assetId as string,
        startMs: Math.round(clamp(o.startMs, 0, MAX_TIMELINE_MS, 0)), durationMs, trimInMs: Math.round(clamp(o.trimInMs, 0, MAX_TIMELINE_MS, 0)),
        ...(o.speed !== undefined ? { speed: clamp(o.speed, 0.25, 4, 1) } : {}),
        ...(o.volume !== undefined ? { volume: clamp(o.volume, 0, 2, 1) } : {}),
        ...(o.muted === true ? { muted: true } : {}),
        transform: parseTransform(o.transform),
        ...(kf ? { keyframes: kf } : {}),
        ...(o.crop ? { crop: parseCrop(o.crop) } : {}),
        ...(o.filters ? { filters: parseFilters(o.filters) } : {}),
        ...(o.camera ? { camera: parseCamera(o.camera) } : {}),
        ...(Number(o.fadeInMs) > 0 ? { fadeInMs: clamp(o.fadeInMs, 0, 10_000, 0) } : {}),
        ...(Number(o.fadeOutMs) > 0 ? { fadeOutMs: clamp(o.fadeOutMs, 0, 10_000, 0) } : {}),
        ...(typeof o.groupId === 'string' && o.groupId ? { groupId: o.groupId.slice(0, 60) } : {}),
      } satisfies OverlayClip]
    }).slice(0, 2000)
    if (overlays.length) out.overlays = overlays
  }
  if (Array.isArray(v.markers)) {
    const markers = v.markers.flatMap(m => (m && typeof m === 'object' && typeof m.id === 'string' && Number.isFinite(Number(m.atMs)) ? [{ id: m.id.slice(0, 60), atMs: Math.round(clamp(m.atMs, 0, MAX_TIMELINE_MS, 0)), label: typeof m.label === 'string' ? m.label.slice(0, 60) : '', ...(typeof m.color === 'string' && HEX.test(m.color) ? { color: m.color } : {}) }] : [])).sort((a, b) => a.atMs - b.atMs).slice(0, 500)
    if (markers.length) out.markers = markers
  }
  if (v.customSize && typeof v.customSize === 'object') {
    const even = (n: unknown) => Math.round(clamp(n, 240, 3840, 1280) / 2) * 2
    out.customSize = { width: even(v.customSize.width), height: even(v.customSize.height) }
  }
  return out
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

/**
 * Length of the whole project: the end of whatever finishes last (main track, overlays, texts, voices, effects and music clips).
 * The global background music loops, so it never lengthens the project.
 */
export function projectDurationMs(c: Pick<Composition, 'clips'> & Partial<Pick<Composition, 'overlays' | 'textClips' | 'audioClips'>>) {
  let end = totalDurationMs(c)
  for (const o of c.overlays ?? []) end = Math.max(end, o.startMs + o.durationMs)
  for (const t of c.textClips ?? []) end = Math.max(end, t.startMs + t.durationMs)
  for (const a of c.audioClips ?? []) end = Math.max(end, audioStartMs(c, a) + a.durationMs)
  return Math.min(end, MAX_TIMELINE_MS)
}

/** Length of the main (picture) track: its clips one after another. */
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
  const total = totalDurationMs(c)
  if (total > MAX_TIMELINE_MS) issues.push({ message: 'El montaje supera 4 horas: divídelo en partes.', blocking: true })
  else if (total > 20 * 60 * 1000) issues.push({ message: `Montaje largo (${Math.round(total / 60000)} min): la exportación en el navegador va en tiempo real (tarda lo mismo que dura) y necesita la pestaña abierta y visible; usa «Descargar a mi equipo», porque la Biblioteca solo admite archivos de hasta 50 MB.`, blocking: false })
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

function parseExport(e: Partial<ExportSettings> | undefined): ExportSettings {
  const out: ExportSettings = { quality: e?.quality === 'high' ? 'high' : 'normal' }
  if (e?.resolution === '480' || e?.resolution === '720' || e?.resolution === '1080' || e?.resolution === '1440' || e?.resolution === '2160') out.resolution = e.resolution
  const k = Number(e?.videoKbps)
  if (Number.isFinite(k) && k >= 200 && k <= 40000) out.videoKbps = Math.round(k)
  if (e?.destination === 'download') out.destination = 'download'
  if (e?.mode === 'realtime') out.mode = 'realtime'
  return out
}

export const LIBRARY_MAX_BYTES = 50 * 1024 * 1024
const BITRATES: Record<ExportResolution, { normal: number; high: number }> = { '480': { normal: 1_200_000, high: 2_000_000 }, '720': { normal: 2_500_000, high: 5_000_000 }, '1080': { normal: 5_000_000, high: 8_000_000 }, '1440': { normal: 9_000_000, high: 14_000_000 }, '2160': { normal: 16_000_000, high: 25_000_000 } }

/** Frame size for a format at a resolution (even numbers, as encoders need). */
export function frameSize(format: OutputFormat, resolution?: ExportResolution, custom?: { width: number; height: number }) {
  if (format === 'custom') {
    const c = custom ?? formatSize.custom
    if (!resolution) return { width: c.width, height: c.height }
    // Same aspect, the short side at the chosen resolution.
    const short = Number(resolution), k = short / Math.min(c.width, c.height)
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
    return { width: even(c.width * k), height: even(c.height * k) }
  }
  if (!resolution) return formatSize[format]
  const short = Number(resolution), long = Math.round(short * 16 / 9 / 2) * 2
  return format === '16:9' ? { width: long, height: short } : format === '9:16' ? { width: short, height: long } : { width: short, height: short }
}

/**
 * What the export will be: frame size, bitrates and the estimated file size. For the Biblioteca the video bitrate is lowered
 * if needed so the file fits in 50 MB (and the plan says so); downloads keep the chosen bitrate.
 */
export function exportPlan(c: Pick<Composition, 'clips' | 'format' | 'exportSettings'> & Partial<Pick<Composition, 'customSize' | 'overlays' | 'textClips' | 'audioClips'>>) {
  const e = c.exportSettings ?? { quality: 'normal' }
  const total = projectDurationMs(c)
  const { width, height } = frameSize(c.format, e.resolution, c.customSize)
  const wanted = e.videoKbps ? e.videoKbps * 1000 : e.resolution ? BITRATES[e.resolution][e.quality] : preferredBitrate(e.quality)
  const audioBps = 128_000
  const destination = e.destination ?? 'library'
  const videoBps = destination === 'library' ? videoBitrateFor(total, LIBRARY_MAX_BYTES, wanted) : wanted
  const estimatedBytes = Math.round((videoBps + audioBps) * Math.max(total, 1) / 8000)
  const reduced = destination === 'library' && videoBps < wanted
  return { width, height, videoBps, audioBps, wantedBps: wanted, destination, estimatedBytes, reduced, durationMs: total, /** Even at the minimum bitrate a long montage may not fit in the Library: then it can only be downloaded. */ fitsLibrary: estimatedBytes <= LIBRARY_MAX_BYTES }
}


// ---------- Tracks ----------
/** The tracks every montage has, even when it was saved before tracks existed. */
export const DEFAULT_TRACKS: TrackMeta[] = [
  { id: 'main', type: 'main', name: 'Vídeo principal' },
  { id: 'text', type: 'text', name: 'Texto' },
  { id: 'voice', type: 'voice', name: 'Voz' },
  { id: 'music', type: 'music', name: 'Música' },
  { id: 'sfx', type: 'sfx', name: 'Efectos' },
]
/** Tracks of a montage: the stored ones plus any default track missing, and a track for every overlay/clip that names an unknown one. */
export function tracksOf(c: Pick<Composition, 'tracks' | 'overlays' | 'audioClips' | 'textClips'>): TrackMeta[] {
  const list = [...(c.tracks ?? [])]
  const has = (id: string) => list.some(t => t.id === id)
  // Once the montage stores its tracks they are authoritative (a deleted default track stays deleted); the main track always exists.
  for (const d of c.tracks ? DEFAULT_TRACKS.filter(x => x.type === 'main') : DEFAULT_TRACKS) if (!has(d.id)) {
    // Default tracks keep their usual place: overlays above the main track, the rest below in this order.
    if (d.type === 'main') { const firstLower = list.findIndex(t => t.type !== 'overlay'); list.splice(firstLower < 0 ? list.length : firstLower, 0, d) } else list.push(d)
  }
  let n = list.filter(t => t.type === 'overlay').length
  for (const o of c.overlays ?? []) if (!has(o.trackId)) list.splice(list.findIndex(t => t.type === 'main'), 0, { id: o.trackId, type: 'overlay', name: `Superposición ${++n}` })
  const defName = (id: string) => DEFAULT_TRACKS.find(d => d.id === id)?.name
  for (const a of c.audioClips ?? []) { const id = a.trackId ?? a.kind; if (!has(id)) list.push({ id, type: a.kind, name: defName(id) ?? `${TRACK_LABELS[a.kind]} ${id.slice(-3)}` }) }
  for (const t of c.textClips ?? []) { const id = t.trackId ?? 'text'; if (!has(id)) { const at = list.map(x => x.type).lastIndexOf('text'); list.splice(at < 0 ? list.findIndex(x => x.type === 'main') + 1 : at + 1, 0, { id, type: 'text', name: defName(id) ?? `Texto ${id.slice(-3)}` }) } }
  return list
}
/** Track an audio or text clip is on. */
export const audioTrackId = (a: Pick<AudioClip, 'trackId' | 'kind'>) => a.trackId ?? a.kind
export const textTrackId = (t: Pick<TextClip, 'trackId'>) => t.trackId ?? 'text'
