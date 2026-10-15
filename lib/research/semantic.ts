import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { stopwords } from '@/lib/radar'
import { fold, type Assessment } from './relevance'

/**
 * Local, deterministic semantic evidence (TF-IDF vectors + cosine similarity, no model, no network, no cost per video).
 * It only helps with videos the word rules could not decide («dudoso»): each is compared with the videos whose meaning WAS confirmed
 * by explicit words, and with the ones rejected for having another meaning. It needs at least 3 seeds on a side to say anything, and
 * a clear margin; otherwise the video stays «dudoso». It can promote a doubtful video to accepted, or reject it as another meaning,
 * and it always quotes the similarity it used so the decision can be checked in the sample inspector.
 */
const MIN_SEEDS = 3, MIN_SIMILARITY = 0.2, MARGIN = 0.08, MIN_TOKENS = 3, MAX_DOC_SHARE = 0.8

const words = (v: YouTubeVideoResult, skip: Set<string>) => fold([v.title, ...(v.tags ?? []).slice(0, 12), (v.description ?? '').slice(0, 400), v.channelTitle].join(' ')).split(' ')
  .filter(w => w.length >= 3 && !stopwords.has(w) && !/^\d+$/.test(w) && !skip.has(w))

type Vec = Map<string, number>
const norm = (m: Vec) => { const n = Math.sqrt([...m.values()].reduce((t, x) => t + x * x, 0)); if (n) for (const [k, x] of m) m.set(k, x / n); return m }
const cosine = (a: Vec, b: Vec) => { let d = 0; const [s, l] = a.size < b.size ? [a, b] : [b, a]; for (const [k, x] of s) d += x * (l.get(k) ?? 0); return d }
const centroid = (vs: Vec[], skip?: Vec) => { const c: Vec = new Map(); let n = 0; for (const v of vs) { if (v === skip) continue; n++; for (const [k, x] of v) c.set(k, (c.get(k) ?? 0) + x) } return { c: norm(c), n } }

export function resolveDoubtful(all: YouTubeVideoResult[], verdicts: Map<string, Assessment>, queryTerms: string[]): Map<string, Assessment> {
  const doubtful = all.filter(v => verdicts.get(v.videoId)?.status === 'dudoso')
  if (!doubtful.length) return verdicts
  const skip = new Set(queryTerms.flatMap(t => fold(t).split(' ')))
  const docs = new Map(all.map(v => [v.videoId, words(v, skip)]))
  const df = new Map<string, number>(); for (const ws of docs.values()) for (const w of new Set(ws)) df.set(w, (df.get(w) ?? 0) + 1)
  const N = all.length
  // Words present in more than half of the videos (boilerplate, the topic itself) say nothing about meaning and are ignored.
  const informative = (w: string) => N < 10 || (df.get(w) ?? 0) / N <= MAX_DOC_SHARE
  const vec = new Map<string, Vec>(all.map(v => { const tf = new Map<string, number>(); for (const w of docs.get(v.videoId)!.filter(informative)) tf.set(w, (tf.get(w) ?? 0) + 1); const m: Vec = new Map(); for (const [w, c] of tf) m.set(w, (1 + Math.log(c)) * Math.log(1 + N / (df.get(w) ?? 1))); return [v.videoId, norm(m)] }))
  const confirmed = all.filter(v => { const a = verdicts.get(v.videoId)!; return a.status === 'aceptado' && a.evidence.length > 0 })
  const otherSense = all.filter(v => { const a = verdicts.get(v.videoId)!; return a.status === 'descartado' && (a.reason === 'sentido' || a.reason === 'nicho') })
  if (confirmed.length < MIN_SEEDS) return verdicts
  const out = new Map(verdicts)
  const good = confirmed.map(v => vec.get(v.videoId)!), bad = otherSense.map(v => vec.get(v.videoId)!)
  const goodC = centroid(good).c, badC = bad.length >= MIN_SEEDS ? centroid(bad).c : null
  for (const v of doubtful) {
    const a = verdicts.get(v.videoId)!, x = vec.get(v.videoId)!
    if (x.size < MIN_TOKENS) continue   // too little text to judge: stays doubtful
    const simGood = cosine(x, goodC), simBad = badC ? cosine(x, badC) : 0
    const pct = (n: number) => `${Math.round(n * 100)} %`
    if (simGood >= MIN_SIMILARITY && simGood - simBad >= MARGIN) out.set(v.videoId, { ...a, status: 'aceptado', relevant: true, reason: null, detail: `por contexto: se parece (${pct(simGood)}) a los ${confirmed.length} vídeos confirmados con palabras explícitas${badC ? ` y menos (${pct(simBad)}) a los de otro significado` : ''}`, evidence: [`similitud ${pct(simGood)}`] })
    else if (badC && simBad >= MIN_SIMILARITY && simBad - simGood >= MARGIN) out.set(v.videoId, { ...a, status: 'descartado', relevant: false, reason: 'sentido', detail: `por contexto: se parece (${pct(simBad)}) a los ${otherSense.length} vídeos de otro significado y menos (${pct(simGood)}) a los confirmados` })
  }
  return out
}
