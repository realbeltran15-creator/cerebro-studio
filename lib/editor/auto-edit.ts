/**
 * Automatic edit ("montaje automático"): turns raw footage into a cut edit without AI calls.
 * Pure planning functions (tested); the browser measures the signals in analyze.ts:
 *  - silences from the audio loudness (RMS) → removed (jump cuts), keeping a little padding;
 *  - shot changes from frame differences → cut points (a new clip starts at each shot);
 *  - long takes split to a maximum length to keep the pace.
 * The result is a normal composition: it opens in the manual editor and can take a learned style.
 */
import { emptyComposition, MAX_CLIP_MS, MIN_CLIP_MS, type Clip, type Composition, type OutputFormat } from './composition'

export type Interval = { start: number; end: number }
export type AutoEditOptions = {
  removeSilences: boolean
  /** Below this loudness (0..1 RMS, relative to the loudest window) a window counts as silent. */
  silenceThreshold: number
  minSilenceMs: number
  paddingMs: number
  cutOnShots: boolean
  maxClipMs: number
  minClipMs: number
  transition: 'cut' | 'fade' | 'fade_on_shots'
  format: OutputFormat
}

export const defaultAutoEdit: AutoEditOptions = { removeSilences: true, silenceThreshold: 0.06, minSilenceMs: 600, paddingMs: 150, cutOnShots: true, maxClipMs: 6000, minClipMs: 700, transition: 'fade_on_shots', format: '9:16' }

/** Silent intervals (ms) from RMS windows of `windowMs`. Threshold is relative to the loudest window. */
export function findSilences(rms: number[], windowMs: number, threshold: number, minSilenceMs: number): Interval[] {
  const peak = Math.max(1e-6, ...rms)
  const out: Interval[] = []
  let start = -1
  rms.forEach((v, i) => {
    const silent = v / peak < threshold
    if (silent && start < 0) start = i
    if ((!silent || i === rms.length - 1) && start >= 0) {
      const end = silent ? i + 1 : i
      if ((end - start) * windowMs >= minSilenceMs) out.push({ start: start * windowMs, end: end * windowMs })
      start = -1
    }
  })
  return out
}

/** Shot boundaries (ms) from mean absolute frame differences sampled at `fps`: peaks well above the local level. */
export function detectShots(diffs: number[], fps: number, sensitivity = 3, minGapMs = 800): number[] {
  if (diffs.length < 3) return []
  // Robust level (median + MAD): a few hard cuts must not raise the bar for the others.
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  const m = med(diffs)
  const spread = Math.max(0.02, 1.4826 * med(diffs.map(d => Math.abs(d - m))))
  const level = Math.max(0.08, m + sensitivity * spread)
  const cuts: number[] = []
  diffs.forEach((d, i) => {
    const t = Math.round(((i + 1) / fps) * 1000)
    if (d > level && (!cuts.length || t - cuts[cuts.length - 1] >= minGapMs)) cuts.push(t)
  })
  return cuts
}

/** Kept intervals = whole video minus silences (with padding), then cut at shots and split to max length. */
export function planSegments(durationMs: number, silences: Interval[], shots: number[], o: Pick<AutoEditOptions, 'removeSilences' | 'paddingMs' | 'cutOnShots' | 'maxClipMs' | 'minClipMs'>): Array<Interval & { shotStart: boolean }> {
  let keep: Interval[] = [{ start: 0, end: durationMs }]
  if (o.removeSilences) {
    keep = []
    let t = 0
    for (const s of [...silences].sort((a, b) => a.start - b.start)) {
      const cutStart = Math.min(durationMs, s.start + o.paddingMs), cutEnd = Math.max(0, s.end - o.paddingMs)
      if (cutEnd - cutStart <= 0) continue
      if (cutStart > t) keep.push({ start: t, end: cutStart })
      t = Math.max(t, cutEnd)
    }
    if (t < durationMs) keep.push({ start: t, end: durationMs })
    // Short utterances are kept (never dropped): stretch them to the minimum clip length, merging overlaps.
    const grown: Interval[] = []
    for (const k of keep) {
      const g = { start: k.start, end: Math.min(durationMs, Math.max(k.end, k.start + MIN_CLIP_MS)) }
      const last = grown[grown.length - 1]
      if (last && g.start <= last.end) last.end = Math.max(last.end, g.end); else grown.push(g)
    }
    keep = grown
  }
  const out: Array<Interval & { shotStart: boolean }> = []
  for (const k of keep) {
    const points = o.cutOnShots ? shots.filter(s => s > k.start + o.minClipMs && s < k.end - o.minClipMs) : []
    const bounds = [k.start, ...points, k.end]
    for (let i = 0; i < bounds.length - 1; i++) {
      let a = bounds[i]
      const b = bounds[i + 1]
      const pieces = Math.max(1, Math.ceil((b - a) / Math.min(o.maxClipMs, MAX_CLIP_MS)))
      const len = (b - a) / pieces
      for (let p = 0; p < pieces; p++) {
        const end = p === pieces - 1 ? b : a + len
        if (end - a >= Math.max(o.minClipMs, MIN_CLIP_MS)) out.push({ start: Math.round(a), end: Math.round(end), shotStart: p === 0 && i > 0 })
        a = end
      }
    }
  }
  return out
}

/** Builds the composition: one clip per segment of the source video, with optional subtitle text per segment. */
export function autoComposition(input: { assetId: string; title: string; segments: Array<Interval & { shotStart: boolean }>; options: AutoEditOptions; captions?: Array<{ start: number; end: number; text: string }>; musicAssetId?: string | null }): Composition {
  const c = emptyComposition(`auto:${input.assetId}`, input.title, input.options.format)
  c.clips = input.segments.map((s, i): Clip => {
    const next = input.segments[i + 1]
    const text = (input.captions ?? []).filter(k => k.end > s.start && k.start < s.end).map(k => k.text).join(' ').trim()
    return {
      id: `auto-${i + 1}`, sceneId: 'auto', position: i + 1, narration: text || null, visualAssetId: input.assetId, voiceAssetId: null,
      durationMs: s.end - s.start, trimInMs: s.start, motion: 'none', focusX: 0.5, focusY: 0.5, zoom: 1, volume: 1, muted: false, text: null,
      transition: input.options.transition === 'cut' ? 'cut' : input.options.transition === 'fade' ? 'fade' : next?.shotStart ? 'fade' : 'cut',
    }
  })
  c.subtitles = Boolean(input.captions?.length)
  c.musicAssetId = input.musicAssetId ?? null
  c.musicVolume = 0.15
  c.duckMusic = true
  c.fadeMs = 250
  c.editedManually = true
  return c
}

export function summarize(durationMs: number, segments: Interval[]) {
  const kept = segments.reduce((a, s) => a + s.end - s.start, 0)
  return { kept, removed: Math.max(0, durationMs - kept), clips: segments.length }
}
