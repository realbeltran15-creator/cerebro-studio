'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useResearch } from './research-context'
import { COUNTRIES } from '@/lib/research/discovery'
import { marketsFromFilters } from '@/lib/research/markets'
import { jobKey, needsConfirm, planGuided, type Job } from '@/lib/research/guided'
import { UNITS } from '@/lib/research/filters'
import { fmtNumber } from '@/lib/research/format'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'
import { assess, prescreen, type ValueAssessment } from '@/lib/research/value-filters'
import { saveAnalysis } from '@/lib/research/save'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

export type NicheCriteria = { minDemand: number; maxCompetition: number; maxSupply: number }

/** A niche meets the criteria when demand is at least the minimum and competition and supply are at most the maximum. */
export function meetsCriteria(a: Pick<TopicAnalysis, 'indices'>, c: NicheCriteria) {
  return a.indices.demand >= c.minDemand && a.indices.competition <= c.maxCompetition && a.indices.supply <= c.maxSupply
}

/** How far an analysis is from the criteria (0 = meets them). Used to rank the closest ones when nothing meets them. */
export function distanceToCriteria(a: Pick<TopicAnalysis, 'indices'>, c: NicheCriteria) {
  return Math.max(0, c.minDemand - a.indices.demand) + Math.max(0, a.indices.competition - c.maxCompetition) + Math.max(0, a.indices.supply - c.maxSupply)
}

const num = (v: string, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d }

/**
 * Automatic niche discovery: the person only sets the parameters (country, minimum demand, maximum competition and supply, how many topics to test).
 * The tool proposes the candidate topics itself (from the curated catalogue of the market's language), measures each one with real YouTube data
 * and shows only those that meet the parameters. Nothing is invented: a niche that does not meet them is never shown as a match.
 */
