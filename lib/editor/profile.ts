/**
 * Edit profiles («estilos de edición»): a structured, editable set of editing decisions — NOT a saved video.
 *
 *   extractProfile()  measures the decisions in a montage the owner edited by hand («Guardar como estilo de edición»).
 *   buildFromProfile() builds a new montage from the owner's own materials following those rules («Editar automáticamente con mi estilo»).
 *   applyProfile()    re-styles an existing montage without changing its content.
 *   diffMontages()    compares the automatic result with the owner's corrected version and proposes concrete profile changes,
 *                     which are applied ONLY when the owner accepts them (applyPatches()).
 *
 * Everything is deterministic: measured medians and modes, fixed rules. No model is trained and nothing is guessed.
 */
import {
  MAX_CLIP_MS, MIN_CLIP_MS, emptyComposition, totalDurationMs, clipStarts,
  type AudioClip, type CameraKind, type CaptionStyle, type Clip, type Composition, type ExportSettings, type OutputFormat,
  type TextAnimation, type TextClip, type TextFont, type TextOverlay, type Transition,
  CAMERA_MOVES, TEXT_ANIMATIONS, TEXT_FONTS, TRANSITIONS, CAPTION_STYLES,
} from './composition'
import { planSegments, type Interval } from './auto-edit'
import { effectiveCamera } from './motion'
import type { EditStyle } from './style'

export type EditProfile = {
  kind: 'edit_profile'; schema: 2
  id: string; name: string; description: string
  /** Increases every time the owner saves a change; previous versions are kept (see `previous`). */
  version: number; createdAt: string; updatedAt: string
  source: 'preset' | 'learned' | 'custom'
  /** Montages this profile has been measured from. */
  sessions: number
  format: OutputFormat
  pacing: {
    /** Target length of a video clip (a long take is split into pieces of about this length). */
    videoClipMs: number
    /** Length of an image on screen. */
    imageClipMs: number
    minClipMs: number; maxClipMs: number
    splitLong: boolean; removeSilences: boolean; cutOnShots: boolean
    /** With a narration: stretch or repeat the visuals so they last as long as the voice. */
    fitToVoice: boolean
  }
  rhythm: { syncToMusic: boolean; /** Cut every N beats of the music. */ beatsPerCut: number }
  transitions: { betweenMaterials: Transition; onShotChange: Transition; withinTake: Transition; durationMs: number }
  camera: { images: CameraKind; videos: CameraKind; amount: number; /** Alternate the direction clip after clip (in/out, left/right). */ alternate: boolean }
  speed: { video: number }
  audio: { videoVolume: number; muteVideo: boolean; musicVolume: number; voiceVolume: number; sfxVolume: number; duckMusic: boolean; loopMusic: boolean }
  subtitles: { enabled: boolean; style: CaptionStyle }
  text: { font: TextFont; color: string; position: TextOverlay['position']; sizePct: number; animation: TextAnimation }
  structure: {
    intro: { title: boolean; titleMs: number; hook: boolean; hookMs: number }
    outro: { endCard: boolean; endCardText: string; endCardMs: number }
  }
  export: ExportSettings
  /** What was measured, in words (shown to the owner). */
  notes: string[]
  /** Change log, newest last. */
  history: Array<{ version: number; at: string; summary: string }>
  /** Up to 5 earlier versions, to restore. */
  previous?: Array<Omit<EditProfile, 'previous'>>
}

