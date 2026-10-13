'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { AnalysisCard, AnalysisChart, AnalysisTable, DownloadCsv, INDEX_LABEL, RunStatus, ViewToggle } from './analysis-views'
import { GuidedPanel } from './guided-panel'
import { useResearch } from './research-context'
import { keyOf, marketLabel } from '@/lib/research/markets'
import { keywordsCsv } from '@/lib/research/export'
import { passesRpmFilter } from '@/lib/research/monetization'
import { fmtNumber } from '@/lib/research/format'
import { forTab, type TabId } from '@/lib/research/filters'
import { formatCovered } from '@/lib/research/topic-analysis'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'

export type FilteredAnalyses = { rows: TopicAnalysis[]; hidden: TopicAnalysis[]; reasons: Array<{ group: string; count: number }>; showAll: boolean; setShowAll: (v: boolean) => void; notice: ReactNode }

/**
 * Analyses that match the APPLIED filters. Whatever is left out is counted, explained by filter and one click away: a paid analysis must never
 * disappear silently because of a filter.
 */
export function useFiltered(list: TopicAnalysis[], tab: TabId): FilteredAnalyses {
  const { filters: applied } = useResearch()
  const f = useMemo(() => forTab(tab, applied), [tab, applied])
  const [showAll, setShowAll] = useState(false)
  const verdicts = useMemo(() => list.map(a => {
    const why: string[] = []
    if (f.niches.length && !(f.logic.niches === 'all' ? f.niches.every(n => a.niches.includes(n)) : f.niches.some(n => a.niches.includes(n)))) why.push('nichos')
    if (f.countries.length && (!a.region || !f.countries.includes(a.region))) why.push('países')
    if ((f.rpm.min !== null || f.rpm.max !== null) && !(a.niches.length ? a.niches.some(n => passesRpmFilter(n, f.rpm)) : f.rpm.includeUnknown)) why.push('RPM estimado')
    if (f.formats.length && !formatCovered(a, f.formats)) why.push('formatos')
    return { a, why }
  }), [list, f])
  const hidden = verdicts.filter(v => v.why.length).map(v => v.a)
  const reasons = Object.entries(verdicts.flatMap(v => v.why).reduce<Record<string, number>>((m, g) => ({ ...m, [g]: (m[g] ?? 0) + 1 }), {})).map(([group, count]) => ({ group, count })).sort((x, y) => y.count - x.count)
  const rows = showAll ? list : verdicts.filter(v => !v.why.length).map(v => v.a)
  const notice = hidden.length === 0 ? null : <div className="warnBox" role="status" aria-label="Resultados ocultos por filtros">
    <p><b>{showAll ? `Mostrando todos los análisis (${list.length}).` : `${hidden.length} de ${list.length} análisis ocultos por tus filtros.`}</b> {reasons.map(r => `${r.group}: ${r.count}`).join(' · ')}.</p>
    <p className="muted small">Los filtros aplicados dejan fuera esos análisis; el gasto de cuota ya está hecho, no se pierde.</p>
    <button type="button" className="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Volver a aplicar los filtros' : 'Mostrar todos de todas formas'}</button>
  </div>
  return { rows, hidden, reasons, showAll, setShowAll, notice }
}