export function AutoNichePanel() {
  const { runJobs, analyses, recentDays, usage, progress, cancel, error } = useResearch()
  const [country, setCountry] = useState('')
  const [minDemand, setMinDemand] = useState('60')
  const [maxCompetition, setMaxCompetition] = useState('40')
  const [maxSupply, setMaxSupply] = useState('50')
  const [count, setCount] = useState('5')
  const [offset, setOffset] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [ok, setOk] = useState(false)
  const [note, setNote] = useState('')

  const criteria: NicheCriteria = { minDemand: num(minDemand, 0, 100, 60), maxCompetition: num(maxCompetition, 0, 100, 40), maxSupply: num(maxSupply, 0, 100, 50) }
  const n = num(count, 1, 10, 5)
  const markets = useMemo(() => marketsFromFilters({ countries: country ? [country] : [], languages: [] }), [country])
  // Free screening first: a pool three times larger than asked is filtered with the filters that need no YouTube data, so quota is only spent on candidates that can still pass.
  const pool = useMemo(() => planGuided({ markets, nicheIds: [], perMarket: n * 3, offset }), [markets, n, offset])
  const screened = useMemo(() => pool.jobs.map(j => ({ j, pre: prescreen(j.topic, j.market.language, j.market.region) })), [pool])
  const kept = useMemo(() => screened.filter(x => x.pre.verdict !== 'DESCARTAR').slice(0, n), [screened, n])
  const skipped = screened.filter(x => x.pre.verdict === 'DESCARTAR' && !kept.includes(x))
  const plan = useMemo(() => ({ jobs: kept.map(x => x.j) }), [kept])
  const fresh = plan.jobs.filter(j => !analyses[jobKey(j, recentDays)]).length
  const units = fresh * UNITS.topic
  const confirmNeeded = needsConfirm(units)
  const remaining = usage?.remaining
  const tooExpensive = remaining !== undefined && units > remaining
  const busy = Boolean(progress)

  const results = jobs.map(j => analyses[jobKey(j, recentDays)]).filter((a): a is TopicAnalysis => Boolean(a))
  const matches = results.filter(a => meetsCriteria(a, criteria)).sort((a, b) => b.indices.opportunity - a.indices.opportunity)
  const closest = matches.length ? [] : [...results].sort((a, b) => distanceToCriteria(a, criteria) - distanceToCriteria(b, criteria)).slice(0, 3)

  async function search() {
    setNote(''); setOk(false)
    const batch = plan.jobs
    setJobs(prev => [...prev, ...batch.filter(b => !prev.some(p => jobKey(p, recentDays) === jobKey(b, recentDays)))])
    const r = await runJobs(batch, { recentDays })
    setOffset(o => o + n * 3)
    setNote(r.failed.length ? `${r.ok} analizados; ${r.failed.length} fallaron (${r.failed.slice(0, 2).join(' · ')}).` : `${r.ok} temas analizados con datos reales de YouTube.`)
  }

  return <section className="panel" style={{ margin: '0 0 18px' }} aria-label="Buscar nichos desatendidos">
    <h2 style={{ margin: 0 }}>Encontrar nichos desatendidos</h2>
    <p className="muted small" style={{ margin: '6px 0 10px' }}>No tienes que escribir nada: eliges los parámetros y la herramienta prueba temas por su cuenta, los mide con datos reales de YouTube y te enseña solo los que los cumplen.</p>
    <div className="marketForm">
      <div><label className="muted small" htmlFor="an-country">País</label>
        <select id="an-country" value={country} onChange={e => { setCountry(e.target.value); setOffset(0); setJobs([]) }}>
          <option value="">Todo el mundo (en inglés)</option>
          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select></div>
      <div><label className="muted small" htmlFor="an-demand">Demanda mínima (0–100)</label><input id="an-demand" type="number" min={0} max={100} value={minDemand} onChange={e => setMinDemand(e.target.value)} /></div>
      <div><label className="muted small" htmlFor="an-comp">Competencia máxima (0–100)</label><input id="an-comp" type="number" min={0} max={100} value={maxCompetition} onChange={e => setMaxCompetition(e.target.value)} /></div>
      <div><label className="muted small" htmlFor="an-supply">Oferta máxima (0–100)</label><input id="an-supply" type="number" min={0} max={100} value={maxSupply} onChange={e => setMaxSupply(e.target.value)} /></div>
      <div><label className="muted small" htmlFor="an-count">Temas a probar (1–10)</label><input id="an-count" type="number" min={1} max={10} value={count} onChange={e => setCount(e.target.value)} /></div>
    </div>
    <p className="small" style={{ marginTop: 8 }}>Coste: {fresh} × {UNITS.topic} = {fmtNumber(units)} unidades de la cuota gratuita de YouTube (no es dinero){remaining !== undefined ? ` · te quedan ${fmtNumber(remaining)} hoy` : ''}.{fresh === 0 ? ' Estos temas ya estaban analizados: no gasta nada.' : ''}</p>
    {tooExpensive && <p className="warnBox" role="status">Hoy no queda cuota suficiente para tantos temas: baja el número o espera a mañana.</p>}
    {confirmNeeded && <label className="msOpt"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> Entiendo que esto gastará {fmtNumber(units)} unidades de cuota</label>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <button type="button" disabled={busy || tooExpensive || plan.jobs.length === 0 || (confirmNeeded && !ok)} onClick={() => void search()}>{busy ? 'Buscando…' : offset === 0 && jobs.length === 0 ? 'Buscar nichos' : 'Probar más temas'}</button>
      {busy && <button type="button" className="ghost" onClick={cancel}>Cancelar</button>}
    </div>
    {busy && progress && <p className="muted small" role="status">Analizando {progress.done + 1} de {progress.total}: {progress.current}</p>}
    {error && <p className="error" role="alert">Consulta fallida: {error}</p>}
    {note && <p className="muted small" role="status">{note}</p>}
    {skipped.length > 0 && <p className="muted small">Descartados sin gastar cuota ({skipped.length}): {skipped.slice(0, 4).map(x => `${x.j.topic} (${x.pre.summary.replace('Descartada: ', '')})`).join(' · ')}{skipped.length > 4 ? '…' : ''}</p>}
    {plan.jobs.length === 0 && <p className="warnBox" role="status">Ya no quedan temas nuevos que probar para este país. Cambia de país.</p>}

    {jobs.length > 0 && <div aria-live="polite" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 6px' }}>{matches.length ? `${matches.length} nicho${matches.length === 1 ? '' : 's'} cumple${matches.length === 1 ? '' : 'n'} tus parámetros` : 'Ningún tema cumple todos tus parámetros'}</h3>
      <p className="muted small" style={{ margin: '0 0 8px' }}>Probados hasta ahora: {results.length}. Si un tema no cumple, no se muestra como resultado.</p>
      {(matches.length ? matches : closest).map(a => <NicheCard key={jobKey({ topic: a.topic, market: { region: a.region, language: a.language, label: '' } }, recentDays)} a={a} match={matches.length > 0} />)}
      {!matches.length && closest.length > 0 && <p className="muted small">Arriba, los 3 más cercanos a tus parámetros (no los cumplen). Pulsa «Probar más temas» para seguir buscando.</p>}
    </div>}
  </section>
}

function NicheCard({ a, match }: { a: TopicAnalysis; match: boolean }) {
  const v: ValueAssessment = assess({ topic: a.topic, language: a.language, region: a.region, analysis: a })
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'exists' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  async function save() {
    setState('saving'); setMsg('')
    try { setState(await saveAnalysis(getSupabaseBrowserClient() as never, a)) } catch (e) { setState('error'); setMsg(e instanceof Error ? e.message : 'No se pudo guardar.') }
  }
  return <article className="panel" style={{ margin: '0 0 8px' }}>
    <strong>{a.topic}</strong> <span className="muted small">{match ? 'cumple' : 'no cumple'} · confianza {a.confidence}</span>
    <p className="small" style={{ margin: '4px 0' }}>Demanda {a.indices.demand}/100 · Competencia {a.indices.competition}/100 · Oferta {a.indices.supply}/100 · Oportunidad {a.indices.opportunity}/100</p>
    <p className="muted small" style={{ margin: 0 }}>{a.headline}</p>
    <p className="small" style={{ margin: '6px 0 0' }}><strong>Valor diferencial: {v.verdict}</strong> · {v.summary}</p>
    <details><summary className="muted small">Ver los 5 filtros</summary>
      <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{v.filters.map(f => <li key={f.id}>{f.label} (mínimo {f.min}): {f.score === null ? 'NO VERIFICADO' : `${f.score}/5`} — {f.evidence}</li>)}</ul>
    </details>
    <div style={{ marginTop: 6 }}>
      <button type="button" className="ghost" disabled={state === 'saving' || state === 'saved' || state === 'exists'} onClick={() => void save()}>{state === 'saved' ? 'Guardada' : state === 'exists' ? 'Ya estaba guardada' : state === 'saving' ? 'Guardando…' : 'Guardar idea'}</button>
      {(state === 'saved' || state === 'exists') && <> <Link href="/opportunities">Ir a Oportunidades para crear el guion y el proyecto</Link></>}
      {state === 'error' && <span className="error" role="alert"> {msg}</span>}
    </div>
  </article>
}
