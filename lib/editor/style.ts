/**
 * "Aprende de mí": learns how the owner edits from what they actually do in the manual editor,
 * and replays it on new edits. Deterministic and transparent — no AI guessing:
 *  - learnStyle() compares the edit before and after a recorded session and extracts measurable
 *    habits (clip length, splitting, transitions, zoom, on-screen text, audio levels, SFX on cuts…).
 *  - mergeStyles() accumulates several sessions (weighted by the number of sessions).
 *  - applyStyle() applies those habits to another composition and lists every change it made.
 * Recording the editor's own actions is exact; a screen recording would only give pixels.
 */
import type { Clip, Composition, TextOverlay, Transition } from './composition'
import { splitClip, addAudioClip } from './timeline'

export type VisualKind = 'image' | 'video' | 'other'

export type EditStyle = {
  version: 1
  name: string
  samples: number
  learnedAt: string
  format: Composition['format'] | null
  pacing: { medianClipMs: number; minClipMs: number; maxClipMs: number; splitLong: boolean; retime: boolean }
  transitions: { pattern: Transition | 'alternate'; fadeMs: number }
  framing: { motion: Clip['motion']; zoom: number; focusY: number | null }
  text: { narrationAsText: boolean; position: TextOverlay['position'] | null; sizePct: number | null }
  clipAudio: { muteVideo: boolean; volume: number }
  mix: { musicVolume: number; duckMusic: boolean; subtitles: boolean; hookMs: number | null }
  sfxOnCuts: { assetId: string; volume: number } | null
  observations: string[]
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] }
const mode = <T,>(xs: T[]): T | null => { const m = new Map<T, number>(); xs.forEach(x => m.set(x, (m.get(x) ?? 0) + 1)); let best: T | null = null, n = 0; m.forEach((v, k) => { if (v > n) { n = v; best = k } }); return best }
const round = (n: number, step: number) => Number((Math.round(n / step) * step).toFixed(4))
const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`

/** Start (ms) of each clip on the timeline. */
function clipStarts(c: Composition) { let t = 0; return c.clips.map(k => { const s = t; t += k.durationMs; return s }) }

export function learnStyle(before: Composition | null, after: Composition, kindOf: (assetId: string | null) => VisualKind, name = 'Mi estilo'): EditStyle {
  const clips = after.clips
  const durations = clips.map(c => c.durationMs)
  const obs: string[] = []

  const medianClipMs = round(median(durations), 100)
  const maxClipMs = round(quantile(durations, 0.9), 100)
  const minClipMs = round(quantile(durations, 0.1), 100)
  const beforeMax = before ? Math.max(0, ...before.clips.map(c => c.durationMs)) : 0
  const splitLong = Boolean(before && clips.length > before.clips.length && beforeMax > maxClipMs * 1.2)
  const beforeById = new Map((before?.clips ?? []).map(c => [c.id, c]))
  const retimed = clips.filter(c => { const b = beforeById.get(c.id); return b && Math.abs(b.durationMs - c.durationMs) > 150 }).length
  const retime = Boolean(before && before.clips.length && retimed / before.clips.length >= 0.3)
  obs.push(`Clips de ${secs(minClipMs)} a ${secs(maxClipMs)} (mediana ${secs(medianClipMs)}).`)
  if (splitLong) obs.push(`Divides los clips largos (más de ${secs(maxClipMs)}).`)
  if (retime) obs.push('Ajustas la duración de los clips a tu ritmo.')

  const trans = clips.slice(0, -1).map(c => c.transition ?? 'fade')
  const fades = trans.filter(t => t === 'fade').length
  const alternating = trans.length >= 3 && trans.every((t, i) => i === 0 || t !== trans[i - 1])
  const pattern: EditStyle['transitions']['pattern'] = alternating ? 'alternate' : fades >= trans.length / 2 ? 'fade' : 'cut'
  obs.push(pattern === 'cut' ? 'Usas cortes secos entre clips.' : pattern === 'fade' ? `Usas fundidos de ${after.fadeMs} ms.` : 'Alternas fundido y corte seco.')

  const motion = mode(clips.map(c => c.motion)) ?? 'kenburns'
  const zoom = round(median(clips.map(c => c.zoom ?? 1)), 0.05)
  const focusYs = clips.map(c => c.focusY).filter((v): v is number => typeof v === 'number')
  if (zoom > 1.02) obs.push(`Acercas la imagen (zoom ${zoom.toFixed(2)}×).`)
  obs.push(motion === 'kenburns' ? 'Mantienes el movimiento suave (Ken Burns).' : 'Prefieres imagen fija, sin movimiento.')

  const withText = clips.filter(c => c.text?.content)
  const narrationMatches = withText.filter(c => c.narration && c.text!.content.trim() === c.narration.trim()).length
  const narrationAsText = withText.length >= Math.max(1, clips.length / 2) && narrationMatches / Math.max(1, withText.length) >= 0.6
  const position = mode(withText.map(c => c.text!.position))
  const sizePct = withText.length ? round(median(withText.map(c => c.text!.sizePct)), 0.5) : null
  if (narrationAsText) obs.push('Pones la narración como texto en pantalla.')
  if (position) obs.push(`Textos en la parte ${position === 'top' ? 'superior' : position === 'center' ? 'central' : 'inferior'} (${sizePct} %).`)

  const videoClips = clips.filter(c => kindOf(c.visualAssetId) === 'video')
  const muteVideo = videoClips.length > 0 && videoClips.filter(c => c.muted).length / videoClips.length >= 0.6
  const volume = round(median(videoClips.map(c => c.volume ?? 1)) || 1, 0.05)
  if (muteVideo) obs.push('Silencias el audio original de los vídeos.')

  // SFX placed at (almost) every cut: a recurring "whoosh" or "hit".
  const starts = clipStarts(after)
  const sfx = (after.audioClips ?? []).filter(a => a.kind === 'sfx')
  const atCut = sfx.filter(a => {
    const t = a.linkedClipId ? (starts[after.clips.findIndex(c => c.id === a.linkedClipId)] ?? -1) + a.offsetMs : a.startMs
    return starts.slice(1).some(s => Math.abs(s - t) <= 400)
  })
  const sfxAsset = mode(atCut.map(a => a.assetId))
  const sfxOnCuts = sfxAsset && clips.length > 1 && atCut.filter(a => a.assetId === sfxAsset).length >= Math.max(1, (clips.length - 1) / 2)
    ? { assetId: sfxAsset, volume: round(median(atCut.filter(a => a.assetId === sfxAsset).map(a => a.volume)), 0.05) } : null
  if (sfxOnCuts) obs.push('Pones un efecto de sonido en cada corte.')

  obs.push(`Música al ${Math.round(after.musicVolume * 100)} %${after.duckMusic ? ', bajando bajo la voz' : ''}; subtítulos ${after.subtitles ? 'activados' : 'desactivados'}.`)

  return {
    version: 1, name, samples: 1, learnedAt: new Date().toISOString(), format: after.format,
    pacing: { medianClipMs, minClipMs, maxClipMs, splitLong, retime },
    transitions: { pattern, fadeMs: after.fadeMs },
    framing: { motion, zoom, focusY: focusYs.length ? round(median(focusYs), 0.05) : null },
    text: { narrationAsText, position, sizePct },
    clipAudio: { muteVideo, volume },
    mix: { musicVolume: after.musicVolume, duckMusic: after.duckMusic, subtitles: after.subtitles, hookMs: after.hookText ? after.hookMs ?? null : null },
    sfxOnCuts,
    observations: obs,
  }
}

/** Combines a stored style with a new session; numbers are averaged by sessions, choices follow the latest session when it is the majority. */
export function mergeStyles(prev: EditStyle, next: EditStyle): EditStyle {
  const n = prev.samples, w = (a: number, b: number) => (a * n + b) / (n + 1)
  return {
    ...next,
    name: prev.name,
    samples: n + 1,
    pacing: {
      medianClipMs: round(w(prev.pacing.medianClipMs, next.pacing.medianClipMs), 100), minClipMs: round(w(prev.pacing.minClipMs, next.pacing.minClipMs), 100),
      maxClipMs: round(w(prev.pacing.maxClipMs, next.pacing.maxClipMs), 100), splitLong: prev.pacing.splitLong || next.pacing.splitLong, retime: prev.pacing.retime || next.pacing.retime,
    },
    transitions: { pattern: next.transitions.pattern, fadeMs: Math.round(w(prev.transitions.fadeMs, next.transitions.fadeMs)) },
    framing: { motion: next.framing.motion, zoom: round(w(prev.framing.zoom, next.framing.zoom), 0.05), focusY: next.framing.focusY ?? prev.framing.focusY },
    clipAudio: { muteVideo: next.clipAudio.muteVideo, volume: round(w(prev.clipAudio.volume, next.clipAudio.volume), 0.05) },
    mix: { ...next.mix, musicVolume: round(w(prev.mix.musicVolume, next.mix.musicVolume), 0.05) },
    sfxOnCuts: next.sfxOnCuts ?? prev.sfxOnCuts,
  }
}

const hasVoice = (c: Composition, clip: Clip) => Boolean(clip.voiceAssetId) || (c.audioClips ?? []).some(a => a.kind === 'voice' && a.linkedClipId === clip.id)

/** Applies a learned style. Never invents content (text comes from the clip's own narration) and never cuts under a voice. */
export function applyStyle(input: Composition, s: EditStyle, kindOf: (assetId: string | null) => VisualKind): { composition: Composition; changes: string[] } {
  let c: Composition = structuredClone(input)
  const changes: string[] = []
  const target = Math.max(500, s.pacing.medianClipMs)

  if (s.pacing.splitLong) {
    let splits = 0
    for (const clip of [...c.clips]) {
      if (kindOf(clip.visualAssetId) !== 'video' || hasVoice(c, clip) || clip.durationMs <= s.pacing.maxClipMs * 1.15) continue
      let id = clip.id
      while (true) {
        const cur = c.clips.find(k => k.id === id)
        if (!cur || cur.durationMs <= s.pacing.maxClipMs * 1.15) break
        const before = c.clips.length
        c = splitClip(c, id, target)
        if (c.clips.length === before) break
        id = c.clips[c.clips.findIndex(k => k.id === id) + 1].id
        splits++
      }
    }
    if (splits) changes.push(`${splits} cortes en clips largos (trozos de ~${secs(target)}).`)
  }

  if (s.pacing.retime) {
    let n = 0
    c.clips = c.clips.map(k => {
      if (hasVoice(c, k) || kindOf(k.visualAssetId) !== 'image') return k
      const d = Math.min(Math.max(k.durationMs, s.pacing.minClipMs), s.pacing.maxClipMs)
      if (d !== k.durationMs) n++
      return { ...k, durationMs: d }
    })
    if (n) changes.push(`${n} imágenes ajustadas a tu ritmo (${secs(s.pacing.minClipMs)}–${secs(s.pacing.maxClipMs)}).`)
  }

  c.clips = c.clips.map((k, i) => ({ ...k, transition: s.transitions.pattern === 'alternate' ? (i % 2 ? 'cut' : 'fade') : s.transitions.pattern }))
  c.fadeMs = s.transitions.fadeMs
  changes.push(s.transitions.pattern === 'cut' ? 'Cortes secos entre clips.' : s.transitions.pattern === 'fade' ? `Fundidos de ${s.transitions.fadeMs} ms.` : 'Fundido y corte alternos.')

  c.clips = c.clips.map(k => ({ ...k, motion: s.framing.motion, zoom: s.framing.zoom, ...(s.framing.focusY !== null ? { focusY: s.framing.focusY } : {}) }))
  if (s.framing.zoom > 1.02) changes.push(`Zoom ${s.framing.zoom.toFixed(2)}× en todos los clips.`)

  if (s.text.narrationAsText) {
    let n = 0
    c.clips = c.clips.map(k => (k.narration && !k.text?.content ? (n++, { ...k, text: { content: k.narration, position: s.text.position ?? 'bottom', sizePct: s.text.sizePct ?? 6 } }) : k))
    if (n) changes.push(`Narración como texto en pantalla en ${n} clips.`)
  }
  if (s.text.position) c.clips = c.clips.map(k => (k.text?.content ? { ...k, text: { ...k.text, position: s.text.position!, sizePct: s.text.sizePct ?? k.text.sizePct } } : k))

  const videos = c.clips.filter(k => kindOf(k.visualAssetId) === 'video').length
  c.clips = c.clips.map(k => (kindOf(k.visualAssetId) === 'video' ? { ...k, muted: s.clipAudio.muteVideo, volume: s.clipAudio.volume } : k))
  if (videos && s.clipAudio.muteVideo) changes.push(`Audio original silenciado en ${videos} vídeos.`)

  c.musicVolume = s.mix.musicVolume; c.duckMusic = s.mix.duckMusic; c.subtitles = s.mix.subtitles
  if (s.mix.hookMs && c.hookText) c.hookMs = s.mix.hookMs
  changes.push(`Música al ${Math.round(s.mix.musicVolume * 100)} %, subtítulos ${s.mix.subtitles ? 'sí' : 'no'}.`)

  if (s.sfxOnCuts) {
    const existing = new Set((c.audioClips ?? []).filter(a => a.kind === 'sfx' && a.assetId === s.sfxOnCuts!.assetId).map(a => a.linkedClipId))
    let n = 0
    for (const k of c.clips.slice(1)) {
      if (existing.has(k.id)) continue
      c = addAudioClip(c, { assetId: s.sfxOnCuts.assetId, kind: 'sfx', linkedClipId: k.id, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 1000, volume: s.sfxOnCuts.volume, muted: false })
      n++
    }
    if (n) changes.push(`Efecto de sonido en ${n} cortes.`)
  }
  c.editedManually = true
  return { composition: c, changes }
}

/** Short human description of what changed between two states (shown live while recording). */
export function describeChange(prev: Composition, next: Composition): string | null {
  if (next.clips.length > prev.clips.length) return 'Clip dividido o añadido'
  if (next.clips.length < prev.clips.length) return 'Clip eliminado'
  if ((next.audioClips?.length ?? 0) !== (prev.audioClips?.length ?? 0)) return 'Pista de audio modificada'
  if (next.clips.some((k, i) => prev.clips[i]?.id !== k.id)) return 'Clips reordenados'
  for (let i = 0; i < next.clips.length; i++) {
    const a = prev.clips[i], b = next.clips[i]
    if (a.durationMs !== b.durationMs || a.trimInMs !== b.trimInMs) return 'Duración o recorte'
    if (a.transition !== b.transition) return 'Transición'
    if (a.zoom !== b.zoom || a.focusX !== b.focusX || a.focusY !== b.focusY || a.motion !== b.motion) return 'Encuadre o zoom'
    if (JSON.stringify(a.text) !== JSON.stringify(b.text)) return 'Texto en pantalla'
    if (a.muted !== b.muted || a.volume !== b.volume) return 'Volumen del clip'
  }
  if (next.musicVolume !== prev.musicVolume || next.duckMusic !== prev.duckMusic || next.musicAssetId !== prev.musicAssetId) return 'Música'
  if (next.fadeMs !== prev.fadeMs) return 'Duración de fundidos'
  if (next.subtitles !== prev.subtitles || next.hookText !== prev.hookText) return 'Subtítulos o hook'
  return next !== prev ? 'Ajuste' : null
}
