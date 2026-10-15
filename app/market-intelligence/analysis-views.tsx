'use client'

import Link from 'next/link'
import { campaignLink } from '@/lib/campaigns/link'
import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { useResearch } from './research-context'
import { marketLabel } from '@/lib/research/markets'
import { formatOpportunity, type TopicAnalysis, type Verdict } from '@/lib/research/topic-analysis'
import { RPM_LABEL, formatAdjusted, nicheRpm } from '@/lib/research/monetization'
import { fmtNumber } from '@/lib/research/format'
import { UNITS } from '@/lib/research/filters'
import { SampleInspector } from './sample-inspector'
import { nicheLabel } from '@/lib/research/taxonomy'
import { saveAnalysis } from '@/lib/research/save'
import { analysesCsv } from '@/lib/research/export'

export const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  oportunidad: { label: 'Oportunidad', cls: 'ok' }, saturado: { label: 'Saturado', cls: 'bad' }, sin_demanda: { label: 'Sin demanda', cls: 'warn' }, mixto: { label: 'Señales mixtas', cls: 'info' },
}
export const INDEX_LABEL = { demand: 'Demanda', supply: 'Oferta', competition: 'Competencia', growth: 'Crecimiento', opportunity: 'Oportunidad' } as const
const INDEX_HELP: Record<keyof typeof INDEX_LABEL, string> = {
  demand: 'Vistas por día de los vídeos del tema (escala logarítmica).', supply: 'Cuánto se publica y por cuántos canales distintos.',
  competition: 'Tamaño y concentración de los canales que dominan.', growth: 'Compara dos ventanas seguidas de la misma duración (50 = estable). Sin ellas: No calculable.', opportunity: 'Combina demanda alta con poca competencia y oferta; sin demanda nunca pasa de 20.',
}
const dateEs = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

export function IndexBar({ name, value }: { name: keyof typeof INDEX_LABEL; value: number | null }) {
  return <div title={INDEX_HELP[name]}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="small">{INDEX_LABEL[name]}</span><b className="small">{value === null ? 'No calculable' : `${value}/100`}</b></div>
    <div className="indexBar" role="img" aria-label={value === null ? `${INDEX_LABEL[name]}: no calculable` : `${INDEX_LABEL[name]} ${value} de 100`}><span style={{ width: `${value ?? 0}%` }} /></div>
  </div>
}

export function RpmLine({ niche, format = 'long' }: { niche: string; format?: 'long' | 'short' }) {
  const r = formatAdjusted(nicheRpm(niche), format)
  if (r.status === 'desconocido') return <p className="small"><span className="tag desconocido">{RPM_LABEL.desconocido}</span> {nicheLabel(niche)}: {r.reason}</p>
  return <p className="small"><span className="tag estimado">{RPM_LABEL.estimado}</span> {nicheLabel(niche)}: ${r.low}–${r.high} por 1000 visitas ({r.midIsMedian ? 'mediana' : 'punto medio'} ${r.mid}) · confianza {r.confidence}. <span className="muted">{r.note}</span></p>
}