// ---------------------------------------------------------------- helpers
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const mode = <T,>(xs: T[]): T | null => { const m = new Map<T, number>(); xs.forEach(x => m.set(x, (m.get(x) ?? 0) + 1)); let best: T | null = null, n = 0; m.forEach((v, k) => { if (v > n) { n = v; best = k } }); return best }
const roundTo = (n: number, step: number) => Number((Math.round(n / step) * step).toFixed(4))
const clampN = (n: unknown, lo: number, hi: number, d: number) => { const x = Number(n); return Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : d }
const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`
const pct = (v: number) => `${Math.round(v * 100)} %`
export const newProfileId = () => `style-${Math.random().toString(36).slice(2, 10)}`
const now = () => new Date().toISOString()
const pick = <T extends string>(v: unknown, allowed: Record<T, unknown>, d: T): T => (typeof v === 'string' && v in allowed ? (v as T) : d)

export type VisualKind = 'image' | 'video' | 'other'

// ---------------------------------------------------------------- presets
const base = (o: Partial<EditProfile> & Pick<EditProfile, 'id' | 'name' | 'description' | 'format'>): EditProfile => ({
  kind: 'edit_profile', schema: 2, version: 1, createdAt: now(), updatedAt: now(), source: 'preset', sessions: 0,
  pacing: { videoClipMs: 6000, imageClipMs: 5000, minClipMs: 1500, maxClipMs: 12000, splitLong: true, removeSilences: false, cutOnShots: true, fitToVoice: false },
  rhythm: { syncToMusic: false, beatsPerCut: 4 },
  transitions: { betweenMaterials: 'dissolve', onShotChange: 'cut', withinTake: 'cut', durationMs: 500 },
  camera: { images: 'zoom_in', videos: 'none', amount: 0.08, alternate: false },
  speed: { video: 1 },
  audio: { videoVolume: 1, muteVideo: false, musicVolume: 0.3, voiceVolume: 1, sfxVolume: 0.8, duckMusic: true, loopMusic: true },
  subtitles: { enabled: false, style: 'box' },
  text: { font: 'sans', color: '#ffffff', position: 'bottom', sizePct: 6, animation: 'fade' },
  structure: { intro: { title: false, titleMs: 3000, hook: false, hookMs: 3000 }, outro: { endCard: false, endCardText: '', endCardMs: 3000 } },
  export: { quality: 'normal' },
  notes: [], history: [{ version: 1, at: now(), summary: 'Creado desde una plantilla inicial.' }],
  ...o,
})

/** Starting points only: every value can be changed by the owner. */
export function presetProfiles(): EditProfile[] {
  return [
    base({
      id: 'preset-lofi', name: 'Lo-fi / Relax Music', description: 'Vídeos largos, movimientos suaves, transiciones lentas y música continua.', format: '16:9',
      pacing: { videoClipMs: 20000, imageClipMs: 20000, minClipMs: 8000, maxClipMs: 60000, splitLong: false, removeSilences: false, cutOnShots: false, fitToVoice: false },
      transitions: { betweenMaterials: 'dissolve', onShotChange: 'dissolve', withinTake: 'dissolve', durationMs: 1500 },
      camera: { images: 'zoom_in', videos: 'zoom_in', amount: 0.06, alternate: true },
      audio: { videoVolume: 0, muteVideo: true, musicVolume: 0.9, voiceVolume: 1, sfxVolume: 0.5, duckMusic: false, loopMusic: true },
      text: { font: 'serif', color: '#ffffff', position: 'bottom', sizePct: 4, animation: 'fade' },
      structure: { intro: { title: true, titleMs: 5000, hook: false, hookMs: 3000 }, outro: { endCard: false, endCardText: '', endCardMs: 4000 } },
      export: { quality: 'high' },
    }),
    base({
      id: 'preset-docu', name: 'Historias y documentales', description: 'La narración manda; imágenes y vídeos de apoyo con subtítulos y transiciones al ritmo de la voz.', format: '16:9',
      pacing: { videoClipMs: 6000, imageClipMs: 6000, minClipMs: 2500, maxClipMs: 10000, splitLong: true, removeSilences: false, cutOnShots: true, fitToVoice: true },
      transitions: { betweenMaterials: 'dissolve', onShotChange: 'cut', withinTake: 'cut', durationMs: 600 },
      camera: { images: 'zoom_in', videos: 'none', amount: 0.1, alternate: true },
      audio: { videoVolume: 0.2, muteVideo: false, musicVolume: 0.2, voiceVolume: 1, sfxVolume: 0.7, duckMusic: true, loopMusic: true },
      subtitles: { enabled: true, style: 'box' },
      structure: { intro: { title: true, titleMs: 4000, hook: false, hookMs: 3000 }, outro: { endCard: false, endCardText: '', endCardMs: 3000 } },
    }),
    base({
      id: 'preset-shorts', name: 'Shorts / Reels / TikTok', description: 'Vertical, cortes rápidos, subtítulos dinámicos y cortes al ritmo de la música.', format: '9:16',
      pacing: { videoClipMs: 2000, imageClipMs: 1800, minClipMs: 1000, maxClipMs: 3500, splitLong: true, removeSilences: true, cutOnShots: true, fitToVoice: true },
      rhythm: { syncToMusic: true, beatsPerCut: 2 },
      transitions: { betweenMaterials: 'cut', onShotChange: 'cut', withinTake: 'cut', durationMs: 150 },
      camera: { images: 'zoom_in', videos: 'zoom_in', amount: 0.12, alternate: true },
      audio: { videoVolume: 1, muteVideo: false, musicVolume: 0.35, voiceVolume: 1, sfxVolume: 0.9, duckMusic: true, loopMusic: true },
      subtitles: { enabled: true, style: 'karaoke' },
      text: { font: 'condensed', color: '#ffffff', position: 'center', sizePct: 9, animation: 'pop' },
      structure: { intro: { title: false, titleMs: 2000, hook: true, hookMs: 2500 }, outro: { endCard: false, endCardText: '', endCardMs: 2000 } },
    }),
  ]
}

// ---------------------------------------------------------------- parse / legacy
/** Defensive parse (stored user data): every field is clamped to what the editor can do. */
export function parseProfile(v: unknown, depth = 0): EditProfile | null {
  const o = (v && typeof v === 'object' ? v : null) as Partial<EditProfile> | null
  if (!o || o.kind !== 'edit_profile' || typeof o.id !== 'string' || typeof o.name !== 'string' || !o.name.trim()) return null
  const d = base({ id: o.id, name: o.name, description: '', format: '16:9' })
  const p = o.pacing ?? d.pacing, r = o.rhythm ?? d.rhythm, t = o.transitions ?? d.transitions, c = o.camera ?? d.camera, a = o.audio ?? d.audio
  const s = o.subtitles ?? d.subtitles, x = o.text ?? d.text, st = o.structure ?? d.structure
  const minClipMs = clampN(p.minClipMs, MIN_CLIP_MS, 60000, d.pacing.minClipMs)
  const maxClipMs = clampN(p.maxClipMs, minClipMs, MAX_CLIP_MS, Math.max(minClipMs, d.pacing.maxClipMs))
  return {
    kind: 'edit_profile', schema: 2, id: o.id.slice(0, 60), name: o.name.trim().slice(0, 60), description: typeof o.description === 'string' ? o.description.slice(0, 300) : '',
    version: Math.max(1, Math.round(Number(o.version) || 1)), createdAt: typeof o.createdAt === 'string' ? o.createdAt : now(), updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now(),
    source: o.source === 'learned' || o.source === 'custom' ? o.source : 'preset', sessions: Math.max(0, Math.round(Number(o.sessions) || 0)),
    format: o.format === '9:16' || o.format === '1:1' ? o.format : '16:9',
    pacing: {
      videoClipMs: clampN(p.videoClipMs, minClipMs, maxClipMs, Math.min(Math.max(6000, minClipMs), maxClipMs)), imageClipMs: clampN(p.imageClipMs, minClipMs, maxClipMs, Math.min(Math.max(5000, minClipMs), maxClipMs)),
      minClipMs, maxClipMs, splitLong: p.splitLong !== false, removeSilences: p.removeSilences === true, cutOnShots: p.cutOnShots !== false, fitToVoice: p.fitToVoice === true,
    },
    rhythm: { syncToMusic: r.syncToMusic === true, beatsPerCut: Math.round(clampN(r.beatsPerCut, 1, 16, 4)) },
    transitions: { betweenMaterials: pick(t.betweenMaterials, TRANSITIONS, 'dissolve'), onShotChange: pick(t.onShotChange, TRANSITIONS, 'cut'), withinTake: pick(t.withinTake, TRANSITIONS, 'cut'), durationMs: Math.round(clampN(t.durationMs, 0, 1500, 500)) },
    camera: { images: pick(c.images, CAMERA_MOVES, 'zoom_in'), videos: pick(c.videos, CAMERA_MOVES, 'none'), amount: clampN(c.amount, 0.02, 0.5, 0.08), alternate: c.alternate === true },
    speed: { video: clampN(o.speed?.video, 0.25, 4, 1) },
    audio: {
      videoVolume: clampN(a.videoVolume, 0, 2, 1), muteVideo: a.muteVideo === true, musicVolume: clampN(a.musicVolume, 0, 1, 0.3), voiceVolume: clampN(a.voiceVolume, 0, 2, 1),
      sfxVolume: clampN(a.sfxVolume, 0, 2, 0.8), duckMusic: a.duckMusic !== false, loopMusic: a.loopMusic !== false,
    },
    subtitles: { enabled: s.enabled === true, style: pick(s.style, CAPTION_STYLES, 'box') },
    text: { font: pick(x.font, TEXT_FONTS, 'sans'), color: typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color) ? x.color.toLowerCase() : '#ffffff', position: x.position === 'top' || x.position === 'center' ? x.position : 'bottom', sizePct: clampN(x.sizePct, 2, 15, 6), animation: pick(x.animation, TEXT_ANIMATIONS, 'fade') },
    structure: {
      intro: { title: st.intro?.title === true, titleMs: Math.round(clampN(st.intro?.titleMs, 1000, 15000, 3000)), hook: st.intro?.hook === true, hookMs: Math.round(clampN(st.intro?.hookMs, 1000, 8000, 3000)) },
      outro: { endCard: st.outro?.endCard === true, endCardText: typeof st.outro?.endCardText === 'string' ? st.outro.endCardText.slice(0, 120) : '', endCardMs: Math.round(clampN(st.outro?.endCardMs, 1000, 15000, 3000)) },
    },
    export: { quality: o.export?.quality === 'high' ? 'high' : 'normal' },
    notes: Array.isArray(o.notes) ? o.notes.filter((n): n is string => typeof n === 'string').slice(0, 30) : [],
    history: Array.isArray(o.history) ? o.history.filter(h => h && typeof h.summary === 'string').map(h => ({ version: Math.max(1, Math.round(Number(h.version) || 1)), at: String(h.at ?? ''), summary: String(h.summary).slice(0, 400) })).slice(-50) : [],
    ...(depth === 0 && Array.isArray(o.previous) ? { previous: o.previous.flatMap(q => { const pp = parseProfile(q, 1); return pp ? [pp] : [] }).slice(-5) } : {}),
  }
}

/** Converts a style saved by the first «Aprende de mí» version into a profile (nothing is lost: its notes are kept). */
export function fromLegacyStyle(s: EditStyle): EditProfile {
  const isRef = s.source === 'referencia'
  const pattern: Transition = s.transitions.pattern === 'alternate' ? 'fade' : s.transitions.pattern
  return parseProfile({
    ...base({ id: `legacy-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`, name: s.name, description: isRef ? 'Medido de un vídeo de referencia (solo números).' : 'Grabado con «Aprende de mí».', format: s.format ?? '16:9' }),
    rhythm: { syncToMusic: s.sync?.snapToBeats === true, beatsPerCut: 1 },
    source: 'learned', sessions: s.samples,
    pacing: { videoClipMs: s.pacing.medianClipMs, imageClipMs: s.pacing.medianClipMs, minClipMs: Math.max(MIN_CLIP_MS, s.pacing.minClipMs), maxClipMs: Math.max(s.pacing.maxClipMs, MIN_CLIP_MS), splitLong: s.pacing.splitLong, removeSilences: false, cutOnShots: true, fitToVoice: false },
    transitions: { betweenMaterials: pattern, onShotChange: pattern, withinTake: pattern === 'fade' ? 'fade' : 'cut', durationMs: s.transitions.fadeMs },
    camera: { images: s.framing.motion === 'kenburns' ? 'zoom_in' : 'none', videos: 'none', amount: 0.08, alternate: false },
    audio: { videoVolume: s.clipAudio.volume, muteVideo: s.clipAudio.muteVideo, musicVolume: s.mix.musicVolume, voiceVolume: 1, sfxVolume: s.sfxOnCuts?.volume ?? 0.8, duckMusic: s.mix.duckMusic, loopMusic: true },
    subtitles: { enabled: s.mix.subtitles, style: 'box' },
    text: { font: 'sans', color: '#ffffff', position: s.text.position ?? 'bottom', sizePct: s.text.sizePct ?? 6, animation: 'none' },
    notes: s.observations,
  })!
}

// ---------------------------------------------------------------- measure («Guardar como estilo de edición»)
/** Every text the viewer sees, with its timeline start: clip overlays and text-track clips. */
function allTexts(c: Composition) {
  const starts = clipStarts(c)
  return [
    ...c.clips.flatMap((k, i) => (k.text ? [{ ...k.text, startMs: starts[i], durationMs: k.durationMs }] : [])),
    ...(c.textClips ?? []),
  ]
}

/**
 * Measures the editing decisions of a montage. `seed` supplies what a finished montage cannot show
 * (e.g. whether silences were removed from the raw footage); everything visible is measured.
 */
export function extractProfile(c: Composition, kindOf: (assetId: string | null) => VisualKind, name: string, seed?: EditProfile): EditProfile {
  const b = seed ?? presetProfiles()[1]
  const notes: string[] = []
  const imgs = c.clips.filter(k => kindOf(k.visualAssetId) === 'image')
  const vids = c.clips.filter(k => kindOf(k.visualAssetId) === 'video')
  const all = c.clips.map(k => k.durationMs)
  const sorted = [...all].sort((x, y) => x - y)
  const q = (f: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))] : null
  const minClipMs = roundTo(Math.max(MIN_CLIP_MS, q(0.1) ?? b.pacing.minClipMs), 100)
  const maxClipMs = roundTo(Math.max(minClipMs, q(0.9) ?? b.pacing.maxClipMs), 100)
  const videoClipMs = roundTo(median(vids.map(k => k.durationMs)) ?? b.pacing.videoClipMs, 100)
  const imageClipMs = roundTo(median(imgs.map(k => k.durationMs)) ?? b.pacing.imageClipMs, 100)
  const total = totalDurationMs(c)
  const cutsPerMin = total ? (Math.max(0, c.clips.length - 1) / (total / 60000)) : 0
  if (c.clips.length) notes.push(`${c.clips.length} clips en ${secs(total)}: ${cutsPerMin.toFixed(1)} cortes por minuto.`)
  if (vids.length) notes.push(`Clips de vídeo de ${secs(videoClipMs)} de mediana.`)
  if (imgs.length) notes.push(`Imágenes en pantalla ${secs(imageClipMs)} de mediana.`)

  // Transitions: between different source files vs inside the same file (a take cut into pieces).
  const between: Transition[] = [], within: Transition[] = []
  c.clips.slice(0, -1).forEach((k, i) => { const t = k.transition ?? 'fade'; (k.visualAssetId && k.visualAssetId === c.clips[i + 1].visualAssetId ? within : between).push(t) })
  const betweenMaterials = mode(between) ?? b.transitions.betweenMaterials
  const withinTake = mode(within) ?? b.transitions.withinTake
  if (between.length) notes.push(`Entre materiales: ${TRANSITIONS[betweenMaterials].toLowerCase()}${betweenMaterials !== 'cut' ? ` de ${c.fadeMs} ms` : ''}.`)
  if (within.length) notes.push(`Dentro de una misma toma: ${TRANSITIONS[withinTake].toLowerCase()}.`)

  const camKind = (k: Clip, isImg: boolean) => effectiveCamera(k, isImg)?.kind ?? 'none'
  const imgCams = imgs.map(k => camKind(k, true)), vidCams = vids.map(k => camKind(k, false))
  const camImages = mode(imgCams) ?? b.camera.images, camVideos = mode(vidCams) ?? b.camera.videos
  const amounts = c.clips.map(k => effectiveCamera(k, kindOf(k.visualAssetId) === 'image')?.amount).filter((x): x is number => typeof x === 'number')
  const dirs = c.clips.map(k => effectiveCamera(k, kindOf(k.visualAssetId) === 'image')?.kind).filter((x): x is CameraKind => Boolean(x) && x !== 'none')
  const alternate = dirs.length >= 3 && dirs.slice(1).filter((d, i) => d !== dirs[i]).length >= (dirs.length - 1) * 0.6
  if (imgs.length) notes.push(`Imágenes: ${CAMERA_MOVES[camImages].toLowerCase()}${alternate ? ', alternando la dirección' : ''}.`)
  if (vids.length && camVideos !== 'none') notes.push(`Vídeos: ${CAMERA_MOVES[camVideos].toLowerCase()}.`)

  const speed = roundTo(median(vids.map(k => k.speed ?? 1)) ?? b.speed.video, 0.05)
  if (vids.length && speed !== 1) notes.push(`Velocidad de los vídeos ${speed}×.`)

  const muteVideo = vids.length > 0 && vids.filter(k => k.muted).length / vids.length >= 0.6
  const videoVolume = roundTo(median(vids.filter(k => !k.muted).map(k => k.volume ?? 1)) ?? b.audio.videoVolume, 0.05)
  const ac = c.audioClips ?? []
  const vol = (kind: AudioClip['kind'], d: number) => roundTo(median(ac.filter(a => a.kind === kind && !a.muted).map(a => a.volume)) ?? d, 0.05)
  const hasTrackMusic = ac.some(a => a.kind === 'music')
  const musicVolume = hasTrackMusic ? vol('music', b.audio.musicVolume) : c.musicAssetId ? c.musicVolume : b.audio.musicVolume
  const voiceVolume = vol('voice', b.audio.voiceVolume), sfxVolume = vol('sfx', b.audio.sfxVolume)
  if (vids.length) notes.push(muteVideo ? 'Silencias el audio original de los vídeos.' : `Audio original de los vídeos al ${pct(videoVolume)}.`)
  if (hasTrackMusic || c.musicAssetId) notes.push(`Música al ${pct(musicVolume)}${c.duckMusic ? ', bajando bajo la voz' : ''}.`)
  if (ac.some(a => a.kind === 'voice')) notes.push(`Voz al ${pct(voiceVolume)}.`)

  const texts = allTexts(c)
  const text = texts.length ? {
    font: mode(texts.map(t => t.font ?? 'sans')) ?? b.text.font, color: mode(texts.map(t => t.color ?? '#ffffff')) ?? b.text.color,
    position: mode(texts.map(t => t.position)) ?? b.text.position, sizePct: roundTo(median(texts.map(t => t.sizePct)) ?? b.text.sizePct, 0.5),
    animation: mode(texts.map(t => t.animation ?? 'none')) ?? b.text.animation,
  } : b.text
  if (texts.length) notes.push(`Textos: ${TEXT_FONTS[text.font].label.toLowerCase()}, ${text.sizePct} %, ${text.position === 'top' ? 'arriba' : text.position === 'center' ? 'en el centro' : 'abajo'}, animación «${TEXT_ANIMATIONS[text.animation].toLowerCase()}».`)
  notes.push(c.subtitles ? `Subtítulos «${CAPTION_STYLES[c.captionStyle ?? 'box'].toLowerCase()}».` : 'Sin subtítulos.')

  const title = (c.textClips ?? []).find(t => t.startMs < 500 && t.durationMs <= 15000)
  const endCard = (c.textClips ?? []).find(t => Math.abs(t.startMs + t.durationMs - total) <= 600 && t.startMs > 500)
  if (title) notes.push(`Abres con un título de ${secs(title.durationMs)}.`)
  if (c.hookText) notes.push(`Gancho en pantalla los primeros ${secs(c.hookMs ?? 3000)}.`)
  if (endCard) notes.push(`Cierras con «${endCard.content.slice(0, 40)}» (${secs(endCard.durationMs)}).`)
  notes.push(`Formato ${c.format}${c.exportSettings?.quality === 'high' ? ', exportación en alta calidad' : ''}.`)

  return parseProfile({
    ...b, id: newProfileId(), name, description: `Medido de «${c.title || 'un montaje'}».`, version: 1, createdAt: now(), updatedAt: now(), source: 'learned', sessions: 1,
    format: c.format,
    pacing: { ...b.pacing, videoClipMs, imageClipMs, minClipMs, maxClipMs, splitLong: b.pacing.splitLong || (vids.length > 0 && maxClipMs < 20000) },
    transitions: { ...b.transitions, betweenMaterials, withinTake, onShotChange: withinTake, durationMs: c.fadeMs },
    camera: { images: camImages, videos: camVideos, amount: roundTo(median(amounts) ?? b.camera.amount, 0.01), alternate },
    speed: { video: speed },
    audio: { ...b.audio, videoVolume, muteVideo, musicVolume, voiceVolume, sfxVolume, duckMusic: c.duckMusic },
    subtitles: { enabled: c.subtitles, style: c.captionStyle ?? 'box' },
    text,
    structure: {
      intro: { title: Boolean(title), titleMs: title?.durationMs ?? b.structure.intro.titleMs, hook: Boolean(c.hookText), hookMs: c.hookMs ?? b.structure.intro.hookMs },
      outro: { endCard: Boolean(endCard), endCardText: endCard?.content ?? b.structure.outro.endCardText, endCardMs: endCard?.durationMs ?? b.structure.outro.endCardMs },
    },
    export: { quality: c.exportSettings?.quality ?? 'normal' },
    notes, history: [{ version: 1, at: now(), summary: `Medido de «${c.title || 'un montaje'}».` }],
  })!
}

// ---------------------------------------------------------------- build («Editar automáticamente con mi estilo»)
export type Material =
  | { kind: 'video'; assetId: string; durationMs: number; label?: string; silences?: Interval[]; shots?: number[]; captions?: Array<{ start: number; end: number; text: string }> }
  | { kind: 'image'; assetId: string; label?: string }
export type BuildInput = {
  title: string; hookText?: string | null; storyboardId?: string
  materials: Material[]
  music?: { assetId: string; durationMs: number; beats?: number[] } | null
  voice?: { assetId: string; durationMs: number } | null
  sfxOnCuts?: { assetId: string; durationMs: number } | null
}

const opposite: Partial<Record<CameraKind, CameraKind>> = { zoom_in: 'zoom_out', zoom_out: 'zoom_in', pan_left: 'pan_right', pan_right: 'pan_left', pan_up: 'pan_down', pan_down: 'pan_up' }
const uid = (p: string, i: number) => `${p}-${i}-${Math.random().toString(36).slice(2, 7)}`

/** Snaps clip boundaries to music beats: every N beats, never making a clip shorter than the minimum. Images absorb most of the change. */
export function snapToBeats(durations: number[], beats: number[], beatsPerCut: number, minMs: number, flexible: boolean[]): number[] {
  if (beats.length < 2 || !durations.length) return durations
  const grid = beats.filter((_, i) => i % Math.max(1, beatsPerCut) === 0)
  const out = [...durations]
  let t = 0
  for (let i = 0; i < out.length - 1; i++) {
    const target = t + out[i]
    const tolerance = flexible[i] ? out[i] * 0.5 : Math.min(500, out[i] * 0.2)
    const best = grid.reduce<number | null>((acc, g) => (g - t >= minMs && Math.abs(g - target) <= tolerance && (acc === null || Math.abs(g - target) < Math.abs(acc - target)) ? g : acc), null)
    if (best !== null) out[i] = Math.round(best - t)
    t += out[i]
  }
  return out
}

export function buildFromProfile(input: BuildInput, p: EditProfile): { composition: Composition; report: string[] } {
  const report: string[] = []
  const c = emptyComposition(input.storyboardId ?? `style:${p.id}`, input.title.slice(0, 160) || 'Montaje con mi estilo', p.format)
  type Draft = Clip & { _flex: boolean; _source: number }
  const drafts: Draft[] = []
  let camToggle = false
  const camFor = (isImg: boolean): Clip['camera'] => {
    const k = isImg ? p.camera.images : p.camera.videos
    if (k === 'none') return { kind: 'none', amount: p.camera.amount }
    const kind = p.camera.alternate && camToggle ? opposite[k] ?? k : k
    camToggle = !camToggle
    return { kind, amount: p.camera.amount }
  }
  let removed = 0
  input.materials.forEach((m, mi) => {
    if (m.kind === 'image') {
      drafts.push({ id: uid('clip', drafts.length), sceneId: 'style', position: 0, narration: null, visualAssetId: m.assetId, voiceAssetId: null, durationMs: p.pacing.imageClipMs, motion: 'none', camera: camFor(true), focusX: 0.5, focusY: 0.5, zoom: 1, trimInMs: 0, volume: 1, muted: false, transition: p.transitions.betweenMaterials, text: null, _flex: true, _source: mi })
      return
    }
    const segs = planSegments(m.durationMs, p.pacing.removeSilences ? m.silences ?? [] : [], m.shots ?? [], {
      removeSilences: p.pacing.removeSilences, paddingMs: 150, cutOnShots: p.pacing.cutOnShots,
      maxClipMs: p.pacing.splitLong ? Math.max(p.pacing.videoClipMs, MIN_CLIP_MS) : MAX_CLIP_MS, minClipMs: Math.min(p.pacing.minClipMs, 1500),
    })
    removed += m.durationMs - segs.reduce((s, x) => s + x.end - x.start, 0)
    const sp = p.speed.video
    segs.forEach((s, si) => {
      const cues = (m.captions ?? []).filter(k => k.end > s.start && k.start < s.end).map(k => ({ text: k.text, startMs: Math.max(0, Math.round((Math.max(k.start, s.start) - s.start) / sp)), endMs: Math.round((Math.min(k.end, s.end) - s.start) / sp) })).filter(q => q.endMs > q.startMs)
      const last = si === segs.length - 1
      drafts.push({
        id: uid('clip', drafts.length), sceneId: 'style', position: 0, narration: null, visualAssetId: m.assetId, voiceAssetId: null,
        durationMs: Math.max(MIN_CLIP_MS, Math.round((s.end - s.start) / sp)), trimInMs: s.start, speed: sp, motion: 'none', camera: camFor(false), focusX: 0.5, focusY: 0.5, zoom: 1,
        volume: p.audio.videoVolume, muted: p.audio.muteVideo, text: null,
        transition: last ? p.transitions.betweenMaterials : segs[si + 1].shotStart ? p.transitions.onShotChange : p.transitions.withinTake,
        ...(cues.length ? { cues } : {}), _flex: false, _source: mi,
      })
    })
  })
  if (!drafts.length) return { composition: c, report: ['No hay materiales visuales: añade vídeos o imágenes.'] }
  if (removed > 1000) report.push(`Silencios quitados: ${secs(removed)}.`)

  // Narration-led edits: the visuals last as long as the voice (images stretch first, then the sequence repeats).
  let clips: Draft[] = drafts
  if (p.pacing.fitToVoice && input.voice) {
    const target = input.voice.durationMs + 500
    let total = clips.reduce((s, k) => s + k.durationMs, 0)
    if (total < target) {
      const flex = clips.filter(k => k._flex)
      const room = flex.reduce((s, k) => s + (p.pacing.maxClipMs - k.durationMs), 0)
      const need = target - total
      if (flex.length && room > 0) { const f = Math.min(1, need / room); clips = clips.map(k => (k._flex ? { ...k, durationMs: Math.round(k.durationMs + (p.pacing.maxClipMs - k.durationMs) * f) } : k)) }
      total = clips.reduce((s, k) => s + k.durationMs, 0)
      const original = [...clips]
      let n = 0
      while (total < target && n < 500) { const k = original[n % original.length]; clips.push({ ...k, id: uid('clip', clips.length + n) }); total += k.durationMs; n++ }
      if (n) report.push(`Los visuales se repiten (${n} clips) para cubrir la narración de ${secs(input.voice.durationMs)}.`)
    }
    // Trim the tail to the voice length (never below the minimum clip).
    let t = 0
    const kept: Draft[] = []
    for (const k of clips) { if (t >= target) break; const d = Math.min(k.durationMs, Math.max(MIN_CLIP_MS, target - t)); kept.push({ ...k, durationMs: d }); t += d }
    clips = kept
    report.push(`Duración ajustada a la narración (${secs(t)}).`)
  }

  if (p.rhythm.syncToMusic && input.music?.beats?.length) {
    const snapped = snapToBeats(clips.map(k => k.durationMs), input.music.beats, p.rhythm.beatsPerCut, p.pacing.minClipMs, clips.map(k => k._flex))
    const moved = snapped.filter((d, i) => d !== clips[i].durationMs).length
    clips = clips.map((k, i) => ({ ...k, durationMs: snapped[i] }))
    if (moved) report.push(`${moved} cortes ajustados al ritmo de la música (cada ${p.rhythm.beatsPerCut} pulsos).`)
  } else if (p.rhythm.syncToMusic && input.music) report.push('No se detectó el pulso de la música: los cortes siguen la duración del estilo.')

  c.clips = clips.map(({ _flex, _source, ...k }, i) => ({ ...k, position: i + 1 }))
  const total = totalDurationMs(c)
  const audioClips: AudioClip[] = []
  if (input.voice) audioClips.push({ id: uid('voice', 0), assetId: input.voice.assetId, kind: 'voice', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: Math.min(input.voice.durationMs, total), volume: p.audio.voiceVolume, muted: false })
  if (input.music) {
    const len = Math.max(1000, input.music.durationMs)
    let t = 0, i = 0
    do { audioClips.push({ id: uid('music', i), assetId: input.music.assetId, kind: 'music', linkedClipId: null, offsetMs: 0, startMs: t, trimInMs: 0, durationMs: Math.min(len, total - t), volume: p.audio.musicVolume, muted: false }); t += len; i++ } while (p.audio.loopMusic && t < total && i < 200)
    report.push(i > 1 ? `Música repetida ${i} veces para cubrir ${secs(total)}.` : 'Música desde el inicio.')
  }
  if (input.sfxOnCuts) {
    c.clips.slice(1).forEach((k, i) => audioClips.push({ id: uid('sfx', i), assetId: input.sfxOnCuts!.assetId, kind: 'sfx', linkedClipId: k.id, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: Math.min(input.sfxOnCuts!.durationMs, 3000), volume: p.audio.sfxVolume, muted: false }))
    report.push(`Efecto de sonido en ${c.clips.length - 1} cortes.`)
  }
  c.audioClips = audioClips
  const textStyle = { font: p.text.font, color: p.text.color, sizePct: p.text.sizePct, animation: p.text.animation }
  const textClips: TextClip[] = []
  if (p.structure.intro.title && input.title.trim()) textClips.push({ id: uid('text', 0), content: input.title.trim().slice(0, 200), startMs: 0, durationMs: Math.min(p.structure.intro.titleMs, total), position: 'center', ...textStyle, sizePct: Math.min(15, p.text.sizePct * 1.4) })
  if (p.structure.outro.endCard && p.structure.outro.endCardText.trim()) textClips.push({ id: uid('text', 1), content: p.structure.outro.endCardText.trim(), startMs: Math.max(0, total - p.structure.outro.endCardMs), durationMs: Math.min(p.structure.outro.endCardMs, total), position: 'center', ...textStyle })
  c.textClips = textClips
  c.hookText = p.structure.intro.hook && input.hookText?.trim() ? input.hookText.trim().slice(0, 120) : null
  c.hookMs = p.structure.intro.hookMs
  c.fadeMs = p.transitions.durationMs
  c.subtitles = p.subtitles.enabled && c.clips.some(k => k.cues?.length || k.narration)
  c.captionStyle = p.subtitles.style
  c.musicAssetId = null; c.musicVolume = p.audio.musicVolume; c.duckMusic = p.audio.duckMusic
  c.exportSettings = { ...p.export }
  c.editedManually = true
  if (p.subtitles.enabled && !c.subtitles) report.push('El estilo usa subtítulos, pero ningún vídeo tiene transcripción: transcríbelo en la Biblioteca para añadirlos.')
  report.unshift(`${c.clips.length} clips, ${secs(total)}, formato ${c.format}.`)
  c.styleRef = { profileId: p.id, profileName: p.name, version: p.version, appliedAt: now(), baseline: stripRef(c) }
  return { composition: c, report }
}

const stripRef = (c: Composition): Composition => structuredClone({ ...c, styleRef: null })

// ---------------------------------------------------------------- apply to an existing montage
/** Re-styles a montage keeping its content, order and trims. Records the result as the baseline to compare corrections with. */
export function applyProfile(input: Composition, p: EditProfile, kindOf: (assetId: string | null) => VisualKind): { composition: Composition; changes: string[] } {
  const c: Composition = structuredClone({ ...input, styleRef: null })
  const changes: string[] = []
  let toggle = false
  const cam = (isImg: boolean): Clip['camera'] => { const k = isImg ? p.camera.images : p.camera.videos; const kind = k !== 'none' && p.camera.alternate && toggle ? opposite[k] ?? k : k; if (k !== 'none') toggle = !toggle; return { kind, amount: p.camera.amount } }
  let retimed = 0
  c.clips = c.clips.map((k, i) => {
    const kind = kindOf(k.visualAssetId)
    const next = c.clips[i + 1]
    const transition: Transition = next && k.visualAssetId && k.visualAssetId === next.visualAssetId ? p.transitions.withinTake : p.transitions.betweenMaterials
    let durationMs = k.durationMs
    if (kind === 'image' && Math.abs(k.durationMs - p.pacing.imageClipMs) > 100) { durationMs = p.pacing.imageClipMs; retimed++ }
    return { ...k, durationMs, transition, camera: cam(kind === 'image'), ...(kind === 'video' ? { volume: p.audio.videoVolume, muted: p.audio.muteVideo } : {}) }
  })
  if (retimed) changes.push(`${retimed} imágenes a ${secs(p.pacing.imageClipMs)}.`)
  changes.push(`Transiciones: ${TRANSITIONS[p.transitions.betweenMaterials].toLowerCase()} entre materiales, ${TRANSITIONS[p.transitions.withinTake].toLowerCase()} dentro de una toma (${p.transitions.durationMs} ms).`)
  changes.push(`Cámara: imágenes «${CAMERA_MOVES[p.camera.images].toLowerCase()}», vídeos «${CAMERA_MOVES[p.camera.videos].toLowerCase()}».`)
  c.audioClips = (c.audioClips ?? []).map(a => ({ ...a, volume: a.kind === 'music' ? p.audio.musicVolume : a.kind === 'voice' ? p.audio.voiceVolume : p.audio.sfxVolume }))
  c.musicVolume = p.audio.musicVolume; c.duckMusic = p.audio.duckMusic
  changes.push(`Volúmenes: música ${pct(p.audio.musicVolume)}, voz ${pct(p.audio.voiceVolume)}${p.audio.muteVideo ? ', audio de los vídeos silenciado' : `, vídeos ${pct(p.audio.videoVolume)}`}.`)
  const style = { font: p.text.font, color: p.text.color, sizePct: p.text.sizePct, animation: p.text.animation, position: p.text.position }
  c.clips = c.clips.map(k => (k.text ? { ...k, text: { ...k.text, ...style } } : k))
  c.textClips = (c.textClips ?? []).map(t => ({ ...t, font: style.font, color: style.color, animation: style.animation }))
  c.fadeMs = p.transitions.durationMs
  c.subtitles = p.subtitles.enabled; c.captionStyle = p.subtitles.style
  c.format = p.format; c.exportSettings = { ...p.export }
  c.editedManually = true
  changes.push(`Formato ${p.format}, subtítulos ${p.subtitles.enabled ? CAPTION_STYLES[p.subtitles.style].toLowerCase() : 'no'}.`)
  c.styleRef = { profileId: p.id, profileName: p.name, version: p.version, appliedAt: now(), baseline: stripRef(c) }
  return { composition: c, changes }
}

// ---------------------------------------------------------------- corrections → proposed changes
export type ProfilePatch = { path: string; value: unknown }
export type Correction = {
  id: string
  area: 'ritmo' | 'transiciones' | 'cámara' | 'velocidad' | 'audio' | 'texto' | 'subtítulos' | 'estructura' | 'formato' | 'orden' | 'contenido'
  description: string
  /** Empty when the change is about this montage's content and has no general rule to learn (e.g. which clip was deleted). */
  patches: ProfilePatch[]
}

const changed = (a: number | null, b: number | null, rel = 0.1, abs = 0) => a !== null && b !== null && Math.abs(a - b) > Math.max(abs, Math.abs(a) * rel)

/** Compares the automatic montage (baseline) with the owner's corrected version and lists what changed, with the profile change each one implies. */
export function diffMontages(before: Composition, after: Composition, p: EditProfile, kindOf: (assetId: string | null) => VisualKind): Correction[] {
  const out: Correction[] = []
  const byId = new Map(before.clips.map(k => [k.id, k]))
  const kept = after.clips.filter(k => byId.has(k.id))
  const added = after.clips.filter(k => !byId.has(k.id)).length
  const removed = before.clips.length - kept.length
  if (removed || added) out.push({ id: 'content', area: 'contenido', description: `${removed ? `Eliminaste ${removed} clip${removed === 1 ? '' : 's'}` : ''}${removed && added ? ' y ' : ''}${added ? `añadiste o dividiste ${added}` : ''}. Es una decisión de este montaje: no cambia el estilo.`, patches: [] })
  const order = kept.map(k => k.id), baseOrder = before.clips.filter(k => order.includes(k.id)).map(k => k.id)
  if (order.join() !== baseOrder.join()) out.push({ id: 'order', area: 'orden', description: 'Reordenaste escenas. El orden depende del contenido de cada vídeo: no se convierte en regla.', patches: [] })

  const med = (cl: Clip[], f: (k: Clip) => number) => median(cl.map(f))
  const imgsA = after.clips.filter(k => kindOf(k.visualAssetId) === 'image'), imgsB = before.clips.filter(k => kindOf(k.visualAssetId) === 'image')
  const vidsA = after.clips.filter(k => kindOf(k.visualAssetId) === 'video'), vidsB = before.clips.filter(k => kindOf(k.visualAssetId) === 'video')
  const ia = med(imgsA, k => k.durationMs), ib = med(imgsB, k => k.durationMs)
  if (changed(ib, ia, 0.1, 200)) out.push({ id: 'image-ms', area: 'ritmo', description: `${ia! < ib! ? 'Acortaste' : 'Alargaste'} las imágenes: de ${secs(ib!)} a ${secs(ia!)} de mediana.`, patches: [{ path: 'pacing.imageClipMs', value: roundTo(ia!, 100) }] })
  const va = med(vidsA, k => k.durationMs), vb = med(vidsB, k => k.durationMs)
  if (changed(vb, va, 0.1, 200)) out.push({ id: 'video-ms', area: 'ritmo', description: `${va! < vb! ? 'Acortaste' : 'Alargaste'} los clips de vídeo: de ${secs(vb!)} a ${secs(va!)} de mediana.`, patches: [{ path: 'pacing.videoClipMs', value: roundTo(va!, 100) }, ...(va! > p.pacing.maxClipMs ? [{ path: 'pacing.maxClipMs', value: roundTo(va!, 100) }] : []), ...(va! < p.pacing.minClipMs ? [{ path: 'pacing.minClipMs', value: roundTo(Math.max(MIN_CLIP_MS, va!), 100) }] : [])] })

  const tr = (c: Composition, within: boolean) => c.clips.slice(0, -1).filter((k, i) => (k.visualAssetId && k.visualAssetId === c.clips[i + 1].visualAssetId) === within).map(k => k.transition ?? 'fade')
  const tbA = mode(tr(after, false)), tbB = mode(tr(before, false))
  if (tbA && tbB && tbA !== tbB) out.push({ id: 'tr-between', area: 'transiciones', description: `Entre materiales cambiaste «${TRANSITIONS[tbB].toLowerCase()}» por «${TRANSITIONS[tbA].toLowerCase()}».`, patches: [{ path: 'transitions.betweenMaterials', value: tbA }] })
  const twA = mode(tr(after, true)), twB = mode(tr(before, true))
  if (twA && twB && twA !== twB) out.push({ id: 'tr-within', area: 'transiciones', description: `Dentro de una toma cambiaste «${TRANSITIONS[twB].toLowerCase()}» por «${TRANSITIONS[twA].toLowerCase()}».`, patches: [{ path: 'transitions.withinTake', value: twA }, { path: 'transitions.onShotChange', value: twA }] })
  if (Math.abs(after.fadeMs - before.fadeMs) >= 50) out.push({ id: 'tr-ms', area: 'transiciones', description: `Transiciones de ${before.fadeMs} ms a ${after.fadeMs} ms.`, patches: [{ path: 'transitions.durationMs', value: after.fadeMs }] })

  const camMode = (cl: Clip[], img: boolean) => mode(cl.map(k => effectiveCamera(k, img)?.kind ?? 'none'))
  const ciA = camMode(imgsA, true), ciB = camMode(imgsB, true)
  if (ciA && ciB && ciA !== ciB) out.push({ id: 'cam-img', area: 'cámara', description: `Imágenes: de «${CAMERA_MOVES[ciB].toLowerCase()}» a «${CAMERA_MOVES[ciA].toLowerCase()}».`, patches: [{ path: 'camera.images', value: ciA }] })
  const cvA = camMode(vidsA, false), cvB = camMode(vidsB, false)
  if (cvA && cvB && cvA !== cvB) out.push({ id: 'cam-vid', area: 'cámara', description: `Vídeos: de «${CAMERA_MOVES[cvB].toLowerCase()}» a «${CAMERA_MOVES[cvA].toLowerCase()}».`, patches: [{ path: 'camera.videos', value: cvA }] })
  const amt = (cl: Clip[], img: boolean) => median(cl.map(k => effectiveCamera(k, img)?.amount).filter((x): x is number => typeof x === 'number'))
  const amA = median([...imgsA.map(k => effectiveCamera(k, true)?.amount ?? NaN), ...vidsA.map(k => effectiveCamera(k, false)?.amount ?? NaN)].filter(Number.isFinite))
  const amB = median([amt(imgsB, true), amt(vidsB, false)].filter((x): x is number => x !== null))
  if (changed(amB, amA, 0.2, 0.01)) out.push({ id: 'cam-amount', area: 'cámara', description: `Movimiento de cámara ${amA! > amB! ? 'más' : 'menos'} intenso (${Math.round(amB! * 100)} % → ${Math.round(amA! * 100)} %).`, patches: [{ path: 'camera.amount', value: roundTo(amA!, 0.01) }] })

  const spA = med(vidsA, k => k.speed ?? 1), spB = med(vidsB, k => k.speed ?? 1)
  if (changed(spB, spA, 0.04)) out.push({ id: 'speed', area: 'velocidad', description: `Velocidad de los vídeos de ${spB}× a ${spA}×.`, patches: [{ path: 'speed.video', value: roundTo(spA!, 0.05) }] })

  const muteShare = (cl: Clip[]) => (cl.length ? cl.filter(k => k.muted).length / cl.length : null)
  const mA = muteShare(vidsA), mB = muteShare(vidsB)
  if (mA !== null && mB !== null && (mA >= 0.6) !== (mB >= 0.6)) out.push({ id: 'mute', area: 'audio', description: mA >= 0.6 ? 'Silenciaste el audio original de los vídeos.' : 'Volviste a activar el audio original de los vídeos.', patches: [{ path: 'audio.muteVideo', value: mA >= 0.6 }] })
  const vvA = med(vidsA.filter(k => !k.muted), k => k.volume ?? 1), vvB = med(vidsB.filter(k => !k.muted), k => k.volume ?? 1)
  if (changed(vvB, vvA, 0.15, 0.05)) out.push({ id: 'video-vol', area: 'audio', description: `Audio de los vídeos del ${pct(vvB!)} al ${pct(vvA!)}.`, patches: [{ path: 'audio.videoVolume', value: roundTo(vvA!, 0.05) }] })
  for (const [kind, label, path] of [['music', 'Música', 'audio.musicVolume'], ['voice', 'Voz', 'audio.voiceVolume'], ['sfx', 'Efectos', 'audio.sfxVolume']] as const) {
    const a = median((after.audioClips ?? []).filter(x => x.kind === kind && !x.muted).map(x => x.volume)), b = median((before.audioClips ?? []).filter(x => x.kind === kind && !x.muted).map(x => x.volume))
    if (changed(b, a, 0.15, 0.05)) out.push({ id: `${kind}-vol`, area: 'audio', description: `${label} del ${pct(b!)} al ${pct(a!)}.`, patches: [{ path, value: roundTo(a!, 0.05) }] })
  }
  if (after.duckMusic !== before.duckMusic) out.push({ id: 'duck', area: 'audio', description: after.duckMusic ? 'Activaste que la música baje bajo la voz.' : 'Desactivaste que la música baje bajo la voz.', patches: [{ path: 'audio.duckMusic', value: after.duckMusic }] })

  const ta = allTexts(after), tb = allTexts(before)
  if (ta.length && tb.length) {
    const cmp = <K extends 'position' | 'font' | 'color' | 'animation'>(key: K, label: string, show: (v: NonNullable<TextOverlay[K]>) => string) => {
      const a = mode(ta.map(t => t[key])), b = mode(tb.map(t => t[key]))
      if (a && b && a !== b) out.push({ id: `text-${key}`, area: 'texto', description: `${label}: de «${show(b as NonNullable<TextOverlay[K]>)}» a «${show(a as NonNullable<TextOverlay[K]>)}».`, patches: [{ path: `text.${key}`, value: a }] })
    }
    cmp('position', 'Moviste los textos', v => (v === 'top' ? 'arriba' : v === 'center' ? 'centro' : 'abajo'))
    cmp('font', 'Tipografía', v => TEXT_FONTS[v as TextFont].label)
    cmp('color', 'Color del texto', v => String(v))
    cmp('animation', 'Animación del texto', v => TEXT_ANIMATIONS[v as TextAnimation])
    const sa = median(ta.map(t => t.sizePct)), sb = median(tb.map(t => t.sizePct))
    if (changed(sb, sa, 0.1, 0.5)) out.push({ id: 'text-size', area: 'texto', description: `Tamaño del texto del ${sb} % al ${sa} %.`, patches: [{ path: 'text.sizePct', value: roundTo(sa!, 0.5) }] })
  }
  const titleA = (after.textClips ?? []).find(t => t.startMs < 500), titleB = (before.textClips ?? []).find(t => t.startMs < 500)
  if (titleB && !titleA) out.push({ id: 'title-off', area: 'estructura', description: 'Quitaste el título inicial.', patches: [{ path: 'structure.intro.title', value: false }] })
  if (titleA && !titleB) out.push({ id: 'title-on', area: 'estructura', description: `Añadiste un título inicial de ${secs(titleA.durationMs)}.`, patches: [{ path: 'structure.intro.title', value: true }, { path: 'structure.intro.titleMs', value: titleA.durationMs }] })
  if (titleA && titleB && changed(titleB.durationMs, titleA.durationMs, 0.1, 300)) out.push({ id: 'title-ms', area: 'estructura', description: `Título inicial de ${secs(titleB.durationMs)} a ${secs(titleA.durationMs)}.`, patches: [{ path: 'structure.intro.titleMs', value: titleA.durationMs }] })
  if (Boolean(after.hookText) !== Boolean(before.hookText)) out.push({ id: 'hook', area: 'estructura', description: after.hookText ? 'Añadiste un gancho en pantalla.' : 'Quitaste el gancho en pantalla.', patches: [{ path: 'structure.intro.hook', value: Boolean(after.hookText) }] })

  if (after.subtitles !== before.subtitles) out.push({ id: 'subs', area: 'subtítulos', description: after.subtitles ? 'Activaste los subtítulos.' : 'Quitaste los subtítulos.', patches: [{ path: 'subtitles.enabled', value: after.subtitles }] })
  else if (after.subtitles && (after.captionStyle ?? 'box') !== (before.captionStyle ?? 'box')) out.push({ id: 'subs-style', area: 'subtítulos', description: `Subtítulos «${CAPTION_STYLES[after.captionStyle ?? 'box'].toLowerCase()}».`, patches: [{ path: 'subtitles.style', value: after.captionStyle ?? 'box' }] })
  if (after.format !== before.format) out.push({ id: 'format', area: 'formato', description: `Formato de ${before.format} a ${after.format}.`, patches: [{ path: 'format', value: after.format }] })
  if ((after.exportSettings?.quality ?? 'normal') !== (before.exportSettings?.quality ?? 'normal')) out.push({ id: 'quality', area: 'formato', description: `Exportación en calidad ${after.exportSettings?.quality === 'high' ? 'alta' : 'normal'}.`, patches: [{ path: 'export.quality', value: after.exportSettings?.quality ?? 'normal' }] })
  return out
}

/** A new version of the profile with the accepted corrections. The previous version is kept (up to 5) to restore. */
export function applyPatches(p: EditProfile, corrections: Correction[], summaryPrefix = 'Correcciones incorporadas'): EditProfile {
  const patches = corrections.flatMap(c => c.patches)
  if (!patches.length) return p
  const next = structuredClone({ ...p, previous: undefined }) as EditProfile
  for (const { path, value } of patches) {
    const keys = path.split('.')
    let o = next as unknown as Record<string, unknown>
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>
    o[keys[keys.length - 1]] = value
  }
  const { previous: _ignored, ...snapshot } = p
  const version = p.version + 1
  const result = parseProfile({
    ...next, version, updatedAt: now(), sessions: p.sessions + 1, source: p.source === 'preset' ? 'custom' : p.source,
    history: [...p.history, { version, at: now(), summary: `${summaryPrefix}: ${corrections.map(c => c.description).join(' ')}`.slice(0, 400) }],
    previous: [...(p.previous ?? []), snapshot].slice(-5),
  })
  return result ?? p
}

/** Saves a manual edit of the parameters as a new version (same history rules as corrections). */
export function reviseProfile(p: EditProfile, edited: EditProfile, summary: string): EditProfile {
  const { previous: _ignored, ...snapshot } = p
  return parseProfile({ ...edited, id: p.id, version: p.version + 1, updatedAt: now(), source: p.source === 'preset' ? 'custom' : edited.source, history: [...p.history, { version: p.version + 1, at: now(), summary }], previous: [...(p.previous ?? []), snapshot].slice(-5) }) ?? p
}

/** Restores an earlier version as a NEW version (nothing is lost). */
export function restoreVersion(p: EditProfile, version: number): EditProfile {
  const old = (p.previous ?? []).find(v => v.version === version)
  return old ? reviseProfile(p, { ...old, previous: undefined } as EditProfile, `Restaurada la versión ${version}.`) : p
}


// ---------------------------------------------------------------- readable parameter differences
const LABELS: Array<[string, string, (v: unknown) => string]> = [
  ['format', 'Formato', v => String(v)],
  ['pacing.videoClipMs', 'Duración de clips de vídeo', v => secs(Number(v))], ['pacing.imageClipMs', 'Duración de imágenes', v => secs(Number(v))],
  ['pacing.minClipMs', 'Clip mínimo', v => secs(Number(v))], ['pacing.maxClipMs', 'Clip máximo', v => secs(Number(v))],
  ['pacing.splitLong', 'Dividir tomas largas', v => (v ? 'sí' : 'no')], ['pacing.removeSilences', 'Quitar silencios', v => (v ? 'sí' : 'no')],
  ['pacing.cutOnShots', 'Cortar en cambios de plano', v => (v ? 'sí' : 'no')], ['pacing.fitToVoice', 'Ajustar a la narración', v => (v ? 'sí' : 'no')],
  ['rhythm.syncToMusic', 'Cortes al ritmo de la música', v => (v ? 'sí' : 'no')], ['rhythm.beatsPerCut', 'Pulsos por corte', v => String(v)],
  ['transitions.betweenMaterials', 'Transición entre materiales', v => TRANSITIONS[v as Transition]], ['transitions.withinTake', 'Transición dentro de una toma', v => TRANSITIONS[v as Transition]],
  ['transitions.onShotChange', 'Transición en cambio de plano', v => TRANSITIONS[v as Transition]], ['transitions.durationMs', 'Duración de transiciones', v => `${v} ms`],
  ['camera.images', 'Cámara en imágenes', v => CAMERA_MOVES[v as CameraKind]], ['camera.videos', 'Cámara en vídeos', v => CAMERA_MOVES[v as CameraKind]],
  ['camera.amount', 'Intensidad de cámara', v => `${Math.round(Number(v) * 100)} %`], ['camera.alternate', 'Alternar dirección', v => (v ? 'sí' : 'no')],
  ['speed.video', 'Velocidad de vídeos', v => `${v}×`],
  ['audio.videoVolume', 'Audio de los vídeos', v => pct(Number(v))], ['audio.muteVideo', 'Silenciar audio de vídeos', v => (v ? 'sí' : 'no')],
  ['audio.musicVolume', 'Música', v => pct(Number(v))], ['audio.voiceVolume', 'Voz', v => pct(Number(v))], ['audio.sfxVolume', 'Efectos', v => pct(Number(v))],
  ['audio.duckMusic', 'Música baja bajo la voz', v => (v ? 'sí' : 'no')], ['audio.loopMusic', 'Repetir música', v => (v ? 'sí' : 'no')],
  ['subtitles.enabled', 'Subtítulos', v => (v ? 'sí' : 'no')], ['subtitles.style', 'Estilo de subtítulos', v => CAPTION_STYLES[v as CaptionStyle]],
  ['text.font', 'Tipografía', v => TEXT_FONTS[v as TextFont].label], ['text.color', 'Color del texto', v => String(v)], ['text.position', 'Posición del texto', v => (v === 'top' ? 'arriba' : v === 'center' ? 'centro' : 'abajo')],
  ['text.sizePct', 'Tamaño del texto', v => `${v} %`], ['text.animation', 'Animación del texto', v => TEXT_ANIMATIONS[v as TextAnimation]],
  ['structure.intro.title', 'Título inicial', v => (v ? 'sí' : 'no')], ['structure.intro.titleMs', 'Duración del título', v => secs(Number(v))],
  ['structure.intro.hook', 'Gancho en pantalla', v => (v ? 'sí' : 'no')], ['structure.intro.hookMs', 'Duración del gancho', v => secs(Number(v))],
  ['structure.outro.endCard', 'Cierre con texto', v => (v ? 'sí' : 'no')], ['structure.outro.endCardText', 'Texto de cierre', v => String(v) || '—'], ['structure.outro.endCardMs', 'Duración del cierre', v => secs(Number(v))],
  ['export.quality', 'Calidad de exportación', v => (v === 'high' ? 'alta' : 'normal')],
]
const get = (o: unknown, path: string) => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o)

/** Parameter-by-parameter differences between two profiles, in words (used before overwriting a style). */
export function profileDifferences(a: EditProfile, b: EditProfile) {
  return LABELS.flatMap(([path, label, show]) => { const x = get(a, path), y = get(b, path); return JSON.stringify(x) === JSON.stringify(y) ? [] : [{ path, label, before: show(x), after: show(y), value: y }] })
}
