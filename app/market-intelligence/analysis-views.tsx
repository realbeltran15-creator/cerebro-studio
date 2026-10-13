'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { useResearch } from './research-context'
import { marketLabel } from '@/lib/research/markets'
import { formatOpportunity, type TopicAnalysis, type Verdict } from '@/lib/research/topic-analysis'
import { RPM_LABEL, formatAdjusted, nicheRpm } from '@/lib/research/monetization'
import { fmtNumber } from '@/lib/research/format'
import { nicheLabel } from '@/lib/research/taxonomy'
import { saveAnalysis } from '@/lib/research/save'
import { analysesCsv } from '@/lib/research/export'
import type { Market } from '@/lib/research/markets'

export const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  oportunidad: { label: 'Oportunidad', cls: 'ok' }, saturado: { label: 'Saturado', cls: 'bad' }, sin_demanda: { label: 'Sin demanda', cls: 'warn' }, mixto: { label: 'Señales mixtas', cls: 'info' },
}
export const INDEX_LABEL = { demand: 'Demanda', supply: 'Oferta', competition: 'Competencia', growth: 'Crecimiento', opportunity: 'Oportunidad' } as const
const INDEX_HELP: Record<keyof typeof INDEX_LABEL, string> = {
  demand: 'Vistas por día de los vídeos del tema (escala logarítmica).', supply: 'Cuánto se publica y por cuántos canales distintos.',
  competition: 'Tamaño y concentración de los canales que dominan.', growth: 'Si los vídeos recientes rinden al ritmo del top del año (50 = igual).', opportunity: 'Combina demanda alta con poca competencia y oferta; sin demanda nunca pasa de 20.',
}
const dateEs = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

export function IndexBar({ name, value }: { name: keyof typeof INDEX_LABEL; value: number }) {
  return <div title={INDEX_HELP[name]}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="small">{INDEX_LABEL[name]}</span><b className="small">{value}/100</b></div>
    <div className="indexBar" role="img" aria-label={`${INDEX_LABEL[name]} ${value} de 100`}><span style={{ width: `${value}%` }} /></div>
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
  const { filters } = useResearch()
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
  const rows = [...list].sort((a, b) => b.indices[index] - a.indices[index]).slice(0, 12), h = 26
  return <svg role="img" aria-label={`Gráfico de ${INDEX_LABEL[index]} por tema y mercado`} width="100%" viewBox={`0 0 640 ${rows.length * h + 8}`} style={{ maxWidth: 720 }}>
    {rows.map((a, i) => <g key={`${a.topic}|${a.region}|${a.language}`} transform={`translate(0 ${i * h + 4})`}>
      <text x="0" y="15" fontSize="12" fill="currentColor">{`${a.topic} · ${marketLabel(a.region, a.language)}`.slice(0, 34)}</text>
      <rect x="240" y="3" width="320" height="14" rx="7" fill="var(--line)" /><rect x="240" y="3" width={Math.max(a.indices[index] * 3.2, 2)} height="14" rx="7" fill="var(--accent)" />
      <text x="568" y="15" fontSize="12" fill="currentColor">{a.indices[index]}</text></g>)}
  </svg>
}

export function DownloadCsv({ list, name = 'investigacion' }: { list: TopicAnalysis[]; name?: string }) {
  return <button type="button" className="ghost" disabled={list.length === 0} onClick={() => {
    const url = URL.createObjectURL(new Blob([`﻿${analysesCsv(list)}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }}>Exportar CSV</button>
}

/** Cost, budget and confirmation for a batch of paid analyses, plus what happened last time. Nothing runs until the user presses the button. */
export function RunBar({ topics, markets, label = 'Analizar' }: { topics: string[]; markets?: Market[]; label?: string }) {
  const { plan, run, progress, cancel, usage, error, markets: current, lastRun, dirty, filters } = useResearch()
  const ms = markets ?? current
  const p = plan(topics, ms)
  const [ok, setOk] = useState(false)
  const needsOk = p.level === 'confirm'
  const disabled = !!progress || topics.length === 0 || p.level === 'blocked' || (needsOk && !ok)
  const failedNow = lastRun && lastRun.failed.length > 0
  return <div className="panel" style={{ margin: '10px 0' }} aria-label="Coste de la consulta">
    <p className="small"><b>Se analizará en:</b> {ms.map(m => m.label).join(' · ')} <span className="muted">(filtros {dirty ? 'con cambios SIN aplicar: se usan los aplicados' : 'aplicados'}; ventana de recientes: {filters.periodDays ?? 30} días)</span></p>
    <p className="small"><b>Coste previsto:</b> {p.message}</p>
    {usage && <p className="muted small">Hoy has usado {fmtNumber(usage.usedToday)} de {fmtNumber(usage.cap)} unidades de Investigación{usage.persistent ? '' : ' (contador en memoria: aplica la migración research_cache para que sea exacto y compartido)'}. YouTube concede 10.000 al día a todo el proyecto.</p>}
    {needsOk && <label className="msOpt"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> Entiendo que esto gastará {fmtNumber(p.units)} unidades de cuota</label>}
    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      <button type="button" disabled={disabled} onClick={() => { setOk(false); void run(topics, ms) }}>{progress ? 'Analizando…' : p.level === 'free' && topics.length ? 'Mostrar (en caché)' : `${label}${p.units ? ` (${fmtNumber(p.units)} unidades)` : ''}`}</button>
      {progress && <button type="button" className="ghost" onClick={cancel}>Cancelar</button>}
      {!progress && failedNow && <button type="button" className="ghost" disabled={topics.length === 0 || p.level === 'blocked'} onClick={() => void run(topics, ms)}>Reintentar lo que falló</button>}
    </div>
    {progress && <p className="muted small" role="status">En ejecución: {progress.done + 1} de {progress.total} — {progress.current}</p>}
    {!progress && lastRun && !failedNow && lastRun.ok > 0 && <p className="notice" role="status">Resultados actualizados: {lastRun.ok} análisis nuevo{lastRun.ok === 1 ? '' : 's'}{lastRun.units ? ` (${fmtNumber(lastRun.units)} unidades)` : ''}. Están más abajo.</p>}
    {!progress && lastRun && lastRun.total === 0 && <p className="muted small" role="status">No había nada nuevo que consultar: ya estaba todo en caché.</p>}
    {error && <p className="error" role="alert">Consulta fallida: {error}</p>}
  </div>
}
