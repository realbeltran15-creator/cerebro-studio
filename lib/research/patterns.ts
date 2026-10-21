import { marketLabel } from './markets'
import { formatOpportunity, median, type SampleVideo, type TopicAnalysis } from './topic-analysis'

/**
 * Title, duration and publishing-day patterns of an analysis, CALCULATED from the videos already in its sample (no new API call).
 * Descriptive, not causal: «titles with a number have a higher median» says what happened in this sample, not that a number causes views.
 * Only accepted videos with views and a valid date count; a group with fewer than MIN videos is shown but flagged as too small.
 */
export const MIN_GROUP = 4

export type PatternRow = { id: string; label: string; count: number; medianVpd: number | null; othersMedianVpd: number | null; /** with ÷ without; null when either side is missing or too small. */ lift: number | null; small: boolean }
export type BucketRow = { label: string; count: number; medianVpd: number | null; small: boolean }
export type Patterns = { base: number; medianVpd: number | null; titles: PatternRow[]; durations: BucketRow[]; weekdays: BucketRow[]; titleLength: { median: number | null; topQuartileMedian: number | null }; summary: string[] }

const EMOJI = /\p{Extended_Pictographic}/u
const FEATURES: Array<{ id: string; label: string; test: (t: string) => boolean }> = [
  { id: 'number', label: 'Con un número (lista, cifra, año)', test: t => /\d/.test(t) },
  { id: 'question', label: 'Formulado como pregunta', test: t => /[¿?]/.test(t) },
  { id: 'caps', label: 'Con una palabra en MAYÚSCULAS', test: t => /(?<!\p{L})\p{Lu}{3,}(?!\p{L})/u.test(t) && t !== t.toUpperCase() },
  { id: 'brackets', label: 'Con corchetes o paréntesis', test: t => /[[\]()]/.test(t) },
  { id: 'emoji', label: 'Con emoji', test: t => EMOJI.test(t) },
  { id: 'exclaim', label: 'Con exclamación', test: t => /[¡!]/.test(t) },
  { id: 'first', label: 'En primera persona (yo, mi, me, I, my)', test: t => /(?<!\p{L})(yo|mi|me|mis|i|my|me)(?!\p{L})/iu.test(t) },
  { id: 'short', label: 'Título corto (≤ 40 caracteres)', test: t => [...t].length <= 40 },
  { id: 'long', label: 'Título largo (> 70 caracteres)', test: t => [...t].length > 70 },
]
const DURATIONS: Array<{ label: string; max: number }> = [
  { label: 'Hasta 1 min', max: 60 }, { label: '1–4 min', max: 240 }, { label: '4–10 min', max: 600 }, { label: '10–20 min', max: 1200 }, { label: 'Más de 20 min', max: Infinity },
]
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

type V = SampleVideo & { vpd: number }
const round = (n: number | null) => (n === null ? null : n >= 100 ? Math.round(n) : Math.round(n * 10) / 10)

/** Accepted videos with views/day computed against `now` (at least one day of age, so a 2-hour-old video does not explode). */
export function usableVideos(sample: SampleVideo[], now: number): V[] {
  return sample.flatMap(v => {
    const t = Date.parse(v.publishedAt)
    if (v.status !== 'aceptado' || v.views === null || !Number.isFinite(t)) return []
    return [{ ...v, vpd: v.views / Math.max(1, (now - t) / 86400000) }]
  })
}

export function analysePatterns(a: Pick<TopicAnalysis, 'sample' | 'fetchedAt'>): Patterns {
  const now = Date.parse(a.fetchedAt) || Date.now()
  const vids = usableVideos(a.sample ?? [], now)
  const med = (xs: V[]) => round(median(xs.map(v => v.vpd)))
  const titles: PatternRow[] = FEATURES.map(f => {
    const yes = vids.filter(v => f.test(v.title)), no = vids.filter(v => !f.test(v.title))
    const m = med(yes), o = med(no)
    const small = yes.length < MIN_GROUP || no.length < MIN_GROUP
    return { id: f.id, label: f.label, count: yes.length, medianVpd: m, othersMedianVpd: o, lift: !small && m !== null && o ? Math.round((m / o) * 100) / 100 : null, small }
  })
  const bucket = (label: string, xs: V[]): BucketRow => ({ label, count: xs.length, medianVpd: med(xs), small: xs.length < MIN_GROUP })
  let lo = 0
  const durations = DURATIONS.map(d => { const xs = vids.filter(v => v.durationSeconds !== null && v.durationSeconds > lo && v.durationSeconds <= d.max); lo = d.max; return bucket(d.label, xs) })
  const weekdays = WEEKDAYS.map((label, i) => bucket(label, vids.filter(v => new Date(v.publishedAt).getUTCDay() === i)))
  const sorted = [...vids].sort((x, y) => y.vpd - x.vpd)
  const topQ = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)))
  const titleLength = { median: median(vids.map(v => [...v.title].length)), topQuartileMedian: vids.length >= 8 ? median(topQ.map(v => [...v.title].length)) : null }

  const summary: string[] = []
  if (vids.length < 10) summary.push(`Muestra pequeña (${vids.length} vídeos aceptados con datos): los patrones son orientativos.`)
  const strong = titles.filter(t => t.lift !== null && t.lift >= 1.5).sort((x, y) => (y.lift ?? 0) - (x.lift ?? 0))
  const weak = titles.filter(t => t.lift !== null && t.lift <= 0.67)
  for (const t of strong.slice(0, 3)) summary.push(`${t.label}: mediana ${t.lift}× la del resto (${t.count} vídeos).`)
  for (const t of weak.slice(0, 2)) summary.push(`${t.label}: rinde menos en esta muestra (${t.lift}× el resto).`)
  const bestDur = durations.filter(d => !d.small && d.medianVpd !== null).sort((x, y) => (y.medianVpd ?? 0) - (x.medianVpd ?? 0))[0]
  if (bestDur) summary.push(`Duración con mejor mediana: ${bestDur.label.toLowerCase()} (${bestDur.medianVpd} vistas/día, ${bestDur.count} vídeos).`)
  if (titleLength.topQuartileMedian !== null && titleLength.median !== null) summary.push(`Los títulos del 25 % con más vistas/día miden ${titleLength.topQuartileMedian} caracteres de mediana (todos: ${titleLength.median}).`)
  return { base: vids.length, medianVpd: med(vids), titles, durations, weekdays, titleLength, summary }
}

