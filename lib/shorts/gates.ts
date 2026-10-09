import type { Beat, Candidate, FactoryConfig, GateResult, InterestData, ScoreBreakdown, Script, Source } from './types'

const SPEECH_WORDS_PER_SECOND = 2.6

const STOPWORDS = new Set('los las del que por con una uno unos unas para como mas pero sus este esta esto ese esa cual cuando donde porque sobre entre desde hasta tambien muy son fue ser hay'.split(' '))

export function normalizeTopicKey(text: string) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w)).sort().join(' ')
}

export function median(values: number[]) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return 0
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

// ---------- 1) Interés comprobado con datos ----------

export function evaluateInterest(interest: InterestData | null, config: Pick<FactoryConfig, 'minInterestRatio' | 'minSamples'>) {
  if (!interest) return { pass: false, reason: 'sin datos de Radar/Market Intelligence', similarMedian: 0, nicheMedian: 0, ratio: 0, samples: 0 }
  const samples = interest.similarViews.filter(Number.isFinite).length
  const similarMedian = median(interest.similarViews)
  const ratio = interest.nicheMedian > 0 ? similarMedian / interest.nicheMedian : 0
  if (samples < config.minSamples) return { pass: false, reason: `solo ${samples} vídeos similares (mínimo ${config.minSamples})`, similarMedian, nicheMedian: interest.nicheMedian, ratio, samples }
  if (interest.nicheMedian <= 0) return { pass: false, reason: 'mediana del nicho no disponible', similarMedian, nicheMedian: 0, ratio, samples }
  if (ratio < config.minInterestRatio) return { pass: false, reason: `los vídeos similares (${Math.round(similarMedian)}) no superan la mediana del nicho (${Math.round(interest.nicheMedian)})`, similarMedian, nicheMedian: interest.nicheMedian, ratio, samples }
  if (interest.trend === 'falling') return { pass: false, reason: 'tendencia a la baja', similarMedian, nicheMedian: interest.nicheMedian, ratio, samples }
  return { pass: true, reason: 'ok', similarMedian, nicheMedian: interest.nicheMedian, ratio, samples }
}

export type CategoryRetention = Map<string, { mean: number; samples: number }>

/** Media de averageViewPercentage OBSERVADA a 7 días por categoría. */
export function categoryRetention(rows: { category: string | null; averageViewPercentage: number | null }[]): CategoryRetention {
  const acc = new Map<string, number[]>()
  for (const r of rows) {
    if (!r.category || r.averageViewPercentage == null || !Number.isFinite(r.averageViewPercentage)) continue
    acc.set(r.category, [...(acc.get(r.category) ?? []), r.averageViewPercentage])
  }
  return new Map([...acc].map(([k, v]) => [k, { mean: v.reduce((a, b) => a + b, 0) / v.length, samples: v.length }]))
}

/**
 * Puntuación 0-100. Interés (observado) hasta 50, tendencia 10, encaje con el canal (inferido por el modelo) 25,
 * histórico de retención (observado, solo con muestras suficientes) hasta 15.
 */
export function scoreCandidate(
  candidate: Candidate,
  fitScore: number | null,
  category: string | null,
  retention: CategoryRetention,
  config: FactoryConfig,
): ScoreBreakdown {
  const i = evaluateInterest(candidate.interest, config)
  const interestPoints = Math.min(50, Math.max(0, Math.log2(Math.max(i.ratio, 0.01) + 1) * 25))
  const trend = candidate.interest?.trend ?? null
  const trendPoints = trend === 'rising' ? 10 : trend === 'flat' ? 5 : 0
  const fitPoints = fitScore == null ? 0 : Math.min(25, Math.max(0, (fitScore / 10) * 25))

  let history: ScoreBreakdown['history'] = { points: 0, basis: 'none' }
  const cat = category ? retention.get(category) : undefined
  if (category && cat && cat.samples >= config.minRetentionSamples && retention.size) {
    const all = [...retention.values()]
    const overall = all.reduce((a, b) => a + b.mean * b.samples, 0) / all.reduce((a, b) => a + b.samples, 0)
    const delta = (cat.mean - overall) / Math.max(overall, 1) // relativo a la media del propio canal
    history = { points: Math.min(15, Math.max(0, 7.5 + delta * 50)), basis: 'observed', category, meanRetention: cat.mean, samples: cat.samples }
  }
  const total = interestPoints + trendPoints + fitPoints + history.points
  return {
    total: Math.round(total * 10) / 10,
    interest: { points: Math.round(interestPoints * 10) / 10, basis: 'observed', similarMedian: i.similarMedian, nicheMedian: i.nicheMedian, ratio: Math.round(i.ratio * 100) / 100, samples: i.samples },
    trend: { points: trendPoints, basis: 'observed', value: trend },
    fit: { points: Math.round(fitPoints * 10) / 10, basis: 'inferred', rawScore: fitScore },
    history,
  }
}

// ---------- 2) Fuentes ----------

export function hostnameOf(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch { return null }
}

const SECOND_LEVEL = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'com.mx', 'com.ar'])
export function registrableDomain(hostname: string) {
  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname
  const last2 = parts.slice(-2).join('.')
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2
}

export function isReliableDomain(domain: string, allow: string[]) {
  if (allow.some(a => domain === a || domain.endsWith(`.${a}`))) return true
  return /\.(gov|edu)(\.[a-z]{2})?$/.test(domain) || /\.(gob\.es|ac\.uk)$/.test(domain)
}

