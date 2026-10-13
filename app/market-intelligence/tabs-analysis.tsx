'use client'

import { useMemo, useState } from 'react'
import { AnalysisCard, AnalysisChart, AnalysisTable, DownloadCsv, INDEX_LABEL, RunBar, ViewToggle } from './analysis-views'
import { useResearch } from './research-context'
import { NICHES, nicheLabel } from '@/lib/research/taxonomy'
import { analysisKey, marketLabel } from '@/lib/research/markets'
import { keywordsCsv } from '@/lib/research/export'
import { passesRpmFilter } from '@/lib/research/monetization'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'

const parseTopics = (text: string) => [...new Set(text.split(/[\n,;]+/).map(t => t.trim().replace(/\s+/g, ' ')).filter(t => t.length >= 2 && t.length <= 120))].slice(0, 6)

/** Analyses that survive the shared filters (niche, RPM, countries). Language/format/period filters apply to videos, not to a topic. */
export function useFiltered(list: TopicAnalysis[]) {
  const { filters: f } = useResearch()
  return useMemo(() => list.filter(a => {
    if (f.niches.length && !(f.logic.niches === 'all' ? f.niches.every(n => a.niches.includes(n)) : f.niches.some(n => a.niches.includes(n)))) return false
    if (f.countries.length && (!a.region || !f.countries.includes(a.region))) return false
    if ((f.rpm.min !== null || f.rpm.max !== null) && !(a.niches.length ? a.niches.some(n => passesRpmFilter(n, f.rpm)) : f.rpm.includeUnknown)) return false
    return true
  }), [list, f])
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
    {view === 'cards' && <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>{sorted.map(a => <AnalysisCard key={analysisKey(a.topic, a.region, a.language)} a={a} onSaved={onSaved} />)}</div>}
    {view === 'table' && <AnalysisTable list={sorted} />}
    {view === 'chart' && <AnalysisChart list={sorted} index={index} />}
  </>
}

/** Niche analysis: demand against supply for topics the user chooses. Replaces the old "neglected niches" shortcut. */
export function NichesTab({ onSaved }: { onSaved: () => void }) {
  const { filters, list, markets } = useResearch()
  const [text, setText] = useState('')
  const typed = parseTopics(text)
  const suggestions = (filters.niches.length ? NICHES.filter(n => filters.niches.includes(n.id)) : NICHES.slice(0, 6)).flatMap(n => n.seeds.slice(0, 2).map(s => ({ s, niche: n.id })))
  const shown = useFiltered(list)
  return <section className="panel" aria-label="Nichos descuidados y oportunidades">
    <h3>Nichos: demanda frente a oferta</h3>
    <p className="muted small" style={{ margin: '6px 0 10px' }}>Un nicho descuidado tiene demanda real y poca oferta o competencia débil. Poca oferta sin demanda <b>no</b> cuenta. Para cada tema se mide una muestra (25 más vistos del año + 25 más recientes): no es un censo de vídeos ni de creadores.</p>
    <label className="muted small" htmlFor="topics">Temas o subnichos (uno por línea o separados por comas, hasta 6)</label>
    <textarea id="topics" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="historia medieval, huerto en casa, ia para negocios" style={{ width: '100%' }} />
    <div className="legend" style={{ margin: '8px 0' }}>{suggestions.map(x => <button key={x.s} type="button" className="pill" onClick={() => setText(t => parseTopics(`${t}, ${x.s}`).join(', '))} title={nicheLabel(x.niche)}>+ {x.s}</button>)}</div>
    <p className="muted small">Mercados: {markets.map(m => m.label).join(' · ')} (cámbialos en los filtros).</p>
    <RunBar topics={typed} label="Analizar nichos" />
    <Results list={shown} onSaved={onSaved} empty="Aún no hay análisis. Elige temas y pulsa Analizar: verás demanda, oferta, competencia, crecimiento y por qué es o no una oportunidad." />
  </section>
}

