/**
 * What is seen and heard at any instant of a montage, as plain data. The preview player and the exporter both draw and mix from
 * this, so the preview shows exactly what the export will contain. Pure: no DOM, no media.
 */
import {
  activeTextClips, audioStartMs, audioTrackId, clipCaptions, clipStarts, envelopeAt, projectDurationMs, textTrackId, totalDurationMs, tracksOf, trackGains,
  effectiveGrade, type AudioClip, type CaptionPosition, type CaptionStyle, type Composition, type Crop, type Filters, type LayerFx, type TextOverlay, type TrackKind,
} from './composition'
import { BLENDS, cameraAt, easeBy, effectiveCamera, textFrameFor, transformAt, transitionFrame, type TextFrame } from './motion'
import { DUCK_RATIO } from './audio-plan'
import { transitionWindow } from './transition-window'
import { readsFrames, sourceAt } from './reverse'
export { transitionWindow } from './transition-window'

export type MediaKind = 'video' | 'image' | 'audio' | null
export type KindOf = (assetId: string) => MediaKind

/** One picture layer. `slot` identifies the media element that shows it (one per clip, so cuts of the same file play independently). */
export type VisualOp = {
  type: 'visual'
  slot: string
  assetId: string
  media: 'video' | 'image'
  /** Position in the source file (ms) and playback speed; `live` = it advances while playing (false = a still frame, e.g. the next clip held during a transition). */
  sourceMs: number
  /** Reads the source backwards (the clip's `reverse`): the picture comes from the reverse reader, never from a playing <video>. */
  reverse?: boolean
  /** The reader walks forwards through the source (speed ramp) instead of backwards. */
  forward?: boolean
  rate: number
  live: boolean
  /** Level of the video's own sound (0 = silent). */
  volume: number
  /** Which mixer bus the video's sound goes to and the track (for mute/solo). */
  trackId: string
  fit: 'cover' | 'box'
  /** cover: fills the frame, zoomed, with the crop focus. */
  zoom: number; focusX: number; focusY: number
  /** box: centre (fractions of the frame), width as a fraction of the frame width, rotation in degrees. */
  box: { x: number; y: number; scale: number; rotation: number } | null
  rotation: number
  alpha: number
  crop: Crop | null
  filters: Filters | null
  /** Fusión, clave de color y máscara de la capa. */
  fx?: LayerFx
  /** «Igualar imagen» correction already scaled by its strength. */
  grade?: { brightness: number; contrast: number; saturation: number; warmth: number } | null
  /** Transition transforms applied to the whole layer. */
  scale: number; offsetX: number; offsetY: number; revealX: number; revealY: number; blur: number
  /** Edge the wipe reveals from. */
  revealFrom: 'left' | 'right' | 'top' | 'bottom'
  /** Draw black under this layer first (an incoming clip during a slide covers the outgoing one completely). */
  backdrop: boolean
}
export type TextOp = { type: 'text'; text: TextOverlay; frame: TextFrame }
export type CaptionOp = { type: 'caption'; text: string; style: CaptionStyle; progress: number; position?: CaptionPosition }
export type HookOp = { type: 'hook'; text: string; alpha: number }
export type FillOp = { type: 'fill'; color: string; alpha: number }
export type Op = VisualOp | TextOp | CaptionOp | HookOp | FillOp

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const baseVisual = (): Omit<VisualOp, 'type' | 'slot' | 'assetId' | 'media' | 'sourceMs' | 'rate' | 'live' | 'volume' | 'trackId' | 'fit'> => ({
  zoom: 1, focusX: 0.5, focusY: 0.5, box: null, rotation: 0, alpha: 1, crop: null, filters: null, scale: 1, offsetX: 0, offsetY: 0, revealX: 1, revealY: 1, revealFrom: 'left', blur: 0, backdrop: false,
})

/**
 * Transition length out of clip i (ms), as it is really played: the length asked for, but never longer than the clip that ends nor than the one
 * that starts (the same rule the transition slider enforces). The stored value can exceed that after a clip is shortened, split or trimmed, when a
 * transition is applied to every cut, copied, set by a command or built by a template; without this limit the picture jumped at the start of a
 * clip shorter than its own transition. Picture, sound, preview and export all read it from here.
 */
export const transitionMsOf = (c: Pick<Composition, 'clips' | 'fadeMs'>, i: number) => transitionWindow(c, i).ms

