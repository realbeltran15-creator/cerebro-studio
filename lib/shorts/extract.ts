import { emptyComposition, type Composition } from '@/lib/editor/composition'

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
export function shortComposition(videoAssetId: string, c: ShortCandidate, title: string): Composition {
  const comp = { ...emptyComposition(`short-${globalThis.crypto.randomUUID()}`, title.slice(0, 120), '9:16'), editedManually: true }
  comp.clips = [{ id: globalThis.crypto.randomUUID(), sceneId: `short-${c.startMs}`, position: 1, narration: c.text, visualAssetId: videoAssetId, voiceAssetId: null, durationMs: c.endMs - c.startMs, motion: 'none', trimInMs: c.startMs, transition: 'cut' }]
  comp.subtitles = true
  comp.fadeMs = 0
  comp.hookText = c.hook.slice(0, 60)
  comp.hookMs = 2500
  return comp
}
