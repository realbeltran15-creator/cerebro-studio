import { clipCaptions, clipStarts, type CaptionCue, type CueOrigin, type Clip, type Composition, cuesToSrt, cuesToVtt } from './composition'

/**
 * Subtitles: reading SRT and WebVTT files, putting their cues on the clips (timed captions replace the evenly spread narration), editing
 * them one by one, and writing SRT/VTT back. Pure functions; every change returns a new composition so it can be undone.
 */
export const MAX_CUES = 5000
export const MAX_CUE_CHARS = 300

export type ParsedSubtitles = { format: 'srt' | 'vtt'; cues: CaptionCue[]; warnings: string[] }

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&lrm;': '', '&rlm;': '' }
const clean = (t: string) => t.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp|lrm|rlm);/g, m => ENTITIES[m] ?? m).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()

/** «00:01:02,500», «01:02.500» or «1:02.5» → milliseconds, or null. */
function stamp(raw: string): number | null {
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(raw.trim())
  if (!m) return null
  const [, h, mi, s, f] = m
  if (Number(mi) > 59 || Number(s) > 59) return null
  return Number(h ?? 0) * 3_600_000 + Number(mi) * 60_000 + Number(s) * 1000 + (f ? Number(f.padEnd(3, '0')) : 0)
}

/** Reads an SRT or WebVTT text. Tolerant (BOM, CRLF, cue numbers, NOTE/STYLE blocks, cue settings, tags) but it reports what it had to drop. */
export function parseSubtitles(input: string): ParsedSubtitles {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  const vtt = /^WEBVTT/.test(text)
  const warnings: string[] = []
  const blocks = text.split(/\n{2,}/)
  const cues: CaptionCue[] = []
  let dropped = 0, bad = 0, notes = 0
  for (const block of blocks) {
    const lines = block.split('\n')
    if (/^WEBVTT/.test(lines[0])) { if (lines.length === 1) continue; lines.shift(); if (!lines.length) continue }
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) { notes++; continue }
    const ti = lines.findIndex(l => l.includes('-->'))
    if (ti < 0) { if (block.trim()) dropped++; continue }
    const [a, rest = ''] = lines[ti].split('-->')
    const start = stamp(a), end = stamp(rest.trim().split(/\s+/)[0] ?? '')
    const body = clean(lines.slice(ti + 1).join('\n'))
    if (start === null || end === null) { bad++; continue }
    if (end <= start) { dropped++; continue }
    if (!body) { dropped++; continue }
    cues.push({ startMs: start, endMs: end, text: body.slice(0, MAX_CUE_CHARS) })
  }
  cues.sort((x, y) => x.startMs - y.startMs || x.endMs - y.endMs)
  if (bad) warnings.push(`${bad} marca${bad === 1 ? '' : 's'} de tiempo con un formato que no se entiende (ignorada${bad === 1 ? '' : 's'}).`)
  if (dropped) warnings.push(`${dropped} bloque${dropped === 1 ? '' : 's'} sin texto o con el final antes del inicio (descartado${dropped === 1 ? '' : 's'}).`)
  if (cues.length > MAX_CUES) { warnings.push(`El archivo tiene ${cues.length} subtítulos; se leen los ${MAX_CUES} primeros.`); cues.length = MAX_CUES }
  const overlapping = cues.filter((q, i) => i > 0 && q.startMs < cues[i - 1].endMs).length
  if (overlapping) warnings.push(`${overlapping} subtítulo${overlapping === 1 ? '' : 's'} se solapa${overlapping === 1 ? '' : 'n'} con el anterior (se conservan; se verán uno sobre otro).`)
  void notes
  return { format: vtt ? 'vtt' : 'srt', cues, warnings }
}

export type ApplyCuesResult = { composition: Composition; assigned: number; outside: number; clipsWithCues: number; warnings: string[] }

/**
 * Puts timeline cues on the clips they overlap, re-timed to each clip's start (a cue crossing a cut is split in two so each half shows on its clip).
 * `shiftMs` moves the whole file (a positive value makes the captions appear later), for files that start at another point than the montage.
 */