/** Fuentes distintas (por dominio registrable) y fiables. */
export function independentReliableSources<T extends { url: string }>(sources: T[], allow: string[]) {
  const seen = new Set<string>()
  const out: T[] = []
  for (const s of sources) {
    const host = hostnameOf(s.url)
    if (!host) continue
    const domain = registrableDomain(host)
    if (seen.has(domain) || !isReliableDomain(domain, allow)) continue
    seen.add(domain)
    out.push(s)
  }
  return out
}

const squash = (t: string) => t.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
/** La cita debe aparecer literalmente (salvo espacios/mayúsculas) en el texto descargado. */
export function quoteAppearsIn(pageText: string, quote: string) {
  const q = squash(quote)
  return q.length >= 25 && squash(pageText).includes(q)
}

/** Bloquea destinos que no sean sitios públicos (mitiga SSRF al descargar fuentes). */
export function isPublicHttpUrl(url: string) {
  const host = hostnameOf(url)
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return false
  if (/^\[/.test(host) || host.includes(':')) return false
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false
  }
  return true
}

// ---------- 3) Guion, hook y duración ----------

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function hookGates(script: Script, config: FactoryConfig): GateResult[] {
  const words = wordCount(script.hook)
  const estSeconds = words / SPEECH_WORDS_PER_SECOND
  const datum = fold(script.key_datum)
  return [
    { name: 'hook_corto', pass: words > 0 && words <= config.maxHookWords, detail: `${words} palabras (máx. ${config.maxHookWords})` },
    { name: 'hook_en_2s_estimado', pass: estSeconds <= config.hookSeconds, detail: `≈${estSeconds.toFixed(1)} s antes de medir la voz real` },
    { name: 'dato_principal_en_hook', pass: datum.length > 0 && fold(script.hook).includes(datum), detail: `dato «${script.key_datum}» ${fold(script.hook).includes(datum) ? 'presente' : 'ausente'} en el hook` },
  ]
}

export function scriptGates(script: Script, config: FactoryConfig): GateResult[] {
  const beats: Beat[] = script.beats ?? []
  const total = wordCount([script.hook, ...beats.map(b => b.text)].join(' '))
  return [
    { name: 'escenas', pass: beats.length >= 4 && beats.length <= 7, detail: `${beats.length} escenas (4-7)` },
    { name: 'palabras', pass: total >= 45 && total <= 125, detail: `${total} palabras (45-125)` },
    { name: 'prompts_visuales', pass: beats.length > 0 && beats.every(b => b.visual_prompt?.trim().length >= 12), detail: 'cada escena tiene prompt de imagen' },
    { name: 'categoria', pass: config.categories.includes(script.category), detail: `categoría «${script.category}»` },
    { name: 'titulo', pass: !!script.title && script.title.length <= 100, detail: `${script.title?.length ?? 0} caracteres (≤100)` },
  ]
}

/** Segundos que tarda en decirse el hook, estimados con la voz REAL (caracteres/segundo medidos). */
export function measuredHookSeconds(hook: string, fullNarration: string, voiceSeconds: number) {
  const charsPerSecond = fullNarration.length / Math.max(voiceSeconds, 0.1)
  return hook.length / charsPerSecond
}

export function audioGates(hook: string, narration: string, voiceSeconds: number, config: FactoryConfig): GateResult[] {
  const hookSeconds = measuredHookSeconds(hook, narration, voiceSeconds)
  return [
    { name: 'duracion', pass: voiceSeconds >= config.minDuration && voiceSeconds <= config.maxDuration, detail: `${voiceSeconds.toFixed(1)} s (${config.minDuration}-${config.maxDuration})` },
    { name: 'hook_en_2s_medido', pass: hookSeconds <= config.hookSeconds + 0.15, detail: `≈${hookSeconds.toFixed(2)} s con la voz generada` },
  ]
}

export const sourceGate = (sources: Source[]): GateResult => ({
  name: 'fuentes_independientes', pass: sources.length >= 2, detail: `${sources.length} fuente(s) fiable(s) e independiente(s) verificada(s) (mín. 2)`,
})

// ---------- Subtítulos y tiempos ----------

/** Reparte `duration` entre trozos de texto proporcionalmente a sus caracteres (tiempo inferido, no medido por palabra). */
export function allocateTimes(parts: string[], duration: number, startAt = 0) {
  const weights = parts.map(p => Math.max(p.length, 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  let t = startAt
  return parts.map((text, i) => {
    const len = (weights[i] / sum) * duration
    const slot = { text, start: Math.round(t * 1000) / 1000, end: Math.round((t + len) * 1000) / 1000 }
    t += len
    return slot
  })
}

export function chunkWords(text: string, maxWords = 4) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '))
  return chunks
}

/** Mismo tema aunque esté redactado distinto: solapamiento de palabras clave (Jaccard). */
export function isSameTopic(a: string, b: string, threshold = 0.6) {
  const A = new Set(a.split(' ').filter(Boolean))
  const B = new Set(b.split(' ').filter(Boolean))
  if (!A.size || !B.size) return false
  const inter = [...A].filter(x => B.has(x)).length
  return inter / (A.size + B.size - inter) >= threshold
}