const pct = (n: number | null) => (n === null ? 'no calculable' : String(n))
/** A complete, self-explanatory report of one analysis in Markdown (opens in any editor; every number keeps its source and nature). */
export function analysisReportMarkdown(a: TopicAnalysis, p = analysePatterns(a)) {
  const fo = formatOpportunity(a)
  const L: string[] = []
  L.push(`# Informe de investigación: ${a.topic}`, '')
  L.push(`- Mercado: ${marketLabel(a.region, a.language)}`, `- Fecha de los datos: ${new Date(a.fetchedAt).toLocaleString('es-ES')}`, `- Fuente: YouTube Data API (muestra de ${a.sampleSizes.top} vídeos más vistos y ${a.sampleSizes.recent} recientes de ${a.recentDays} días)`, `- Naturaleza: índices CALCULADOS sobre una muestra; no son datos internos de YouTube ni volumen de búsqueda.`, '')
  L.push('## Veredicto', '', `**${a.headline}** (confianza ${a.confidence})`, '', ...a.reasons.map(r => `- ${r}`), '', `> ${a.confidenceNote}`, '')
  L.push('## Índices (0–100, calculados)', '', '| Demanda | Oferta | Competencia | Crecimiento | Oportunidad |', '|---|---|---|---|---|', `| ${a.indices.demand} | ${a.indices.supply} | ${a.indices.competition} | ${pct(a.indices.growth)} | ${a.indices.opportunity} |`, '')
  L.push('## Formato', '', `- Shorts: ${a.byFormat.short.count} en el top, mediana ${a.byFormat.short.medianViewsPerDay ?? '—'} vistas/día.`, `- Vídeos largos: ${a.byFormat.long.count} en el top, mediana ${a.byFormat.long.medianViewsPerDay ?? '—'} vistas/día.`, `- Recomendación: ${fo.recommended === 'short' ? 'Shorts' : fo.recommended === 'long' ? 'vídeo largo' : 'sin preferencia clara'} — ${fo.reason}`, '')
  L.push(`## Patrones de títulos, duración y día (calculados sobre ${p.base} vídeos; descriptivos, no causales)`, '', ...p.summary.map(s => `- ${s}`), '')
  L.push('| Rasgo del título | Vídeos | Mediana vistas/día | Resto | Relación |', '|---|---|---|---|---|', ...p.titles.map(t => `| ${t.label} | ${t.count} | ${t.medianVpd ?? '—'} | ${t.othersMedianVpd ?? '—'} | ${t.lift === null ? (t.small ? 'muestra pequeña' : '—') : `${t.lift}×`} |`), '')
  L.push('| Duración | Vídeos | Mediana vistas/día |', '|---|---|---|', ...p.durations.map(d => `| ${d.label} | ${d.count} | ${d.small ? `${d.medianVpd ?? '—'} (muestra pequeña)` : d.medianVpd ?? '—'} |`), '')
  L.push('| Día de publicación (UTC) | Vídeos | Mediana vistas/día |', '|---|---|---|', ...p.weekdays.map(d => `| ${d.label} | ${d.count} | ${d.small ? `${d.medianVpd ?? '—'} (muestra pequeña)` : d.medianVpd ?? '—'} |`), '')
  if (a.terms.length) L.push('## Frases relacionadas', '', ...a.terms.slice(0, 15).map(t => `- ${t.term} — ${t.videos} vídeos`), '')
  if (a.emerging.length) L.push('## Frases emergentes', '', ...a.emerging.map(t => `- ${t.term}`), '')
  if (a.questions.length) L.push('## Preguntas en títulos', '', ...a.questions.map(q => `- ${q.text}`), '')
  L.push('## Vídeos de referencia (más vistos de la muestra)', '', ...a.topVideos.slice(0, 10).map(v => `- [${v.title.replace(/[[\]]/g, '')}](${v.url}) — ${v.channelTitle} · ${v.observed.views ?? '—'} vistas`), '')
  if (a.evidence.length) L.push("## Evidencia", "", ...a.evidence.slice(0, 15).map(e => `- ${e.label}: ${e.value} (${e.kind})`), "")
  L.push('---', 'Generado por Cerebro Studio a partir de una investigación guardada; no se hicieron consultas nuevas.')
  return L.join('\n')
}
