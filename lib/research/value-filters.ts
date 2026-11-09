import { nicheRpm } from './monetization'
import { VIABILITY } from './guided'
import { nichesOf } from './taxonomy'
import type { TopicAnalysis } from './topic-analysis'

/**
 * Differential-value filters (copyability, advantage, demand, barrier, numbers). Each filter is a 0–5 score WITH the evidence it rests on,
 * or "NO VERIFICADO" when the app has no evidence: absence of evidence is never turned into a low score. A score below its minimum
 * eliminates the idea (DESCARTAR); an unverified filter leaves it in REVISAR; PASA needs all five verified and above their minimums.
 */
export type FilterId = 'copiabilidad' | 'ventaja' | 'demanda' | 'barrera' | 'numeros'
export type FilterResult = { id: FilterId; label: string; min: number; score: number | null; evidence: string; basis: 'dato' | 'editorial' | 'no_verificado' }
export type Verdict = 'DESCARTAR' | 'REVISAR' | 'PASA'
export type ValueAssessment = { verdict: Verdict; filters: FilterResult[]; failed: FilterId[]; unverified: FilterId[]; summary: string }

export const FILTER_MIN: Record<FilterId, number> = { copiabilidad: 3, ventaja: 2, demanda: 3, barrera: 1, numeros: 2 }
const LABEL: Record<FilterId, string> = { copiabilidad: 'Difícil de copiar', ventaja: 'Ventaja propia', demanda: 'Demanda', barrera: 'Barrera que se acumula', numeros: 'Números' }

/** The owner's own advantages (languages he works in; the Netherlands, where he lives). Editable in one place. */
export const ADVANTAGE = { languages: ['es', 'en', 'de', 'nl'], homeRegion: 'NL' } as const

const nicheOf = (topic: string, niches?: string[]) => niches?.[0] ?? nichesOf({ title: topic, tags: [], categoryId: null, channelTitle: '' }, { useCategory: false })[0]?.niche ?? null

const unverified = (id: FilterId, evidence: string): FilterResult => ({ id, label: LABEL[id], min: FILTER_MIN[id], score: null, evidence, basis: 'no_verificado' })

function copiabilidad(niche: string | null): FilterResult {
  const v = niche ? VIABILITY[niche] : null
  if (!v) return unverified('copiabilidad', 'No se pudo inferir el nicho: sin criterio editorial.')
  // Easy to produce with automation and no expertise = anyone with an AI can copy it in an afternoon.
  const score = v.automation === 'alto' && v.expertise !== 'alto' ? 2 : v.expertise === 'alto' || v.production === 'alto' ? 4 : 3
  return { id: 'copiabilidad', label: LABEL.copiabilidad, min: FILTER_MIN.copiabilidad, score, basis: 'editorial', evidence: `Criterio editorial del nicho (producción ${v.production}, experiencia ${v.expertise}, automatización ${v.automation}); no medido.` }
}

function ventaja(language: string | null, region: string | null): FilterResult {
  if (!language && !region) return unverified('ventaja', 'Mercado sin idioma ni país: no se puede comparar con tus idiomas.')
  const own = language !== null && (ADVANTAGE.languages as readonly string[]).includes(language)
  const home = region === ADVANTAGE.homeRegion
  const score = own ? (home ? 4 : 3) : home ? 2 : 1
  return { id: 'ventaja', label: LABEL.ventaja, min: FILTER_MIN.ventaja, score, basis: 'dato', evidence: own ? `Idioma del mercado (${language}) entre los que dominas${home ? ' y país donde vives' : ''}.` : `Idioma ${language ?? 'sin definir'} fuera de tus idiomas${home ? ', aunque es el país donde vives' : ''}.` }
}

function demanda(a: Pick<TopicAnalysis, 'indices' | 'confidence'> | null): FilterResult {
  if (!a) return unverified('demanda', 'Aún sin medir en YouTube.')
  if (a.confidence === 'baja') return unverified('demanda', 'Muestra de YouTube insuficiente (confianza baja).')
  const d = a.indices.demand
  const score = d >= 70 ? 5 : d >= 60 ? 4 : d >= 45 ? 3 : d >= 30 ? 2 : 1
  return { id: 'demanda', label: LABEL.demanda, min: FILTER_MIN.demanda, score, basis: 'dato', evidence: `Índice de demanda en YouTube ${d}/100 (muestra real). Mide interés, no que la gente pague.` }
}

function numeros(niche: string | null): FilterResult {
  const r = niche ? nicheRpm(niche) : null
  if (!r || r.status !== 'estimado') return unverified('numeros', 'Sin RPM de referencia para este nicho.')
  const score = r.mid >= 4 ? 4 : r.mid >= 2.5 ? 3 : r.mid >= 1 ? 2 : 1
  return { id: 'numeros', label: LABEL.numeros, min: FILTER_MIN.numeros, score, basis: 'editorial', evidence: `RPM estimado de terceros ${r.low}–${r.high} USD por 1000 vistas (mediana ${r.mid}); no es ingreso real.` }
}

export function assess(input: { topic: string; language: string | null; region: string | null; analysis?: Pick<TopicAnalysis, 'indices' | 'confidence' | 'niches'> | null }): ValueAssessment {
  const niche = nicheOf(input.topic, input.analysis?.niches)
  const filters = [copiabilidad(niche), ventaja(input.language, input.region), demanda(input.analysis ?? null), unverified('barrera', 'Requiere criterio tuyo (datos, clientes, reputación acumulables): la app no puede comprobarlo.'), numeros(niche)]
  const failed = filters.filter(f => f.score !== null && f.score < f.min).map(f => f.id)
  const unver = filters.filter(f => f.score === null).map(f => f.id)
  const verdict: Verdict = failed.length ? 'DESCARTAR' : unver.length ? 'REVISAR' : 'PASA'
  const summary = verdict === 'DESCARTAR' ? `Descartada: no llega al mínimo en ${failed.map(f => LABEL[f].toLowerCase()).join(', ')}.` : verdict === 'REVISAR' ? `Pasa lo medible; falta verificar: ${unver.map(f => LABEL[f].toLowerCase()).join(', ')}.` : 'Pasa los cinco filtros.'
  return { verdict, filters, failed, unverified: unver, summary }
}

/** Free screening before spending quota: only filters that need no YouTube data (copyability, advantage, numbers). */
export const prescreen = (topic: string, language: string | null, region: string | null) => assess({ topic, language, region })