/** Keyword research from titles and tags of the sample. Relative signals only: the API gives no search volumes. */
export function KeywordsTab() {
  const { list, markets } = useResearch()
  const [text, setText] = useState('')
  const typed = parseTopics(text).slice(0, 3)
  const mine = useFiltered(list)
  const [pick, setPick] = useState('')
  const current = mine.find(a => analysisKey(a.topic, a.region, a.language) === pick) ?? mine[mine.length - 1]
  return <section className="panel" aria-label="Palabras clave">
    <h3>Palabras clave en YouTube</h3>
    <p className="warnBox" style={{ margin: '8px 0' }}>Aquí <b>no hay volúmenes de búsqueda</b>. Las frases salen de los títulos y etiquetas de vídeos reales de la muestra (señal relativa de lo que se publica y se ve), y las preguntas son títulos de vídeo formulados como pregunta. Google Trends (interés relativo) y el Planificador de Google Ads no están conectados: la API de Trends es alfa con acceso por solicitud y el Planificador exige una cuenta de Ads. Las sugerencias de autocompletado de YouTube no se consultan porque no tienen API oficial.</p>
    <label className="muted small" htmlFor="kw">Palabra clave (hasta 3)</label>
    <input id="kw" value={text} onChange={e => setText(e.target.value)} placeholder="invertir en bolsa" maxLength={200} style={{ width: '100%' }} />
    <p className="muted small" style={{ marginTop: 6 }}>Se consulta en: {markets.map(m => m.label).join(' · ')}. Para comparar países o idiomas, elígelos en los filtros.</p>
    <RunBar topics={typed} label="Investigar palabra clave" />
    {mine.length === 0 ? <p className="emptyState">Sin resultados todavía.</p> : <>
      <label className="muted small" htmlFor="kwpick">Ver resultados de</label>
      <select id="kwpick" value={current ? analysisKey(current.topic, current.region, current.language) : ''} onChange={e => setPick(e.target.value)}>{mine.map(a => <option key={analysisKey(a.topic, a.region, a.language)} value={analysisKey(a.topic, a.region, a.language)}>{a.topic} · {marketLabel(a.region, a.language)}</option>)}</select>
      {current && <KeywordDetail a={current} />}
      {mine.length > 1 && <KeywordCompare list={mine} />}
    </>}
  </section>
}

function KeywordDetail({ a }: { a: TopicAnalysis }) {
  return <div style={{ marginTop: 10 }}>
    <p className="muted small">Fuente: YouTube Data API (muestra de {a.sampleSizes.top + a.sampleSizes.recent} vídeos) · {new Date(a.fetchedAt).toLocaleDateString('es-ES')} · mercado {marketLabel(a.region, a.language)} · <span className="tag calculado">calculado</span></p>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', marginTop: 8 }}>
      <article><h3>Frases relacionadas</h3><table className="dataTable"><thead><tr><th>Frase</th><th>Vídeos</th><th>Vistas</th></tr></thead><tbody>{a.terms.slice(0, 15).map(t => <tr key={t.term}><td>{t.term}</td><td>{t.videos}</td><td>{t.views.toLocaleString('es-ES')}</td></tr>)}</tbody></table>{a.terms.length === 0 && <p className="muted small">La muestra no repite ninguna frase.</p>}</article>
      <article><h3>Preguntas frecuentes (en títulos)</h3>{a.questions.length ? <ul className="small" style={{ marginLeft: 16 }}>{a.questions.map(q => <li key={q.videoId}><a href={`https://www.youtube.com/watch?v=${q.videoId}`} target="_blank" rel="noopener noreferrer">{q.text}</a>{q.views !== null && <span className="muted"> · {q.views.toLocaleString('es-ES')} vistas</span>}</li>)}</ul> : <p className="muted small">No hay títulos con forma de pregunta en la muestra.</p>}</article>
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
    <div className="tableScroll"><table className="dataTable"><thead><tr><th>Frase</th>{cols.map(a => <th key={analysisKey(a.topic, a.region, a.language)}>{a.topic}<br />{marketLabel(a.region, a.language)}</th>)}</tr></thead>
      <tbody>{terms.map(t => <tr key={t}><td>{t}</td>{cols.map(a => { const x = a.terms.find(y => y.term === t); return <td key={analysisKey(a.topic, a.region, a.language)}>{x ? `${Math.round(x.share * 100)} %` : '—'}</td> })}</tr>)}</tbody></table></div>
  </details>
}

/** Side-by-side comparison of everything analysed, with the differences in data coverage stated. */
export function CompareTab({ onSaved }: { onSaved: () => void }) {
  const { list, filters } = useResearch()
  const shown = useFiltered(list)
  const needAll = filters.logic.countries === 'all' && filters.countries.length > 1
  const rows = needAll ? shown.filter(a => shown.filter(b => b.topic.toLowerCase() === a.topic.toLowerCase()).map(b => b.region).filter(Boolean).length >= filters.countries.length && filters.countries.every(c => shown.some(b => b.topic.toLowerCase() === a.topic.toLowerCase() && b.region === c))) : shown
  const poor = rows.filter(a => a.confidence === 'baja' || a.sampleSizes.top < 20)
  return <section className="panel" aria-label="Comparador avanzado">
    <h3>Comparador avanzado</h3>
    <p className="muted small" style={{ margin: '6px 0 10px' }}>Compara cualquier tema y mercado ya analizado. {needAll ? 'Con «Todos (AND)» en países solo salen temas analizados en cada país elegido.' : 'Los análisis se hacen en las otras secciones; aquí no se gasta cuota.'}</p>
    {poor.length > 0 && <p className="warnBox" role="status">Cobertura desigual: {poor.length} de {rows.length} análisis tienen muestra pequeña o confianza baja ({poor.slice(0, 3).map(a => `${a.topic} · ${marketLabel(a.region, a.language)}`).join('; ')}). Compara con cautela: no son datos equivalentes.</p>}
    <Results list={rows} onSaved={onSaved} empty="No hay análisis que comparar con estos filtros." />
  </section>
}
