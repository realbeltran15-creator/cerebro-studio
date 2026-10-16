import { currencyForCountries } from './currency'
import { EMPTY_BRIEF, type Brief } from './types'

/**
 * Investigación → Campañas. The link carries the evidence that justified the idea (topic, market, verdict, indices, date), so the
 * campaign cites it instead of asking again or recomputing it. Nothing is fetched: what travels is what Investigación already had.
 */
export type ResearchOrigin = { topic: string; region?: string | null; language?: string | null; verdict?: string | null; demand?: number | null; competition?: number | null; opportunity?: number | null; fetchedAt?: string | null; opportunityId?: string | null }

const VERDICT: Record<string, string> = { oportunidad: 'oportunidad', saturado: 'saturado', sin_demanda: 'sin demanda', mixto: 'señales mixtas' }
const safe = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const idx = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : null)

export function campaignLink(o: ResearchOrigin): string {
  const p = new URLSearchParams({ topic: o.topic.slice(0, 200) })
  if (o.region) p.set('country', o.region); if (o.language) p.set('lang', o.language)
  if (o.verdict) p.set('verdict', o.verdict)
  for (const [k, v] of [['demand', o.demand], ['competition', o.competition], ['opportunity', o.opportunity]] as const) if (typeof v === 'number') p.set(k, String(Math.round(v)))
  if (o.fetchedAt) p.set('at', o.fetchedAt)
  if (o.opportunityId) p.set('opp', o.opportunityId)
  return `/campaigns?${p}`
}

export function briefFromLink(search: string): Partial<Brief> | null {
  const p = new URLSearchParams(search), topic = safe(p.get('topic'), 200)
  if (!topic) return null
  const country = safe(p.get('country'), 10).toUpperCase(), lang = safe(p.get('lang'), 10).toLowerCase()
  const verdict = VERDICT[safe(p.get('verdict'), 20)] ?? ''
  const parts = [verdict && `veredicto de Investigación: ${verdict}`, idx(Number(p.get('demand'))) !== null && p.get('demand') !== null ? `demanda ${idx(Number(p.get('demand')))}/100` : '', p.get('competition') !== null && idx(Number(p.get('competition'))) !== null ? `competencia ${idx(Number(p.get('competition')))}/100` : '', p.get('opportunity') !== null && idx(Number(p.get('opportunity'))) !== null ? `oportunidad ${idx(Number(p.get('opportunity')))}/100` : ''].filter(Boolean)
  const at = safe(p.get('at'), 40)
  return {
    ...EMPTY_BRIEF, name: `Canal sobre ${topic}`.slice(0, 120), subject: 'channel', subjectName: topic, sourceTopic: topic, goal: 'subscribers',
    countries: /^[A-Z]{2}$/.test(country) ? [country] : [], ...(currencyForCountries(/^[A-Z]{2}$/.test(country) ? [country] : []) ? { currency: currencyForCountries([country])! } : {}), projectId: safe(p.get('project'), 64),
    source: { opportunityId: safe(p.get('opp'), 64), summary: `Tema «${topic}»${parts.length ? `: ${parts.join(', ')}` : ''}. Son índices calculados por Cerebro Studio sobre una muestra de YouTube, no resultados garantizados.`, language: /^[a-z]{2}$/.test(lang) ? lang : '', fetchedAt: Number.isFinite(Date.parse(at)) ? at : '' },
  }
}