/** Index of the main-track clip at `t`, or -1 when the main track has ended. */
export function mainClipAt(c: Pick<Composition, 'clips'>, t: number, starts = clipStarts(c)) {
  let lo = 0, hi = c.clips.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (t < starts[mid]) hi = mid - 1
    else if (t >= starts[mid] + c.clips[mid].durationMs) lo = mid + 1
    else return mid
  }
  return -1
}

/**
 * Draw list at time `t` (ms). `kindOf` says whether an asset is a video or an image; unknown assets draw nothing.
 * `starts` can be passed in when evaluating many frames of the same composition.
 */
export function frameAt(c: Composition, t: number, kindOf: KindOf, starts = clipStarts(c)): Op[] {
  const ops: Op[] = []
  const tracks = tracksOf(c)
  const hidden = new Set(tracks.filter(x => x.hidden).map(x => x.id))
  const mutedTrack = new Set(tracks.filter(x => x.muted).map(x => x.id))
  const last = c.clips.length - 1
  const i = mainClipAt(c, t, starts)
  ops.push({ type: 'fill', color: '#000', alpha: 1 })
  if (i >= 0 && !hidden.has('main')) {
    const clip = c.clips[i]
    const local = t - starts[i]
    // The cut this instant belongs to, if any: the transition after clip i (we are in its last part) or the one after clip i - 1 (we are in
    // its first part, when it reaches past the cut). Both clips are on screen for the whole window.
    const win = (k: number) => (k >= 0 && k < last && BLENDS.has(c.clips[k].transition ?? 'fade') ? transitionWindow(c, k) : null)
    const wi = win(i), wp = win(i - 1)
    let k = -1
    if (wi && wi.ms > 0 && clip.durationMs - local < wi.pre) k = i
    else if (wp && wp.ms > 0 && local < wp.post) k = i - 1
    if (k >= 0) {
      const A = c.clips[k], B = c.clips[k + 1]
      const w = k === i ? wi! : wp!
      const cut = starts[k] + A.durationMs
      const p = clamp01((t - (cut - w.pre)) / w.ms)
      const kind = A.transition ?? 'fade'
      const tf = transitionFrame(kind, p, A.transitionOpts ?? {})
      const muted = mutedTrack.has('main')
      const a = mainVisual(c, k, Math.min(t - starts[k], A.durationMs), kindOf, muted)
      if (a) {
        // A keeps playing past its end while its file has material there; otherwise it holds its last frame (reported by transitionHandles).
        const over = t - cut, rate = A.speed ?? 1
        const outMs = (A.trimInMs ?? 0) + A.durationMs * rate
        const reach = outMs + Math.max(0, over) * rate
        const past = over > 0 && a.media === 'video'
        // A reversed clip has no material «after its end» (that is before its start in the file): it holds its last frame.
        const have = !past || (!readsFrames(A) && A.sourceDurationMs !== undefined && reach <= A.sourceDurationMs)
        ops.push({ ...a, live: have, sourceMs: past && !readsFrames(A) ? (have ? reach : Math.max(0, outMs - 40 * rate)) : a.sourceMs,
          scale: tf.aScale, blur: tf.aBlur, alpha: a.alpha * tf.aAlpha, volume: have ? a.volume * (1 - p) : 0 })
      }
      const b = mainVisual(c, k + 1, Math.max(0, t - starts[k + 1]), kindOf, muted)
      if (b) {
        // B plays from before its start when its file has material there (a «handle»: it was trimmed); otherwise it holds its first frame.
        const toB = (B.trimInMs ?? 0) + (t - starts[k + 1]) * (B.speed ?? 1)
        // A reversed B has nothing «before its start» either: it holds its first (= last source) frame until the cut.
        const live = b.media === 'video' && !readsFrames(B) && (t >= starts[k + 1] || toB >= 0)
        ops.push({
          ...b, live: b.media === 'video' && live, sourceMs: live ? toB : b.sourceMs, volume: live ? b.volume * p : 0, alpha: b.alpha * tf.bAlpha,
          offsetX: tf.bOffsetX, offsetY: tf.bOffsetY, revealX: tf.bReveal, revealY: tf.bRevealY, revealFrom: tf.bRevealFrom, scale: tf.bScale, blur: tf.bBlur,
          backdrop: kind === 'slide' || kind === 'slide_up' || kind === 'wipe' || kind === 'wipe_down',
        })
      }
      if (tf.white > 0) ops.push({ type: 'fill', color: '#fff', alpha: tf.white })
    } else {
      const a = mainVisual(c, i, local, kindOf, mutedTrack.has('main'))
      if (a) ops.push(a)
    }
  }
  // What belongs to the main clip (its own text and the subtitles) fades with it.
  if (i >= 0 && !hidden.has('main')) {
    const clip = c.clips[i]
    const local = t - starts[i]
    if (clip.text) ops.push({ type: 'text', text: clip.text, frame: textFrameFor(clip.text, local, clip.durationMs) })
    if (c.subtitles) {
      const cap = clipCaptions(clip).find(q => local >= q.startMs && local < q.endMs)
      if (cap) ops.push({ type: 'caption', text: cap.text, style: c.captionStyle ?? 'box', progress: (local - cap.startMs) / Math.max(1, cap.endMs - cap.startMs), ...(c.captionPosition && c.captionPosition !== 'bottom' ? { position: c.captionPosition } : {}) })
    }
    // Dips at clip boundaries: «fundido a negro» (and at the very start and end of the main track) or «fundido a blanco».
    const prevKind = i === 0 ? 'fade' : c.clips[i - 1].transition ?? 'fade'
    const ownKind = clip.transition ?? 'fade'
    const dips = (k: string) => k === 'fade' || k === 'fade_white'
    const fadeIn = i === 0 ? c.fadeMs : dips(prevKind) ? transitionMsOf(c, i - 1) : 0
    const fadeOut = i === last || dips(ownKind) ? transitionMsOf(c, i) : 0
    const inEase = i === 0 ? undefined : c.clips[i - 1].transitionOpts?.easing, outEase = clip.transitionOpts?.easing
    const amount = (x: number, e: string | undefined) => (e ? easeBy(e as 'smooth', clamp01(x)) : clamp01(x))
    if (fadeIn > 0 && local < fadeIn) ops.push({ type: 'fill', color: i > 0 && prevKind === 'fade_white' ? '#fff' : '#000', alpha: amount(1 - local / fadeIn, inEase) })
    if (fadeOut > 0 && clip.durationMs - local < fadeOut) ops.push({ type: 'fill', color: i < last && ownKind === 'fade_white' ? '#fff' : '#000', alpha: amount(1 - (clip.durationMs - local) / fadeOut, outEase) })
  }
  // Overlays: tracks higher on screen are drawn later (on top). They keep their own fades.
  const overlayTracks = tracks.filter(x => x.type === 'overlay').reverse()
  for (const tr of overlayTracks) {
    if (hidden.has(tr.id)) continue
    for (const o of c.overlays ?? []) {
      if (o.trackId !== tr.id || t < o.startMs || t >= o.startMs + o.durationMs) continue
      const media = kindOf(o.assetId)
      if (media !== 'video' && media !== 'image') continue
      const local = t - o.startMs
      const tr2 = transformAt({ ...o.transform }, o.keyframes, local)
      const fi = o.fadeInMs ?? 0, fo = o.fadeOutMs ?? 0
      const fadeA = (fi > 0 ? clamp01(local / fi) : 1) * (fo > 0 ? clamp01((o.durationMs - local) / fo) : 1)
      const cam = cameraAt(o.camera ?? null, local / o.durationMs)
      ops.push({
        ...baseVisual(), type: 'visual', slot: `ov:${o.id}`, assetId: o.assetId, media, fit: 'box', trackId: tr.id,
        sourceMs: sourceAt(o, local), ...(o.reverse ? { reverse: true } : {}), rate: o.speed ?? 1, live: true, volume: o.muted || mutedTrack.has(tr.id) ? 0 : o.volume ?? 1,
        box: { x: tr2.x, y: tr2.y, scale: tr2.scale, rotation: tr2.rotation }, alpha: tr2.opacity * fadeA,
        zoom: cam.zoom, focusX: cam.focusX ?? 0.5, focusY: cam.focusY ?? 0.5, crop: o.crop ?? null, filters: o.filters ?? null, ...(o.fx ? { fx: o.fx } : {}), ...(effectiveGrade(o.grade) ? { grade: effectiveGrade(o.grade) } : {}),
      })
    }
  }
  // Text tracks: lower tracks first, so a text track higher on screen is drawn on top.
  const textOrder = tracks.filter(x => x.type === 'text').reverse().map(x => x.id)
  const texts = activeTextClips(c, t).filter(tx => !hidden.has(textTrackId(tx))).sort((a, b) => textOrder.indexOf(textTrackId(a)) - textOrder.indexOf(textTrackId(b)))
  for (const tx of texts) ops.push({ type: 'text', text: tx, frame: textFrameFor(tx, t - tx.startMs, tx.durationMs) })
  const hookMs = c.hookMs ?? 3000
  if (c.hookText && t < hookMs) ops.push({ type: 'hook', text: c.hookText, alpha: Math.min(1, (hookMs - t) / 400) })
  return ops
}

