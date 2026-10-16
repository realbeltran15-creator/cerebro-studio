'use client'

import { useMemo } from 'react'
import { OPP_TITLES, detectOpportunities, type Opportunity } from '@/lib/research/opportunities'
import { compareMarkets } from '@/lib/research/markets-info'
import { marketLabel } from '@/lib/research/markets'
import { methodLines } from '@/lib/research/statistics'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'

const STRENGTH: Record<Opportunity['strength'], { label: string; cls: string }> = {
  fuerte: { label: 'Señal fuerte', cls: 'good' }, moderada: { label: 'Señal moderada', cls: '' }, indicio: { label: 'Solo un indicio', cls: 'warn' }, a_verificar: { label: 'A verificar: no es una oportunidad', cls: 'warn' },
}
const LEVEL = { baja: 'Baja', media: 'Media', alta: 'Alta', 'sin datos': 'Sin datos suficientes' } as const

/** Inside each analysis: how firm the result is and exactly how it was calculated. */
export function HowItIsCalculated({ a }: { a: TopicAnalysis }) {
  const s = a.stats
  return <details style={{ marginTop: 8 }}>
    <summary className="small">Qué tan firme es y cómo se calcula</summary>
    {s ? <ul className="small" style={{ margin: '6px 0 0 16px' }}>
      <li><b>Tipo de demanda:</b> {s.demandProfile.kind === 'insuficiente' ? 'sin datos suficientes' : s.demandProfile.kind}. {s.demandProfile.note}</li>
      <li><b>Dificultad de entrada:</b> {LEVEL[s.entry.level]}{s.entry.saturated ? ' (nicho saturado)' : ''}. {s.entry.note}</li>
      <li><b>Reparto de vistas entre canales:</b> {LEVEL[s.concentration.level]}{s.concentration.hhi !== null ? ` · los 3 mayores reúnen el ${Math.round(s.concentration.top3 * 100)} %` : ''}.</li>
      {s.demandInterval && <li><b>Rango de las vistas diarias típicas:</b> entre {Math.round(s.demandInterval.lo).toLocaleString('es-ES')} y {Math.round(s.demandInterval.hi).toLocaleString('es-ES')} (intervalo del ~95 % para la mediana de esta muestra).</li>}
      <li><b>Sensibilidad:</b> {s.sensitivity.note}</li>
    </ul> : <p className="small muted">Este análisis se guardó antes de existir la lectura estadística: vuelve a analizarlo si quieres verla.</p>}
    <p className="small" style={{ margin: '8px 0 2px' }}><b>Cómo se construyen las puntuaciones</b></p>
    <ul className="small muted" style={{ margin: '0 0 0 16px' }}>{methodLines().map(l => <li key={l}>{l}</li>)}</ul>
  </details>
}

function OppCard({ o }: { o: Opportunity }) {
  const st = STRENGTH[o.strength]
  return <article className="panel" aria-label={`Hueco: ${o.topic}`} style={{ marginBottom: 10 }}>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'space-between' }}><h4 style={{ margin: 0 }}>{OPP_TITLES[o.kind]} · {o.topic}</h4><span style={{ display: 'flex', gap: 6 }}><span className="pill">{o.market}</span><span className={`pill ${st.cls}`}>{st.label}</span></span></div>
    <p style={{ margin: '6px 0' }}><b>{o.claim}</b></p>
    <p className="small muted">Demanda {o.demand} · Competencia {o.competition} · Oferta {o.supply} (de 100)</p>
    <ul className="small" style={{ margin: '6px 0 0 16px' }}>{o.evidence.map((e, i) => <li key={`${e.label}${i}`}>{e.thumbnailUrl && e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}><img src={e.thumbnailUrl} alt="" width={64} height={36} loading="lazy" style={{ verticalAlign: 'middle', borderRadius: 4 }} /></a> : null}<b>{e.label}:</b> {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.value}</a> : e.value}</li>)}</ul>
    <p className="small" style={{ marginTop: 6 }}><b>Qué podría fallar:</b> {o.uncertainty}</p>
    <p className="small"><b>Tipo de canal:</b> {o.channelType} <b>Formatos:</b> {o.formats.join(', ')}.</p>
    <p className="small"><b>Siguiente paso:</b> {o.nextStep}</p>
  </article>
}

/** Underserved niches found in the analyses already made: no new queries, no invented entries. */
export function OpportunitiesPanel({ list }: { list: TopicAnalysis[] }) {
  const opps = useMemo(() => detectOpportunities(list), [list])
  const real = opps.filter(o => o.strength !== 'a_verificar'), weak = opps.filter(o => o.strength === 'a_verificar')
  return <section className="panel" aria-label="Huecos detectados" style={{ marginTop: 14 }}>
    <h3>Huecos detectados en tus análisis</h3>
    <p className="muted small" style={{ margin: '4px 0 10px' }}>Se calculan con los análisis que ya tienes (no gastan cuota). Que haya pocos vídeos nunca se cuenta como demanda: cada hueco necesita vistas observadas y te dice qué podría fallar.</p>
    {list.length === 0 && <p className="emptyState">Aún no hay análisis. Analiza algunos temas y aquí aparecerán los huecos que se vean.</p>}
    {list.length > 0 && real.length === 0 && <p className="emptyState">Con los datos actuales no hay ningún hueco que se sostenga: o la muestra relevante es pequeña, o los temas ya están cubiertos. No se rellena la lista con apuestas dudosas.</p>}
    {real.map(o => <OppCard key={o.id} o={o} />)}
    {weak.length > 0 && <details><summary className="small">Señales débiles que conviene verificar ({weak.length})</summary>{weak.map(o => <OppCard key={o.id} o={o} />)}</details>}
  </section>
}

