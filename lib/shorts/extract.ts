import { emptyComposition, type CaptionStyle, type Composition } from '@/lib/editor/composition'

/**
 * Finds Short-sized moments inside a long video from its transcript (Biblioteca → «Transcribir»). Heuristic, explainable and free: it does not
 * call any AI and it does not «know» what is viral. Each candidate starts and ends on transcript segment boundaries (complete phrases), lasts
 * between the min and max length, and is scored by what usually holds a viewer in the first seconds:
 *   + an opening hook (question, number, «secret / nobody / why / how…» words), a complete sentence at the end, a steady speech rate;
 *   − opening on a connective («and», «but», «so», «y», «pero»…) that needs earlier context, long silences inside the window.
 * The best non-overlapping windows are returned with the reasons that produced their score.
 */
export type TranscriptSegment = { start: number; end: number; text: string }
export type ShortCandidate = { startMs: number; endMs: number; score: number; reasons: string[]; hook: string; text: string }
export type ExtractOptions = { minS?: number; maxS?: number; count?: number }

const HOOK_WORDS = ['secreto', 'secret', 'nadie', 'nobody', 'nunca', 'never', 'por qué', 'why', 'cómo', 'how', 'qué pasa', 'what happens', 'increíble', 'incredible', 'error', 'mistake', 'verdad', 'truth', 'nadie sabe', 'nobody knows', 'lo que', 'the reason', 'la razón', 'imagina', 'imagine', 'sabías', 'did you know', 'primero', 'first', 'nunca más', 'peor', 'worst', 'mejor', 'best']
const CONNECTIVES = /^(y|e|pero|entonces|así que|o sea|bueno|and|but|so|then|because|porque|además|also)\b/i

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean)
const clean = (t: string) => t.replace(/\s+/g, ' ').trim()

function hookScore(first: string): { score: number; why: string[] } {
  const t = first.toLowerCase(), why: string[] = []
  let score = 0
  if (/[?¿]/.test(first)) { score += 2; why.push('empieza con una pregunta') }
  if (/\d/.test(first)) { score += 1; why.push('cifra en la primera frase') }
  const hw = HOOK_WORDS.filter(w => t.includes(w))
  if (hw.length) { score += Math.min(2, hw.length); why.push(`gancho: «${hw.slice(0, 2).join('», «')}»`) }
  if (CONNECTIVES.test(first.trim())) { score -= 2; why.push('arranca con un conector (necesita contexto previo)') }
  return { score, why }
}

