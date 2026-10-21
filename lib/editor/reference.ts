import { detectShots, findSilences } from './auto-edit'
import type { BeatResult } from './beats'
import { alignmentOfTimes } from './sync'
import type { EditStyle } from './style'

/**
 * Reference videos: a video the owner already has, analysed ON THIS DEVICE for the editing habits that can be MEASURED in it (how often it cuts, how
 * long its shots last, how loud and how silent it is, whether the cuts follow the music). Only numbers leave the analysis: no frame, no audio, no text,
 * no file name is stored, so nothing of the video itself is copied. It is an aid to edit with a similar rhythm, not a way to reproduce someone's work.
 */
export type ReferenceInput = {
  label: string
  durationMs: number
  /** Mean frame-to-frame difference sampled at `fps` (see detectShots). */
  diffs: number[]
  fps: number
  /** Loudness per window (RMS), if the video has audio. */
  rms?: number[]
  rmsWindowMs?: number
  beats?: BeatResult | null
  width?: number
  height?: number
  hasAudio?: boolean
}

export type ReferenceMetrics = {
  version: 1
  label: string
  analyzedAt: string
  durationMs: number
  shots: { count: number; medianMs: number; p10Ms: number; p90Ms: number; minMs: number; maxMs: number; cutsPerMinute: number; cutsInFirst3s: number; accelerating: boolean | null }
  motion: { meanFrameDifference: number }
  audio: { hasAudio: boolean; silenceShare: number | null; dynamicRangeDb: number | null; bpm: number | null; bpmConfidence: number | null; cutsOnBeatShare: number | null }
  video: { width: number | null; height: number | null; aspect: '16:9' | '9:16' | '1:1' | 'otro' | null }
  /** The cut times (ms), capped, so the rhythm can be drawn and compared. Numbers only. */
  cutsMs: number[]
  notes: string[]
}

const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] }
const round = (n: number, step = 1) => Math.round(n / step) * step
const aspectOf = (w?: number, h?: number): ReferenceMetrics['video']['aspect'] => {
  if (!w || !h) return null
  const r = w / h
  return Math.abs(r - 16 / 9) < 0.08 ? '16:9' : Math.abs(r - 9 / 16) < 0.05 ? '9:16' : Math.abs(r - 1) < 0.05 ? '1:1' : 'otro'
}

export function measureReference(i: ReferenceInput, now = new Date()): ReferenceMetrics {
  const cutsMs = detectShots(i.diffs, i.fps, 3, 300)
  const bounds = [0, ...cutsMs, i.durationMs]
  const shots = bounds.slice(1).map((b, k) => b - bounds[k]).filter(d => d > 0)
  const minutes = Math.max(i.durationMs / 60000, 1 / 60)
  const half = i.durationMs / 2
  const first = shots.filter((_, k) => bounds[k] < half), second = shots.filter((_, k) => bounds[k] >= half)
  const accelerating = cutsMs.length >= 6 && first.length >= 3 && second.length >= 3 ? q(second, 0.5) < 0.85 * q(first, 0.5) : null
  const rms = i.rms ?? [], win = i.rmsWindowMs ?? 50
  const silent = rms.length ? findSilences(rms, win, 0.06, 600).reduce((t, s) => t + s.end - s.start, 0) : null
  const loud = rms.filter(v => v > 0)
  const dyn = loud.length >= 20 && q(loud, 0.1) > 0 ? Math.round(20 * Math.log10(q(loud, 0.95) / q(loud, 0.1)) * 10) / 10 : null
  const align = i.beats?.beatsMs.length && cutsMs.length >= 3 ? alignmentOfTimes(cutsMs, i.beats.beatsMs, 120) : null
  const mean = i.diffs.length ? i.diffs.reduce((t, x) => t + x, 0) / i.diffs.length : 0
  const notes = [
    `Cortes detectados por cambio brusco de imagen, con ${i.fps} lecturas por segundo: los fundidos suaves y los cortes en menos de ${Math.round(1000 / i.fps)} ms pueden no verse.`,
    'Solo se guardan números (duración de los planos, ritmo, volumen). No se guarda ningún fotograma, audio, texto ni el nombre del archivo.',
    ...(i.beats && i.beats.confidence < 0.2 ? ['La música o el audio no tiene un pulso claro: no se puede decir si los cortes lo siguen.'] : []),
  ]
  return {
    version: 1, label: i.label.trim().slice(0, 60) || 'Referencia', analyzedAt: now.toISOString(), durationMs: Math.round(i.durationMs),
    shots: { count: shots.length, medianMs: round(q(shots, 0.5), 10), p10Ms: round(q(shots, 0.1), 10), p90Ms: round(q(shots, 0.9), 10), minMs: shots.length ? Math.min(...shots) : 0, maxMs: shots.length ? Math.max(...shots) : 0,
      cutsPerMinute: Math.round(cutsMs.length / minutes * 10) / 10, cutsInFirst3s: cutsMs.filter(t => t <= 3000).length, accelerating },
    motion: { meanFrameDifference: Math.round(mean * 1000) / 1000 },
    audio: { hasAudio: i.hasAudio ?? rms.length > 0, silenceShare: silent === null || !i.durationMs ? null : Math.round(silent / i.durationMs * 100) / 100, dynamicRangeDb: dyn,
      bpm: i.beats?.bpm ?? null, bpmConfidence: i.beats ? i.beats.confidence : null, cutsOnBeatShare: align?.share === null || !align ? null : Math.round(align.share * 100) / 100 },
    video: { width: i.width ?? null, height: i.height ?? null, aspect: aspectOf(i.width, i.height) },
    cutsMs: cutsMs.slice(0, 600),
    notes,
  }
}