const LEVEL_TXT = { comparable: 'Comparable', parcial: 'Comparable solo en parte', no_comparable: 'No comparable' } as const

/** Side-by-side markets for one topic, with what may and may not be compared. */
export function MarketComparisonPanel({ rows }: { rows: TopicAnalysis[] }) {
  const cmp = useMemo(() => compareMarkets(rows.map(a => ({ key: marketLabel(a.region, a.language), label: marketLabel(a.region, a.language), region: a.region, language: a.language, analysis: a }))), [rows])
  if (!cmp) return null
  return <section className="panel" aria-label="Comparación entre mercados" style={{ marginTop: 14 }}>
    <h3>Comparación entre mercados: «{cmp.topic}»</h3>
    <div style={{ overflowX: 'auto' }}><table className="dataTable"><thead><tr><th>Mercado</th><th>Demanda</th><th>Competencia</th><th>Oferta</th><th>Oportunidad</th><th>Crecimiento</th><th>Vídeos relevantes</th><th>Confianza</th></tr></thead>
      <tbody>{cmp.columns.map(c => <tr key={c.key}><td>{c.label}</td><td>{c.demand}</td><td>{c.competition}</td><td>{c.supply}</td><td>{c.opportunity}</td><td>{c.growth}</td><td>{c.relevantVideos}</td><td>{c.confidence}</td></tr>)}</tbody></table></div>
    <ul className="small" style={{ margin: '8px 0 0 16px' }}>{cmp.findings.map(f => <li key={f}>{f}</li>)}</ul>
    <details style={{ marginTop: 6 }}><summary className="small">¿Se pueden comparar estos mercados?</summary>
      <ul className="small" style={{ margin: '6px 0 0 16px' }}>{cmp.pairs.map(p => <li key={p.a + p.b}><b>{p.a} ↔ {p.b}: {LEVEL_TXT[p.level]}.</b> {p.reasons.join(' ')}</li>)}</ul>
      <p className="small" style={{ margin: '8px 0 2px' }}><b>Límites de los datos por país</b></p>
      <ul className="small muted" style={{ margin: '0 0 0 16px' }}>{cmp.notes.map(n => <li key={n}>{n}</li>)}</ul>
    </details>
  </section>
}

type QuotaUsage = { usedToday: number; cap: number; searchesToday: number; searchCap: number; persistent: boolean; exhausted: boolean }

/**
 * Today's consumption against BOTH YouTube limits, worded as what this app has counted and not as what YouTube still has: other applications
 * sharing the same Google Cloud project spend from the same pools and cannot be seen from here.
 */
export function QuotaNote({ usage }: { usage: QuotaUsage }) {
  const f = (n: number) => n.toLocaleString('es-ES')
  return <div className="muted small" aria-label="Consumo de hoy">
    <p style={{ margin: 0 }}>Esta aplicación ha usado hoy <b>{f(usage.usedToday)}</b> de las <b>{f(usage.cap)}</b> unidades que se permite y <b>{f(usage.searchesToday)}</b> de sus <b>{f(usage.searchCap)}</b> búsquedas (YouTube limita por separado las unidades y el número de búsquedas).</p>
    {usage.exhausted && <p className="error" role="alert" style={{ margin: '4px 0 0' }}>YouTube ha informado de que la cuota de hoy está agotada: no se lanzan más búsquedas hasta mañana.</p>}
    <p style={{ margin: '4px 0 0' }}>Es una cuenta de esta aplicación, no la cifra oficial: si otras aplicaciones usan la misma clave de YouTube, su consumo no se ve aquí y puede quedar menos de lo que parece. Comprueba la consola de Google Cloud.{usage.persistent ? '' : ' Además el contador está solo en memoria (falta la migración research_cache): se apoya en el de este navegador.'}</p>
  </div>
}

/** Analyses made by an older version of the engine: still readable, never mixed with the current ones. */
export function LegacyPanel({ legacy, onRedo }: { legacy: TopicAnalysis[]; onRedo: (a: TopicAnalysis) => void }) {
  if (!legacy.length) return null
  return <details className="panel" style={{ marginTop: 14 }} aria-label="Análisis de versiones anteriores">
    <summary><b>Análisis de una versión anterior del motor ({legacy.length})</b></summary>
    <p className="muted small" style={{ margin: '6px 0' }}>Se hicieron con reglas más antiguas (por ejemplo, sin la comprobación de significado o de idioma) y pueden incluir vídeos que hoy se descartarían. Siguen aquí para que no pierdas lo que pagaste, pero <b>no entran</b> en recomendaciones, huecos ni comparaciones. Volver a analizarlos cuesta cuota (≈ 204 unidades cada uno) y los sustituye.</p>
    <ul className="small" style={{ margin: '0 0 0 16px' }}>{legacy.map(a => <li key={`${a.topic}|${a.region}|${a.language}|${a.recentDays}`}>{a.topic} · {marketLabel(a.region, a.language)} · {new Date(a.fetchedAt).toLocaleDateString('es-ES')} · oportunidad {a.indices.opportunity}/100 (cálculo antiguo) <button type="button" className="ghost" onClick={() => onRedo(a)}>Volver a analizar</button></li>)}</ul>
  </details>
}