export function extractShortCandidates(segments: TranscriptSegment[], opts: ExtractOptions = {}): ShortCandidate[] {
  const minS = opts.minS ?? 20, maxS = opts.maxS ?? 58, count = opts.count ?? 3
  const segs = segments.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && clean(s.text)).sort((a, b) => a.start - b.start)
  const all: ShortCandidate[] = []
  for (let i = 0; i < segs.length; i++) {
    for (let j = i; j < segs.length; j++) {
      const dur = segs[j].end - segs[i].start
      if (dur > maxS) break
      if (dur < minS) continue
      const window = segs.slice(i, j + 1)
      const text = clean(window.map(s => s.text).join(' '))
      const reasons: string[] = []
      let score = 0
      const h = hookScore(window[0].text); score += h.score; reasons.push(...h.why)
      if (/[.!?…]["»”']?$/.test(text)) { score += 1; reasons.push('termina con una frase completa') } else { score -= 1; reasons.push('termina a mitad de frase') }
      const wps = words(text).length / Math.max(dur, 1)
      if (wps >= 1.8 && wps <= 3.6) { score += 1; reasons.push(`ritmo de habla constante (${wps.toFixed(1)} palabras/s)`) } else if (wps < 1.2) { score -= 1; reasons.push('poca voz en el tramo') }
      const gaps = window.slice(1).map((s, k) => s.start - window[k].end).filter(g => g > 1.5)
      if (gaps.length) { score -= gaps.length; reasons.push(`${gaps.length} silencio${gaps.length > 1 ? 's' : ''} de más de 1,5 s`) }
      // Prefer the classic 30–45 s length slightly.
      if (dur >= 30 && dur <= 45) score += 0.5
      all.push({ startMs: Math.round(segs[i].start * 1000), endMs: Math.round(segs[j].end * 1000), score: Math.round(score * 10) / 10, reasons, hook: clean(window[0].text).slice(0, 80), text })
    }
  }
  const picked: ShortCandidate[] = []
  for (const c of all.sort((a, b) => b.score - a.score || a.startMs - b.startMs)) {
    if (picked.length >= count) break
    if (picked.some(p => c.startMs < p.endMs && p.startMs < c.endMs)) continue
    picked.push(c)
  }
  return picked.sort((a, b) => a.startMs - b.startMs)
}

/** A 9:16 composition that plays the chosen window of the source video, with the window's transcript as captions and its first line as hook. */
/** Transcript segments inside the window, re-timed to the clip and split into readable lines (max 10 words, proportional timing). */
export function windowCues(segments: TranscriptSegment[], c: Pick<ShortCandidate, 'startMs' | 'endMs'>, maxWords = 10) {
  const dur = c.endMs - c.startMs
  return segments.filter(s => s.end * 1000 > c.startMs && s.start * 1000 < c.endMs && clean(s.text)).flatMap(s => {
    const from = Math.max(0, s.start * 1000 - c.startMs), to = Math.min(dur, s.end * 1000 - c.startMs)
    const w = words(clean(s.text)), parts: string[] = []
    for (let i = 0; i < w.length; i += maxWords) parts.push(w.slice(i, i + maxWords).join(' '))
    let at = from
    return parts.map(p => { const len = ((to - from) * p.split(' ').length) / w.length; const cue = { startMs: Math.round(at), endMs: Math.round(at + len), text: p }; at += len; return cue })
  }).filter(q => q.endMs > q.startMs)
}

/** Ready-made Short styles: subtitle look, words per subtitle, opening hook and default framing. */
export type ShortTemplate = { id: string; name: string; description: string; captionStyle: CaptionStyle; maxWords: number; hook: boolean; zoom: number }
export const SHORT_TEMPLATES: ShortTemplate[] = [
  { id: 'dinamico', name: 'Dinámico', description: 'Subtítulos grandes palabra a palabra y gancho al inicio (estilo Shorts/TikTok).', captionStyle: 'karaoke', maxWords: 3, hook: true, zoom: 1 },
  { id: 'impacto', name: 'Impacto', description: 'Frases cortas en negrita, gancho y un ligero zoom para dar energía.', captionStyle: 'bold', maxWords: 4, hook: true, zoom: 1.08 },
  { id: 'documental', name: 'Documental', description: 'Subtítulos clásicos en caja, sin gancho: sobrio y legible.', captionStyle: 'box', maxWords: 10, hook: false, zoom: 1 },
]
export type ShortOptions = { template?: ShortTemplate; /** Horizontal framing when a 16:9 source is cut to 9:16: 0 left · 0.5 centre · 1 right. */ focusX?: number }

export function shortComposition(videoAssetId: string, c: ShortCandidate, title: string, segments: TranscriptSegment[] = [], opts: ShortOptions = {}): Composition {
  const t = opts.template
  const comp = { ...emptyComposition(`short-${globalThis.crypto.randomUUID()}`, title.slice(0, 120), '9:16'), editedManually: true }
  comp.clips = [{ id: globalThis.crypto.randomUUID(), sceneId: `short-${c.startMs}`, position: 1, narration: c.text, visualAssetId: videoAssetId, voiceAssetId: null, durationMs: c.endMs - c.startMs, motion: 'none', trimInMs: c.startMs, transition: 'cut',
    focusX: Math.min(1, Math.max(0, opts.focusX ?? 0.5)), focusY: 0.5, zoom: t?.zoom ?? 1,
    ...(segments.length ? { cues: windowCues(segments, c, t?.maxWords ?? 10) } : {}) }]
  comp.subtitles = true
  comp.captionStyle = t?.captionStyle ?? 'box'
  comp.fadeMs = 0
  comp.hookText = t && !t.hook ? null : c.hook.slice(0, 60)
  comp.hookMs = 2500
  return comp
}

/**
 * Estimated viral potential 0-100 of a candidate, from signals in its own transcript: hook, complete ending, pace, silences, length,
 * plus intensity (exclamations, direct address, superlatives, numbers). It is a heuristic to rank moments, NOT a prediction of views.
 */
export type Potential = { score: number; label: 'alto' | 'medio' | 'bajo'; factors: Array<{ name: string; points: number }> }
export function viralPotential(c: ShortCandidate): Potential {
  const factors: Array<{ name: string; points: number }> = []
  const base = Math.round(Math.min(60, Math.max(0, (c.score + 3) * 7)))
  factors.push({ name: 'gancho, final, ritmo y silencios', points: base })
  const t = c.text.toLowerCase()
  const excl = (c.text.match(/[!¡]/g) ?? []).length
  if (excl) factors.push({ name: 'exclamaciones', points: Math.min(8, excl * 3) })
  if (/(?<!\p{L})(tú|tu|te|usted|you|your)(?!\p{L})/u.test(t)) factors.push({ name: 'habla directamente al espectador', points: 8 })
  if (/(?<!\p{L})(más|mayor|peor|mejor|nunca|jamás|única?|most|best|worst|never|only)(?!\p{L})/u.test(t)) factors.push({ name: 'superlativos o absolutos', points: 6 })
  if (/\d/.test(c.text)) factors.push({ name: 'cifras concretas', points: 6 })
  const dur = (c.endMs - c.startMs) / 1000
  if (dur >= 25 && dur <= 45) factors.push({ name: 'duración ideal (25–45 s)', points: 8 })
  if (/[?¿]/.test(c.hook)) factors.push({ name: 'arranca con una pregunta', points: 4 })
  const score = Math.min(100, factors.reduce((a, f) => a + f.points, 0))
  return { score, label: score >= 65 ? 'alto' : score >= 40 ? 'medio' : 'bajo', factors }
}