const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`

/**
 * An editing style built from the measurements of a reference. Only what was measured becomes a habit; everything else keeps neutral defaults,
 * and the observations say which is which. The result is a normal style: it is saved, applied and merged exactly like the ones learned from the owner.
 */
export function referenceToStyle(m: ReferenceMetrics, name = `Referencia · ${m.label}`): EditStyle {
  const median = Math.max(500, m.shots.medianMs), min = Math.max(500, Math.min(m.shots.p10Ms || median, median)), max = Math.max(median, m.shots.p90Ms || median)
  const onBeat = m.audio.cutsOnBeatShare !== null && m.audio.cutsOnBeatShare >= 0.5 && (m.audio.bpmConfidence ?? 0) >= 0.2
  const obs = [
    `Planos de ${secs(min)} a ${secs(max)} (mediana ${secs(median)}), ${m.shots.cutsPerMinute} cortes por minuto${m.shots.accelerating ? '; el ritmo se acelera hacia el final' : ''}.`,
    `Hay ${m.shots.cutsInFirst3s} corte${m.shots.cutsInFirst3s === 1 ? '' : 's'} en los 3 primeros segundos.`,
    'Cortes secos (los fundidos no se miden en la referencia).',
    ...(onBeat ? [`Los cortes siguen el pulso de la música (${Math.round((m.audio.cutsOnBeatShare ?? 0) * 100)} % en pulso, ${m.audio.bpm} BPM).`] : m.audio.cutsOnBeatShare !== null ? [`Los cortes no siguen el pulso de la música (${Math.round(m.audio.cutsOnBeatShare * 100)} % en pulso).`] : []),
    ...(m.audio.silenceShare !== null ? [`${Math.round(m.audio.silenceShare * 100)} % del audio es silencio (solo informativo; no se aplica).`] : []),
    'No medido en una referencia: zoom, textos, volúmenes de mezcla y efectos de sonido (se dejan en sus valores neutros).',
  ]
  return {
    version: 1, name: name.slice(0, 40), samples: 1, learnedAt: m.analyzedAt, format: m.video.aspect === '16:9' || m.video.aspect === '9:16' || m.video.aspect === '1:1' ? m.video.aspect : null,
    pacing: { medianClipMs: round(median, 100), minClipMs: round(min, 100), maxClipMs: round(max, 100), splitLong: true, retime: true },
    transitions: { pattern: 'cut', fadeMs: 300 },
    framing: { motion: 'none', zoom: 1, focusY: null },
    text: { narrationAsText: false, position: null, sizePct: null },
    clipAudio: { muteVideo: false, volume: 1 },
    mix: { musicVolume: 0.25, duckMusic: true, subtitles: true, hookMs: null },
    sfxOnCuts: null,
    ...(onBeat ? { sync: { snapToBeats: true, toleranceMs: 150 } } : {}),
    source: 'referencia',
    observations: obs,
  }
}