export function Results({ list, onSaved, empty }: { list: TopicAnalysis[]; onSaved?: () => void; empty: string }) {
  const [view, setView] = useState<'cards' | 'table' | 'chart'>('cards')
  const [index, setIndex] = useState<keyof typeof INDEX_LABEL>('opportunity')
  const sorted = useMemo(() => [...list].sort((a, b) => b.indices.opportunity - a.indices.opportunity), [list])
  if (!list.length) return <p className="emptyState">{empty}</p>
  return <>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
      <ViewToggle value={view} onChange={setView} />
      {view === 'chart' && <select value={index} onChange={e => setIndex(e.target.value as keyof typeof INDEX_LABEL)} aria-label="Índice del gráfico">{Object.entries(INDEX_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      <DownloadCsv list={sorted} />
    </div>
    {view === 'cards' && <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>{sorted.map(a => <AnalysisCard key={keyOf(a)} a={a} onSaved={onSaved} />)}</div>}
    {view === 'table' && <AnalysisTable list={sorted} />}
    {view === 'chart' && <AnalysisChart list={sorted} index={index} />}
  </>
}

/** Niche analysis: demand against supply for topics the user chooses. Replaces the old "neglected niches" shortcut. */
export function NichesTab({ onSaved }: { onSaved: () => void }) {
  const { list } = useResearch()
  const fa = useFiltered(list, 'niches')
  return <>
    <section className="panel" aria-label="Nichos descuidados y oportunidades">
      <h3>Nichos: demanda frente a oferta</h3>
      <p className="muted small" style={{ margin: '6px 0 10px' }}>Un nicho descuidado tiene demanda real y poca oferta o competencia débil. Poca oferta sin demanda <b>no</b> cuenta. Para cada tema se mide una muestra (25 más vistos del año + 25 más recientes): no es un censo de vídeos ni de creadores. Elige mercados y nichos arriba, escribe temas (o déjalo vacío para recibir ideas) y pulsa el botón de buscar: ese botón aplica los filtros y lanza la consulta.</p>
      <RunStatus />
      {fa.notice}
      <Results list={fa.rows} onSaved={onSaved} empty={list.length ? 'Todos los análisis quedan fuera con estos filtros: mira el aviso de arriba.' : 'Aún no hay análisis. Pulsa «Aplicar y buscar» arriba: verás demanda, oferta, competencia, crecimiento y por qué es o no una oportunidad.'} />
    </section>
    <GuidedPanel />
  </>
}

/** Keyword research from titles and tags of the sample. Relative signals only: the API gives no search volumes. */
export function KeywordsTab() {
  const { list } = useResearch()
  const fa = useFiltered(list, 'keywords')
  const mine = fa.rows
  const [pick, setPick] = useState('')
  const current = mine.find(a => keyOf(a) === pick) ?? mine[mine.length - 1]
  return <section className="panel" aria-label="Palabras clave">
    <h3>Palabras clave en YouTube</h3>
    <p className="warnBox" style={{ margin: '8px 0' }}>Aquí <b>no hay volúmenes de búsqueda</b>. Las frases salen de los títulos y etiquetas de vídeos reales de la muestra (señal relativa de lo que se publica y se ve), y las preguntas son títulos de vídeo formulados como pregunta. Google Trends (interés relativo) y el Planificador de Google Ads no están conectados: la API de Trends es alfa con acceso por solicitud y el Planificador exige una cuenta de Ads. Las sugerencias de autocompletado de YouTube no se consultan porque no tienen API oficial.</p>
    <p className="muted small" style={{ margin: '8px 0' }}>Escribe la palabra clave arriba, elige países, idiomas y periodo, y pulsa «Aplicar y buscar»: ese botón aplica los filtros y consulta cada mercado.</p>
    <RunStatus />
    {fa.notice}
    {mine.length === 0 ? <p className="emptyState">{list.length ? 'Todos los análisis quedan fuera con estos filtros: mira el aviso de arriba.' : 'Sin resultados todavía.'}</p> : <>
      <label className="muted small" htmlFor="kwpick">Ver resultados de</label>
      <select id="kwpick" value={current ? keyOf(current) : ''} onChange={e => setPick(e.target.value)}>{mine.map(a => <option key={keyOf(a)} value={keyOf(a)}>{a.topic} · {marketLabel(a.region, a.language)}</option>)}</select>
      {current && <KeywordDetail a={current} />}
      {mine.length > 1 && <KeywordCompare list={mine} />}
    </>}
  </section>
}

function KeywordDetail({ a }: { a: TopicAnalysis }) {
  return <div style={{ marginTop: 10 }}>
    <p className="muted small">Fuente: YouTube Data API (muestra de {a.sampleSizes.top + a.sampleSizes.recent} vídeos) · {new Date(a.fetchedAt).toLocaleDateString('es-ES')} · mercado {marketLabel(a.region, a.language)} · <span className="tag calculado">calculado</span></p>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', marginTop: 8 }}>
      <article><h3>Frases relacionadas</h3><table className="dataTable"><thead><tr><th>Frase</th><th>Vídeos</th><th>Vistas</th></tr></thead><tbody>{a.terms.slice(0, 15).map(t => <tr key={t.term}><td>{t.term}</td><td>{t.videos}</td><td>{fmtNumber(t.views)}</td></tr>)}</tbody></table>{a.terms.length === 0 && <p className="muted small">La muestra no repite ninguna frase.</p>}</article>
      <article><h3>Preguntas frecuentes (en títulos)</h3>{a.questions.length ? <ul className="small" style={{ marginLeft: 16 }}>{a.questions.map(q => <li key={q.videoId}><a href={`https://www.youtube.com/watch?v=${q.videoId}`} target="_blank" rel="noopener noreferrer">{q.text}</a>{q.views !== null && <span className="muted"> · {fmtNumber(q.views)} vistas</span>}</li>)}</ul> : <p className="muted small">No hay títulos con forma de pregunta en la muestra.</p>}</article>
      <article><h3>Búsquedas emergentes</h3>{a.emerging.length ? <div className="legend">{a.emerging.map(t => <span key={t.term} className="pill ok">{t.term} · {t.videos}</span>)}</div> : <p className="muted small">Ninguna frase pesa claramente más en los vídeos recientes que en el top del año.</p>}<p className="muted small" style={{ marginTop: 6 }}>Frases que aparecen más en los vídeos de los últimos 30 días que entre los más vistos del año.</p></article>
      <article><h3>Shorts y vídeos largos</h3><p className="small">Shorts (inferidos por duración): {a.byFormat.short.count} entre los más vistos, {a.byFormat.short.recentCount} recientes · mediana {a.byFormat.short.medianViewsPerDay ?? '—'} vistas/día.</p><p className="small">Vídeos de más de 1 min: {a.byFormat.long.count} entre los más vistos, {a.byFormat.long.recentCount} recientes · mediana {a.byFormat.long.medianViewsPerDay ?? '—'} vistas/día.</p></article>
    </div>
    <button type="button" className="ghost" onClick={() => { const url = URL.createObjectURL(new Blob([`﻿${keywordsCsv(a)}`], { type: 'text/csv;charset=utf-8' })); const l = document.createElement('a'); l.href = url; l.download = `palabras-clave-${a.topic.replace(/\W+/g, '-')}.csv`; l.click(); URL.revokeObjectURL(url) }} style={{ marginTop: 10 }}>Exportar palabras clave (CSV)</button>
  </div>
}

/** Same words across markets, side by side. Each market is its own sample, so shares are comparable but not absolute. */
function KeywordCompare({ list }: { list: TopicAnalysis[] }) {
  const cols = list.slice(0, 5)
  const terms = [...new Set(cols.flatMap(a => a.terms.slice(0, 8).map(t => t.term)))].slice(0, 16)
  return <details style={{ marginTop: 12 }} open><summary><b>Comparar mercados</b></summary>
    <p className="muted small">Cada celda es la proporción de vídeos de la muestra de ese mercado que contiene la frase. Las muestras son de 50 vídeos como máximo en cada mercado.</p>
    <div className="tableScroll"><table className="dataTable"><thead><tr><th>Frase</th>{cols.map(a => <th key={keyOf(a)}>{a.topic}<br />{marketLabel(a.region, a.language)}</th>)}</tr></thead>
      <tbody>{terms.map(t => <tr key={t}><td>{t}</td>{cols.map(a => { const x = a.terms.find(y => y.term === t); return <td key={keyOf(a)}>{x ? `${Math.round(x.share * 100)} %` : '—'}</td> })}</tr>)}</tbody></table></div>
  </details>
}

/** Side-by-side comparison of everything analysed, with the differences in data coverage stated. */
export function CompareTab({ onSaved }: { onSaved: () => void }) {
  const { list, filters } = useResearch()
  const fa = useFiltered(list, 'compare')
  const shown = fa.rows
  const needAll = filters.logic.countries === 'all' && filters.countries.length > 1
  const rows = needAll ? shown.filter(a => shown.filter(b => b.topic.toLowerCase() === a.topic.toLowerCase()).map(b => b.region).filter(Boolean).length >= filters.countries.length && filters.countries.every(c => shown.some(b => b.topic.toLowerCase() === a.topic.toLowerCase() && b.region === c))) : shown
  const poor = rows.filter(a => a.confidence === 'baja' || a.sampleSizes.top < 20)
  return <section className="panel" aria-label="Comparador avanzado">
    <h3>Comparador avanzado</h3>
    <p className="muted small" style={{ margin: '6px 0 10px' }}>Compara cualquier tema y mercado ya analizado. {needAll ? 'Con «Todos (AND)» en países solo salen temas analizados en cada país elegido.' : 'Los análisis se hacen en las otras secciones; aquí no se gasta cuota.'}</p>
    {poor.length > 0 && <p className="warnBox" role="status">Cobertura desigual: {poor.length} de {rows.length} análisis tienen muestra pequeña o confianza baja ({poor.slice(0, 3).map(a => `${a.topic} · ${marketLabel(a.region, a.language)}`).join('; ')}). Compara con cautela: no son datos equivalentes.</p>}
    {fa.notice}
    <Results list={rows} onSaved={onSaved} empty={list.length ? 'Ningún análisis cumple los filtros: mira el aviso de arriba.' : 'Aún no hay análisis que comparar. Hazlos en Nichos o Palabras clave.'} />
  </section>
}