export function applyCuesToComposition(input: Composition, cues: CaptionCue[], opts: { shiftMs?: number; /** Where these captions come from; kept on every cue through edits, saves and recoveries. */ origin?: CueOrigin; /** Default true: clips that get no cue lose their old narration text, so the file is the only source of captions. */ replace?: boolean } = {}): ApplyCuesResult {
  const shift = Math.round(opts.shiftMs ?? 0), starts = clipStarts(input)
  const total = input.clips.reduce((t, k) => t + k.durationMs, 0)
  const per = new Map<string, NonNullable<Clip['cues']>>()
  let assigned = 0
  const shifted = cues.map(q => ({ ...q, startMs: q.startMs + shift, endMs: q.endMs + shift })).filter(q => q.endMs > 0)
  for (const q of shifted) {
    let used = false
    input.clips.forEach((k, i) => {
      const s = starts[i], e = s + k.durationMs
      if (q.endMs <= s || q.startMs >= e) return
      const a = Math.max(q.startMs, s) - s, b = Math.min(q.endMs, e) - s
      if (b - a < 40) return
      const list = per.get(k.id) ?? []; list.push({ startMs: a, endMs: b, text: q.text, ...(opts.origin ? { origin: opts.origin } : {}) }); per.set(k.id, list); used = true
    })
    if (used) assigned++
  }
  const outside = shifted.filter(q => q.startMs >= total).length
  const clips = input.clips.map(k => (per.has(k.id) ? { ...k, cues: per.get(k.id)!.sort((x, y) => x.startMs - y.startMs).slice(0, 400) } : { ...k, cues: [] as NonNullable<Clip['cues']>, ...(opts.replace === false ? {} : { narration: null }) }))
  const warnings: string[] = []
  if (outside) warnings.push(`${outside} subtítulo${outside === 1 ? '' : 's'} empieza${outside === 1 ? '' : 'n'} después del final del montaje (${Math.round(total / 1000)} s) y no se ha podido colocar.`)
  if (!assigned && cues.length) warnings.push('Ningún subtítulo coincide con la duración del montaje. Prueba a desplazar el archivo.')
  return { composition: { ...input, clips, subtitles: true }, assigned, outside, clipsWithCues: per.size, warnings }
}

/** Makes every clip's captions explicit (the generated ones become real, editable cues). Clips that already have cues keep them. */
export function materializeCues(c: Composition): Composition {
  return { ...c, clips: c.clips.map(k => (k.cues ? k : { ...k, cues: clipCaptions(k).map(q => ({ startMs: Math.round(q.startMs), endMs: Math.round(q.endMs), text: q.text })) })) }
}

export type CueRef = { clipId: string; index: number }

/** Edits one cue of a clip. Times are relative to the clip and are kept inside it; an invalid result (end ≤ start) is ignored. */
export function editCue(input: Composition, ref: CueRef, patch: Partial<CaptionCue>): Composition {
  const c = materializeCues(input)
  return { ...c, clips: c.clips.map(k => {
    if (k.id !== ref.clipId || !k.cues?.[ref.index]) return k
    const cur = k.cues[ref.index]
    const next = { text: (patch.text ?? cur.text).slice(0, MAX_CUE_CHARS), startMs: Math.max(0, Math.round(patch.startMs ?? cur.startMs)), endMs: Math.min(k.durationMs, Math.round(patch.endMs ?? cur.endMs)), ...(cur.origin ? { origin: cur.origin === 'auto' ? 'auto-edited' as const : cur.origin } : {}) }
    if (!next.text.trim() || next.endMs - next.startMs < 100) return k
    const cues = k.cues.map((q, i) => (i === ref.index ? next : q)).sort((x, y) => x.startMs - y.startMs)
    return { ...k, cues }
  }) }
}

export function deleteCue(input: Composition, ref: CueRef): Composition {
  const c = materializeCues(input)
  return { ...c, clips: c.clips.map(k => (k.id === ref.clipId && k.cues?.[ref.index] ? { ...k, cues: k.cues.filter((_, i) => i !== ref.index) } : k)) }
}

/** Every caption with the clip it belongs to and its absolute time, in order: what the subtitle list shows. */
export function captionList(c: Composition): Array<CueRef & CaptionCue & { origin?: CueOrigin; clipIndex: number; relStartMs: number; relEndMs: number }> {
  const starts = clipStarts(c)
  return c.clips.flatMap((k, ci) => clipCaptions(k).map((q, index) => ({ clipId: k.id, index, clipIndex: ci, relStartMs: Math.round(q.startMs), relEndMs: Math.round(q.endMs), startMs: Math.round(starts[ci] + q.startMs), endMs: Math.round(starts[ci] + q.endMs), text: q.text, ...(k.cues?.[index]?.origin ? { origin: k.cues[index].origin } : {}) })))
}

