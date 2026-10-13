'use client'

import { useMemo, useState } from 'react'
import { useResearch } from './research-context'
import { budgetPlan, needsConfirm, planGuided, reportCsv, reportMarkdown, jobKey } from '@/lib/research/guided'
import { fmtNumber } from '@/lib/research/format'
import { recentDaysFrom } from '@/lib/research/markets'
import { UNITS } from '@/lib/research/filters'

export function downloadText(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}

/**
 * Guided research: the same number of candidate subniches in every market of the applied filters (default 20), run as a queue that respects
 * today's budget and resumes tomorrow. The ideas come from a curated seed catalogue (queries to test); the verdict on each one comes from API data.
 */
export function GuidedPanel() {
  const { filters, markets, analyses, usage, guided, setGuided, runJobs, progress, cancel, error } = useResearch()
  const [perMarket, setPerMarket] = useState(20)
  const [ok, setOk] = useState(false)
  const recentDays = recentDaysFrom(filters.periodDays)
  const proposal = useMemo(() => planGuided({ markets, nicheIds: filters.niches, perMarket }), [markets, filters.niches, perMarket])
  const jobs = useMemo(() => guided?.jobs ?? [], [guided])
  const cap = usage?.cap ?? 6000
  const rd = guided?.recentDays ?? recentDays
  const bp = useMemo(() => budgetPlan({ jobs, done: analyses, recentDays: rd, remainingToday: usage?.remaining ?? cap, dailyCap: cap }), [jobs, analyses, rd, usage, cap])
  const perMarketRows = useMemo(() => {
    const by = new Map<string, { label: string; planned: number; done: number }>()
    for (const j of jobs) { const e = by.get(j.market.label) ?? { label: j.market.label, planned: 0, done: 0 }; e.planned++; if (analyses[jobKey(j, rd)]) e.done++; by.set(j.market.label, e) }
    return [...by.values()]
  }, [jobs, analyses, rd])
  const doneList = jobs.map(j => analyses[jobKey(j, rd)]).filter(Boolean)
  const proposalFresh = proposal.jobs.filter(j => !analyses[jobKey(j, recentDays)]).length
  const confirmNeeded = needsConfirm(bp.todayUnits)
  const busy = Boolean(progress)
  const stamp = new Date().toISOString().slice(0, 10)

  return <section className="panel" style={{ marginTop: 14 }} aria-label="Investigación guiada">
    <h3>Investigación guiada: varios nichos por mercado</h3>
    <p className="muted small" style={{ margin: '6px 0 10px' }}>Analiza el mismo número de subnichos candidatos en cada mercado de los filtros aplicados ({markets.map(m => m.label).join(', ')}), en el idioma de cada uno. Las ideas salen de un catálogo propio de temas a probar (no son datos); lo que vale cada una lo decide lo que devuelva YouTube. Cada análisis cuesta ~{UNITS.topic} unidades, así que se ejecuta como una cola que respeta el presupuesto de hoy y se puede reanudar otro día.</p>
    {!guided ? <>
      <div className="marketForm">
        <div><label className="muted small" htmlFor="guided-n">Subnichos por mercado</label><input id="guided-n" type="number" min={1} max={20} value={perMarket} onChange={e => setPerMarket(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))} /></div>
        <button type="button" disabled={proposal.jobs.length === 0} onClick={() => setGuided({ jobs: proposal.jobs, perMarket, createdAt: new Date().toISOString(), recentDays })}>Preparar plan ({proposal.jobs.length} análisis)</button>
      </div>
      <p className="small" style={{ marginTop: 8 }}>Coste total del plan: {proposal.jobs.length} × {UNITS.topic} = {fmtNumber(proposal.jobs.length * UNITS.topic)} unidades{proposalFresh < proposal.jobs.length ? ` (${fmtNumber(proposalFresh * UNITS.topic)} sin contar lo ya analizado)` : ''}. YouTube concede 10.000 al día a todo el proyecto.</p>
      {proposal.shortfall.length > 0 && <p className="warnBox" role="status">Faltan ideas: {proposal.shortfall.map(x => `${x.market} (${x.got} de ${x.wanted})`).join(', ')}. Elige más nichos en los filtros para tener más candidatos.</p>}
      {proposal.fallbackMarkets.length > 0 && <p className="muted small">Sin catálogo propio en el idioma de {proposal.fallbackMarkets.join(', ')}: se usan ideas en inglés.</p>}
    </> : <>
      <div className="tableScroll"><table className="dataTable" aria-label="Progreso del plan"><thead><tr><th>Mercado</th><th>Planificados</th><th>Hechos</th><th>Pendientes</th></tr></thead>
        <tbody>{perMarketRows.map(r => <tr key={r.label}><td>{r.label}</td><td>{r.planned}</td><td>{r.done}</td><td>{r.planned - r.done}</td></tr>)}</tbody></table></div>
      <p className="small" style={{ marginTop: 8 }}>{bp.message}</p>
      {usage && <p className="muted small">Hoy has usado {fmtNumber(usage.usedToday)} de {fmtNumber(usage.cap)} unidades de Investigación.</p>}
      {bp.pending > 0 && bp.todayJobs === 0 && <p className="warnBox" role="status">Hoy no queda presupuesto para otro análisis: el plan continúa mañana (se guarda en este navegador).</p>}
      {confirmNeeded && <label className="msOpt"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> Entiendo que esto gastará {fmtNumber(bp.todayUnits)} unidades de cuota hoy</label>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" disabled={busy || bp.todayJobs === 0 || (confirmNeeded && !ok)} onClick={() => { setOk(false); void runJobs(jobs, { recentDays: rd, maxJobs: bp.todayJobs }) }}>{busy ? 'Ejecutando…' : bp.pending === 0 ? 'Plan completo' : `Ejecutar lo que cabe hoy (${bp.todayJobs} análisis · ${fmtNumber(bp.todayUnits)} unidades)`}</button>
        {busy && <button type="button" className="ghost" onClick={cancel}>Cancelar</button>}
        <button type="button" className="ghost" disabled={busy} onClick={() => setGuided(null)}>Quitar plan</button>
        <button type="button" className="ghost" disabled={doneList.length === 0} onClick={() => downloadText(`informe-investigacion-${stamp}.md`, reportMarkdown(doneList, { generatedAt: new Date().toISOString() }), 'text/markdown')}>Exportar informe (Markdown)</button>
        <button type="button" className="ghost" disabled={doneList.length === 0} onClick={() => downloadText(`informe-investigacion-${stamp}.csv`, reportCsv(doneList), 'text/csv')}>Exportar informe (CSV)</button>
      </div>
      {busy && progress && <p className="muted small" role="status">En ejecución: {progress.done + 1} de {progress.total} — {progress.current}</p>}
      {error && <p className="error" role="alert">Consulta fallida: {error}</p>}
    </>}
  </section>
}
