import { ORIGINALITY } from './types'

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const words = (t: string) => fold(t).split(' ').filter(Boolean)

/** Fraction of the candidate's n-grams (n words in a row) that also appear in the source. 0 = nothing repeated. */
export function ngramOverlap(candidate: string, source: string, n = 4): number {
  const c = words(candidate), s = words(source)
  if (c.length < n || s.length < n) return 0
  const have = new Set<string>()
  for (let i = 0; i + n <= s.length; i++) have.add(s.slice(i, i + n).join(' '))
  let total = 0, hit = 0
  for (let i = 0; i + n <= c.length; i++) { total++; if (have.has(c.slice(i, i + n).join(' '))) hit++ }
  return total ? hit / total : 0
}

export function titleSimilarity(a: string, b: string): number {
  const A = new Set(words(a).filter(w => w.length > 2)), B = new Set(words(b).filter(w => w.length > 2))
  if (!A.size || !B.size) return 0
  const inter = [...A].filter(w => B.has(w)).length
  return inter / (A.size + B.size - inter)
}

export type OriginalityReport = { narrationOverlap: number; titleSimilarity: number; ok: boolean; problems: string[] }

/** The recreation must keep the structure, not the words: both measures are checked against the reference. */
export function checkOriginality(plan: { title: string; scenes: Array<{ narration: string }> }, ref: { spokenText: string; title?: string | null }): OriginalityReport {
  const narrationOverlap = ngramOverlap(plan.scenes.map(s => s.narration).join(' '), ref.spokenText)
  const sim = ref.title ? titleSimilarity(plan.title, ref.title) : 0
  const problems: string[] = []
  if (narrationOverlap > ORIGINALITY.maxNarrationOverlap) problems.push(`La narración repite ${Math.round(narrationOverlap * 100)} % de las frases del vídeo de referencia (máximo ${ORIGINALITY.maxNarrationOverlap * 100} %): reescribe con otras palabras y otra situación.`)
  if (sim > ORIGINALITY.maxTitleSimilarity) problems.push('El título es casi igual al del vídeo de referencia: cámbialo.')
  return { narrationOverlap: Math.round(narrationOverlap * 1000) / 1000, titleSimilarity: Math.round(sim * 1000) / 1000, ok: problems.length === 0, problems }
}