function mainVisual(c: Composition, i: number, local: number, kindOf: KindOf, muted: boolean): VisualOp | null {
  const clip = c.clips[i]
  if (!clip?.visualAssetId) return null
  const media = kindOf(clip.visualAssetId)
  if (media !== 'video' && media !== 'image') return null
  const cam = cameraAt(effectiveCamera(clip, media === 'image'), local / clip.durationMs)
  // Keyframed framing (zoom, which part is in view, rotation, opacity), then the camera move on top.
  const f = transformAt({ zoom: clip.zoom ?? 1, focusX: clip.focusX ?? 0.5, focusY: clip.focusY ?? 0.5, rotation: clip.rotation ?? 0, opacity: clip.opacity ?? 1 }, clip.keyframes, local)
  return {
    ...baseVisual(), type: 'visual', slot: clip.id, assetId: clip.visualAssetId, media, fit: 'cover', trackId: 'main',
    sourceMs: sourceAt(clip, local), ...(readsFrames(clip) ? { reverse: true } : {}), ...(clip.ramp !== undefined && !clip.reverse && !clip.freeze ? { forward: true } : {}), rate: clip.speed ?? 1, live: true,
    volume: muted || clip.muted ? 0 : clip.volume ?? 1,
    zoom: f.zoom * cam.zoom, focusX: cam.focusX ?? f.focusX, focusY: cam.focusY ?? f.focusY,
    rotation: f.rotation, alpha: f.opacity, crop: clip.crop ?? null, filters: clip.filters ?? null, ...(clip.fx ? { fx: clip.fx } : {}), ...(effectiveGrade(clip.grade) ? { grade: effectiveGrade(clip.grade) } : {}),
  }
}