export function AnalysisCard({ a, onSaved }: { a: TopicAnalysis; onSaved?: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'exists' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const v = VERDICT[a.verdict], fo = formatOpportunity(a)
  const { filters, measureGrowth, growthBusy } = useResearch()
  const chosen = filters.formats.filter(x => x !== 'live')
  async function save() {
    setState('saving'); setMsg('')
    try { const r = await saveAnalysis(supabase as never, a); setState(r); onSaved?.() } catch (e) { setState('error'); setMsg(e instanceof Error ? e.message : 'No se pudo guardar.') }
  }
  return <article aria-label={`Análisis de ${a.topic}`}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <h3>{a.topic}</h3><span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className="pill">{marketLabel(a.region, a.language)}</span><span className={`pill ${v.cls}`}>{v.label}</span></span>
    </div>
    <p className="muted small">{a.sampleSizes.top} + {a.sampleSizes.recent} vídeos en la muestra (recientes = últimos {a.recentDays ?? 30} días) · actualizado {dateEs(a.fetchedAt)}</p>
    <p style={{ margin: '8px 0' }}><b>{a.headline}.</b></p>
    <div style={{ display: 'grid', gap: 8 }}>{(Object.keys(INDEX_LABEL) as Array<keyof typeof INDEX_LABEL>).map(k => <IndexBar key={k} name={k} value={a.indices[k]} />)}</div>
    <ul className="small" style={{ margin: '10px 0 0 16px' }}>{a.reasons.map(r => <li key={r}>{r}</li>)}</ul>
    {a.growth.state === 'no_calculable' && <p className="small" style={{ marginTop: 8 }}><button type="button" className="ghost" disabled={growthBusy} onClick={() => void measureGrowth(a)}>{growthBusy ? 'Midiendo…' : `Medir crecimiento (+${UNITS.search} unidades)`}</button> <span className="muted">Compara los últimos {a.recentDays} días con los {a.recentDays} anteriores.</span></p>}
    {a.quality && <p className="small muted" style={{ marginTop: 8 }}>Calidad de la muestra: {a.quality.kept} de {a.quality.examined} resultados cuentan; {a.quality.excluded.tema + a.quality.excluded.nicho + a.quality.excluded.sentido} son de otro tema o significado, {a.quality.excluded.idioma} de otro idioma, {a.quality.excluded.directo} directos y {a.quality.uncertain} dudosos. Fuera de la demanda: {a.quality.promo} posibles anuncios y {a.quality.outliers} virales atípicos. Idioma sin verificar: {a.quality.languageUnverified}.{a.region && a.quality.channelCountryKnown ? ` Canales con país ${a.region}: ${a.quality.channelInMarket} de ${a.quality.channelCountryKnown} que declaran país (el país de búsqueda no garantiza el del vídeo).` : ''}</p>}
    <SampleInspector a={a} />
    <p className="small" style={{ marginTop: 8 }}><b>Formato:</b> {fo.recommended ? (fo.recommended === 'short' ? 'Shorts' : 'vídeo largo') : 'sin preferencia clara'} — {fo.reason}</p>
    {chosen.length > 0 && <p className="small" aria-label="Evidencia del formato elegido"><b>Formato elegido:</b> {chosen.map(f => f === 'short' ? `Shorts (inferidos): ${a.byFormat.short.count} en el top, ${a.byFormat.short.recentCount} recientes, mediana ${a.byFormat.short.medianViewsPerDay ?? '—'} vistas/día` : `vídeos de más de 1 min: ${a.byFormat.long.count} en el top, ${a.byFormat.long.recentCount} recientes, mediana ${a.byFormat.long.medianViewsPerDay ?? '—'} vistas/día`).filter((x, i, l) => l.indexOf(x) === i).join(' · ')}.</p>}
    {a.niches.slice(0, 2).map(n => <RpmLine key={n} niche={n} format={chosen.length === 1 && chosen[0] === 'short' ? 'short' : 'long'} />)}
    <details style={{ marginTop: 8 }}><summary className="small">Evidencia y confianza ({a.confidence})</summary>
      <table className="dataTable"><tbody>{a.evidence.map(e => <tr key={e.label}><td>{e.label}</td><td><b>{e.value}</b></td><td><span className={`tag ${e.kind}`}>{e.kind}</span></td></tr>)}</tbody></table>
      <p className="muted small" style={{ marginTop: 6 }}>{a.confidenceNote}</p>
      <p className="muted small">Fuente: YouTube Data API (search.list + videos.list + channels.list), muestra del {dateEs(a.fetchedAt)}. Índices calculados por Cerebro Studio; no predicen visualizaciones ni ingresos.</p>
    </details>
    {a.terms.length > 0 && <div className="legend" style={{ marginTop: 8 }}>{a.terms.slice(0, 6).map(t => <span key={t.term} className="pill">{t.term} · {t.videos}</span>)}</div>}
    <button type="button" className={state === 'saved' || state === 'exists' ? 'ghost' : undefined} disabled={state === 'saving' || state === 'saved' || state === 'exists'} onClick={() => void save()} style={{ marginTop: 10 }}>
      {state === 'saving' ? 'Guardando…' : state === 'saved' ? 'Guardado en Oportunidades' : state === 'exists' ? 'Ya estaba guardado' : 'Guardar para investigar después'}
    </button>
    {' '}<Link className="open" href={campaignLink({ topic: a.topic, region: a.region, language: a.language, verdict: a.verdict, demand: a.indices.demand, competition: a.indices.competition, opportunity: a.indices.opportunity, fetchedAt: a.fetchedAt })}>Planificar campaña</Link>
    {state === 'error' && <p className="error" role="alert">{msg}</p>}
  </article>
}

export function ViewToggle({ value, onChange }: { value: 'cards' | 'table' | 'chart'; onChange: (v: 'cards' | 'table' | 'chart') => void }) {
  return <div className="viewToggle" role="group" aria-label="Vista de resultados">{(['cards', 'table', 'chart'] as const).map(v => <button key={v} type="button" className={value === v ? undefined : 'ghost'} aria-pressed={value === v} onClick={() => onChange(v)}>{v === 'cards' ? 'Tarjetas' : v === 'table' ? 'Tabla' : 'Gráfico'}</button>)}</div>
}

export function AnalysisTable({ list }: { list: TopicAnalysis[] }) {
  return <div className="tableScroll"><table className="dataTable"><thead><tr><th>Tema</th><th>Mercado</th><th>Veredicto</th><th>Demanda</th><th>Oferta</th><th>Competencia</th><th>Crecim.</th><th>Oportunidad</th><th>Confianza</th></tr></thead>
    <tbody>{list.map(a => <tr key={`${a.topic}|${a.region}|${a.language}`}><td>{a.topic}</td><td>{marketLabel(a.region, a.language)}</td><td>{VERDICT[a.verdict].label}</td><td>{a.indices.demand}</td><td>{a.indices.supply}</td><td>{a.indices.competition}</td><td>{a.indices.growth}</td><td><b>{a.indices.opportunity}</b></td><td>{a.confidence}</td></tr>)}</tbody></table></div>
}

/** Simple SVG bars: one per analysis, for the chosen index. No chart library needed. */
export function AnalysisChart({ list, index }: { list: TopicAnalysis[]; index: keyof typeof INDEX_LABEL }) {
  const val = (a: TopicAnalysis) => a.indices[index]
  const rows = [...list].sort((a, b) => (val(b) ?? -1) - (val(a) ?? -1)).slice(0, 12), h = 26
  return <svg role="img" aria-label={`Gráfico de ${INDEX_LABEL[index]} por tema y mercado`} width="100%" viewBox={`0 0 640 ${rows.length * h + 8}`} style={{ maxWidth: 720 }}>
    {rows.map((a, i) => <g key={`${a.topic}|${a.region}|${a.language}`} transform={`translate(0 ${i * h + 4})`}>
      <text x="0" y="15" fontSize="12" fill="currentColor">{`${a.topic} · ${marketLabel(a.region, a.language)}`.slice(0, 34)}</text>
      <rect x="240" y="3" width="320" height="14" rx="7" fill="var(--line)" /><rect x="240" y="3" width={Math.max((val(a) ?? 0) * 3.2, 2)} height="14" rx="7" fill="var(--accent)" />
      <text x="568" y="15" fontSize="12" fill="currentColor">{val(a) ?? 'n/c'}</text></g>)}
  </svg>
}

export function DownloadCsv({ list, name = 'investigacion' }: { list: TopicAnalysis[]; name?: string }) {
  return <button type="button" className="ghost" disabled={list.length === 0} onClick={() => {
    const url = URL.createObjectURL(new Blob([`﻿${analysesCsv(list)}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }}>Exportar CSV</button>
}

/**
 * What is happening with the last query: running, updated, failed (with retry) or nothing new. The cost and the confirmation live next to the
 * Apply button in the filter panel, so this only reports.
 */
export function RunStatus() {
  const { progress, error, lastRun, lastPlan, runPlan, search, chartsBusy, chartsError } = useResearch()
  const failedNow = lastRun && lastRun.failed.length > 0
  const anyError = error || search.error || chartsError
  return <div aria-label="Estado de la consulta">
    {(progress || chartsBusy || search.busy) && <p className="notice" role="status">En ejecución{progress ? `: ${progress.done + 1} de ${progress.total} — ${progress.current}` : search.busy ? ': buscando vídeos…' : ': cargando tendencias…'}</p>}
    {!progress && lastRun && !failedNow && lastRun.ok > 0 && <p className="notice" role="status">Resultados actualizados: {lastRun.ok} análisis nuevo{lastRun.ok === 1 ? '' : 's'}{lastRun.units ? ` (${fmtNumber(lastRun.units)} unidades)` : ''}. Están más abajo.</p>}
    {!progress && lastRun && lastRun.total === 0 && <p className="muted small" role="status">No había nada nuevo que consultar: ya estaba todo en caché.</p>}
    {search.done && <p className="notice" role="status">{search.done}</p>}
    {anyError && <p className="error" role="alert">Consulta fallida: {anyError}</p>}
    {!progress && !search.busy && (failedNow || anyError) && lastPlan && <button type="button" className="ghost" onClick={() => void runPlan(lastPlan)}>Reintentar lo que falló</button>}
  </div>
}