export const exportSubtitles = (c: Composition, format: 'srt' | 'vtt') => { const cues = captionList(c).map(({ startMs, endMs, text }) => ({ startMs, endMs, text })); return format === 'srt' ? cuesToSrt(cues) : cuesToVtt(cues) }

export const ESTIMATED_TIMING_WARNING = 'Tiempos ESTIMADOS: el texto no traía marcas de tiempo, así que se repartieron por longitud sobre la duración del montaje. No son tiempos detectados: ajústalos a la voz real.'

/**
 * Turns a pasted transcript WITHOUT timestamps into cues spread over `totalMs` in proportion to each chunk's length.
 * Sentences are kept whole when they are short and cut into chunks of at most `maxWords` words when long. Pure and deterministic.
 * The result is clearly flagged as estimated (a warning the UI shows) because nothing here is detected from the audio.
 */
export function estimateCuesFromText(input: string, totalMs: number, maxWords = 10): ParsedSubtitles {
  const text = input.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
  const warnings = [ESTIMATED_TIMING_WARNING]
  if (!text || !(totalMs > 0)) return { format: 'srt', cues: [], warnings: ['No hay texto que repartir o el montaje no tiene duración.'] }
  const sentences = text.split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(Boolean)
  const chunks: string[] = []
  for (const s of sentences) {
    const words = s.split(/\s+/)
    if (words.length <= maxWords) { chunks.push(s); continue }
    const parts = Math.ceil(words.length / maxWords), size = Math.ceil(words.length / parts)
    for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(' '))
  }
  let kept = chunks.map(t => t.slice(0, MAX_CUE_CHARS))
  if (kept.length > MAX_CUES) { warnings.push(`El texto tiene demasiados fragmentos: se usaron los primeros ${MAX_CUES}.`); kept = kept.slice(0, MAX_CUES) }
  const weight = kept.map(t => Math.max(8, t.length)), sum = weight.reduce((a, b) => a + b, 0)
  const cues: CaptionCue[] = []
  let at = 0
  kept.forEach((t, i) => {
    const end = i === kept.length - 1 ? totalMs : Math.min(totalMs, at + Math.round(totalMs * weight[i] / sum))
    if (end > at) cues.push({ startMs: at, endMs: end, text: t })
    at = end
  })
  return { format: 'srt', cues, warnings }
}

/** Files written by scripts/transcribe-local.mjs end in this suffix so the editor can tell machine output from hand-made subtitles. */
export const AUTO_SUBTITLE_SUFFIX = '.auto.srt'
export const AUTO_SUBTITLE_NOTICE = 'Subtítulos GENERADOS AUTOMÁTICAMENTE en tu equipo (sin enviar el audio a ningún servicio). Pueden tener errores: revísalos y corrígelos antes de exportar.'
export const isAutoSubtitleFile = (name: string) => name.toLowerCase().endsWith(AUTO_SUBTITLE_SUFFIX)

export const ORIGIN_LABEL: Record<CueOrigin, string> = { auto: 'Automático, sin revisar', 'auto-edited': 'Automático, revisado/corregido', manual: 'Manual', imported: 'Importado de SRT/VTT' }

/** Counts per origin («none» = older projects or text spread from the narration). An .auto.srt is only «reviewed» when no cue is left in `auto`. */
export function originSummary(c: Composition): Record<CueOrigin | 'none', number> {
  const out = { auto: 0, 'auto-edited': 0, manual: 0, imported: 0, none: 0 }
  for (const k of c.clips) for (const q of k.cues ?? []) out[q.origin ?? 'none']++
  return out
}

/** The person checked this automatic caption (even without changing it): it stops counting as «sin revisar». */
export function markCueReviewed(input: Composition, ref: CueRef): Composition {
  return { ...input, clips: input.clips.map(k => (k.id === ref.clipId && k.cues?.[ref.index]?.origin === 'auto' ? { ...k, cues: k.cues.map((q, i) => (i === ref.index ? { ...q, origin: 'auto-edited' as const } : q)) } : k)) }
}