// ---------- Sound ----------
export type Bus = TrackKind
/** One sound file placed on the timeline. */
export type Voice = {
  key: string
  assetId: string
  bus: Bus
  trackId: string
  startMs: number
  endMs: number
  /** Where playback starts in the file. */
  sourceStartMs: number
  /** The background music repeats until the end. */
  loop: boolean
  volume: number
  pan: number
  envelope: Pick<AudioClip, 'durationMs' | 'fadeInMs' | 'fadeOutMs' | 'envelope'> | null
  duck: 'clip' | 'global' | null
}

/** Every sound of the montage except the videos' own sound (which plays from their picture element). */
export function audioVoices(c: Composition): Voice[] {
  const voices: Voice[] = []
  const starts = clipStarts(c)
  c.clips.forEach((clip, i) => {
    if (!clip.voiceAssetId) return
    voices.push({ key: `cv:${clip.id}`, assetId: clip.voiceAssetId, bus: 'voice', trackId: 'voice', startMs: starts[i], endMs: starts[i] + clip.durationMs, sourceStartMs: 0, loop: false, volume: 1, pan: 0, envelope: null, duck: null })
  })
  const end = projectDurationMs(c)
  for (const a of c.audioClips ?? []) {
    if (a.muted) continue
    const start = audioStartMs(c, a)
    if (start >= end) continue
    voices.push({
      key: `a:${a.id}`, assetId: a.assetId, bus: a.kind, trackId: audioTrackId(a), startMs: start, endMs: Math.min(start + a.durationMs, end), sourceStartMs: a.trimInMs,
      loop: false, volume: a.volume, pan: a.pan ?? 0, envelope: a, duck: a.kind === 'music' && c.duckMusic ? 'clip' : null,
    })
  }
  if (c.musicAssetId) voices.push({ key: 'music', assetId: c.musicAssetId, bus: 'music', trackId: 'music', startMs: 0, endMs: end, sourceStartMs: 0, loop: true, volume: c.musicVolume, pan: 0, envelope: null, duck: c.duckMusic ? 'global' : null })
  return voices
}

/** Stretches with a voice playing (for ducking the music), merged and sorted. */
export function voiceWindows(voices: Voice[]) {
  const w = voices.filter(v => v.bus === 'voice').map(v => ({ start: v.startMs, end: v.endMs })).sort((a, b) => a.start - b.start)
  const out: Array<{ start: number; end: number }> = []
  for (const x of w) { const l = out[out.length - 1]; if (l && x.start <= l.end) l.end = Math.max(l.end, x.end); else out.push({ ...x }) }
  return out
}
const DUCK_LEAD_MS = 150
const inWindow = (windows: Array<{ start: number; end: number }>, t: number) => windows.some(w => t >= w.start - DUCK_LEAD_MS && t < w.end)

/** Per audio track: 1 or 0 after the track's own mute and solo (solo is exclusive among audio tracks). */
export function audioTrackFactors(c: Composition): Map<string, number> {
  const audio = tracksOf(c).filter(t => t.type === 'voice' || t.type === 'music' || t.type === 'sfx' || t.type === 'main' || t.type === 'overlay')
  const solo = audio.some(t => t.solo)
  return new Map(audio.map(t => [t.id, t.muted || (solo && !t.solo) ? 0 : 1]))
}

/**
 * Level of a voice at time `t` (before the mixer bus): its volume × automation × ducking × the background music's fade in/out.
 * Matches the ducking ratio of the earlier renderer (35 % under a voice).
 */
export function voiceGainAt(v: Voice, t: number, windows: Array<{ start: number; end: number }>, projectEndMs: number) {
  if (t < v.startMs || t >= v.endMs) return 0
  let g = v.volume
  if (v.envelope) g *= envelopeAt(v.envelope, t - v.startMs)
  if (v.duck && inWindow(windows, t)) g *= DUCK_RATIO
  if (v.duck === 'global' || (v.loop && v.key === 'music')) {
    g *= clamp01(t / 1000)
    g *= clamp01((projectEndMs - t) / 1200)
  }
  return g
}

/** Mixer bus levels (the four kind buses with their own mute/solo). */
export const busLevels = (c: Composition) => trackGains(c.mix)

/** Main-track length vs project length, for the UI. */
export const lengths = (c: Composition) => ({ main: totalDurationMs(c), project: projectDurationMs(c) })


/**
 * The videos' own sound as voices (main clips and overlays), with the same crossfades the player applies during blending transitions.
 * The player plays it from the picture elements; the fast exporter decodes it like any other sound.
 */
export function videoVoices(c: Composition, kindOf: KindOf): Array<Voice & { rate: number; trimSec: number }> {
  const out: Array<Voice & { rate: number; trimSec: number }> = []
  const starts = clipStarts(c)
  const tracks = tracksOf(c)
  const mainMuted = tracks.find(t => t.id === 'main')?.muted
  const last = c.clips.length - 1
  const win = (k: number) => (k >= 0 && k < last && BLENDS.has(c.clips[k].transition ?? 'fade') ? transitionWindow(c, k) : { ms: 0, pre: 0, post: 0 })
  c.clips.forEach((k, i) => {
    if (!k.visualAssetId || kindOf(k.visualAssetId) !== 'video' || k.muted || readsFrames(k) || mainMuted || (k.volume ?? 1) <= 0) return
    const rate = k.speed ?? 1, trim = k.trimInMs ?? 0
    const wOut = win(i), wIn = win(i - 1)
    // Into the clip: it sounds from before its start when its file has material there (see frameAt), and fades in over its share of the window.
    const preLive = Math.min(wIn.pre, trim / rate)
    // Out of the clip: it keeps sounding past its end when its file has material there.
    const haveAfter = k.sourceDurationMs ? Math.max(0, k.sourceDurationMs - (trim + k.durationMs * rate)) / rate : 0
    const postLive = Math.min(wOut.post, haveAfter)
    const fadeIn = wIn.ms > 0 ? preLive + wIn.post : 0
    const fadeOut = wOut.ms > 0 ? wOut.pre + postLive : 0
    const startMs = starts[i] - preLive, endMs = starts[i] + k.durationMs + postLive
    out.push({ key: `vc:${k.id}`, assetId: k.visualAssetId, bus: 'video', trackId: 'main', startMs, endMs, sourceStartMs: trim - preLive * rate, loop: false, volume: k.volume ?? 1, pan: 0,
      envelope: fadeIn || fadeOut ? { durationMs: endMs - startMs, ...(fadeIn ? { fadeInMs: fadeIn } : {}), ...(fadeOut ? { fadeOutMs: fadeOut } : {}) } : null, duck: null, rate, trimSec: trim / 1000 })
  })
  for (const o of c.overlays ?? []) {
    if (kindOf(o.assetId) !== 'video' || o.muted || o.reverse || (o.volume ?? 1) <= 0 || tracks.find(t => t.id === o.trackId)?.muted || tracks.find(t => t.id === o.trackId)?.hidden) continue
    out.push({ key: `vo:${o.id}`, assetId: o.assetId, bus: 'video', trackId: o.trackId, startMs: o.startMs, endMs: o.startMs + o.durationMs, sourceStartMs: o.trimInMs, loop: false, volume: o.volume ?? 1, pan: 0, envelope: null, duck: null, rate: o.speed ?? 1, trimSec: o.trimInMs / 1000 })
  }
  return out
}
