'use client'

import { shortCountry } from '@/lib/research/geo'
import { Thumb } from '../components/thumb'
import { confidenceLabel } from '@/lib/research/labels'
import { useMemo } from 'react'
import { OPP_TITLES, detectOpportunities, type Opportunity } from '@/lib/research/opportunities'
import { compareMarkets } from '@/lib/research/markets-info'
import { marketLabel } from '@/lib/research/markets'
import { methodLines } from '@/lib/research/statistics'
import { growthStatus, type TopicAnalysis } from '@/lib/research/topic-analysis'
import type { ChannelAnalysis } from '@/lib/providers/youtube-data'
import { channelRevenue, nicheRevenue, videoRevenue, type RevenueEstimate } from '@/lib/research/revenue'
import { SOURCES_REGISTRY, STATUS_LABEL } from '@/lib/research/sources/registry'
import { fmtNumber } from '@/lib/research/format'
import { languageLabel } from '@/lib/research/labels'
import { UNITS } from '@/lib/research/filters'

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
    {a.geo && a.geo.requested && <>
      <p className="small" style={{ margin: '8px 0 2px' }}><b>De qué país es lo que ves</b> (cuatro cosas distintas)</p>
      <ul className="small" style={{ margin: '0 0 0 16px' }}>
        <li><b>País pedido:</b> {shortCountry(a.geo.requested)}. Solo orienta la búsqueda de YouTube hacia ese país.</li>
        <li><b>País declarado del canal:</b> {a.geo.channel.known ? `${a.geo.channel.known} de ${a.sampleSizes.top + a.sampleSizes.recent} canales lo declaran; ${a.geo.channel.inMarket} son de ${shortCountry(a.geo.requested)}${a.geo.channel.others.length ? `, el resto de ${a.geo.channel.others.slice(0, 3).map(o => `${shortCountry(o.country)} (${o.n})`).join(', ')}` : ''}` : 'ningún canal de la muestra lo declara'}. No sustituye a la audiencia.</li>
        <li><b>País del contenido:</b> {a.geo.content.withCues ? `${a.geo.content.withCues} vídeos hablan de un país concreto (leyes, impuestos, productos); ${a.geo.content.inMarket} del pedido${a.geo.content.others.length ? `, el resto de ${a.geo.content.others.slice(0, 3).map(o => `${shortCountry(o.country)} (${o.n})`).join(', ')}` : ''}${a.geo.setAside ? `. Se apartaron ${a.geo.setAside} por hablar de otro país` : ''}` : 'ningún vídeo da pistas de país en su texto'}.</li>
        <li><b>País de los espectadores:</b> no se puede saber con la API pública.</li>
      </ul>
      <ul className="small muted" style={{ margin: '4px 0 0 16px' }}>{a.geo.limits.map(l => <li key={l}>{l}</li>)}</ul>
    </>}
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
    <ul className="small" style={{ margin: '6px 0 0 16px' }}>{o.evidence.map((e, i) => <li key={`${e.label}${i}`}>{e.videoId && e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}><Thumb videoId={e.videoId} src={e.thumbnailUrl} width={64} height={36} style={{ verticalAlign: 'middle', borderRadius: 4 }} /></a> : null}<b>{e.label}:</b> {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.value}</a> : e.value}</li>)}</ul>
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
      <tbody>{cmp.columns.map(c => <tr key={c.key}><td>{c.label}</td><td>{c.demand}</td><td>{c.competition}</td><td>{c.supply}</td><td>{c.opportunity}</td><td>{c.growth}</td><td>{c.relevantVideos}</td><td>{confidenceLabel(c.confidence)}</td></tr>)}</tbody></table></div>
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
    <p style={{ margin: '4px 0 0' }}>Es una cuenta de esta aplicación, no la cifra oficial: si otras aplicaciones usan la misma clave de YouTube, su consumo no se ve aquí y puede quedar menos de lo que parece. Comprueba la consola de Google Cloud.{usage.persistent ? '' : ' El servidor aún no guarda el conteo de forma permanente, así que se apoya también en el de este navegador y puede reiniciarse si el servidor se reinicia.'}</p>
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

/** Marks a control as free (it only reorganises what is already on screen) or as one that asks YouTube for something new and spends quota. */
export function CostBadge({ kind, children }: { kind: 'free' | 'cost'; children?: React.ReactNode }) {
  return <span className={`pill ${kind === 'free' ? 'ok' : 'warn'}`} title={kind === 'free' ? 'No consulta YouTube: no gasta cuota' : 'Puede hacer una búsqueda nueva en YouTube y gastar cuota'}>{kind === 'free' ? 'Gratis' : 'Gasta cuota'}{children ? ` · ${Array.isArray(children) ? children.join('') : children}` : ''}</span>
}

export function CostLegend() {
  return <p className="small" style={{ margin: '4px 0 8px' }} aria-label="Qué es gratis y qué gasta cuota">
    <CostBadge kind="free">filtra y reordena lo que ya tienes</CostBadge>{' '}
    <CostBadge kind="cost">hace una búsqueda nueva en YouTube</CostBadge>
  </p>
}

/** The quota in plain words: a technical allowance of work, not money. */
export function QuotaExplainer() {
  return <details className="small" style={{ margin: '4px 0 8px' }}>
    <summary>¿Qué son las «unidades» de YouTube y cuánto cuestan?</summary>
    <ul style={{ margin: '6px 0 0 16px' }}>
      <li><b>No son dinero.</b> YouTube da a cada proyecto un cupo diario de «unidades» (10.000 al día por defecto): una medida técnica de cuánto trabajo le pides. Con ese cupo normal no se paga nada.</li>
      <li><b>Cuánto gasta cada cosa:</b> una búsqueda, unas 100 unidades; analizar un tema en un mercado son 2 búsquedas (≈ 204); medir el crecimiento, 1 búsqueda (≈ 102); cargar las tendencias de un país, 2.</li>
      <li><b>Hay un segundo límite aparte:</b> YouTube también limita las búsquedas a unas <b>100 al día</b>, además de las <b>10.000 unidades</b>. Se acaba el que llegue antes: con 100 búsquedas no caben más de 50 análisis de un tema, aunque sobren unidades.</li>
      <li><b>Cuando se acaba</b>, YouTube no responde hasta el día siguiente (medianoche, hora del Pacífico). Ampliar el cupo hay que pedírselo a Google; no ocurre solo ni se cobra solo.</li>
      <li><b>Esta aplicación no cobra por unidad.</b> Investigación no usa modelos de IA de pago: lo que gasta es solo cupo de YouTube.</li>
      <li><b>Es gratis:</b> volver a ver análisis ya hechos, cambiar filtros, ordenar, exportar y guardar.</li>
    </ul>
  </details>
}

/** Growth: says whether it was already measured and never offers a second, identical measurement (it would cost quota and change nothing). */
export function GrowthControl({ a, busy, onMeasure }: { a: TopicAnalysis; busy: boolean; onMeasure: () => void }) {
  const st = growthStatus(a), when = st.measuredAt ? new Date(st.measuredAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : ''
  if (st.kind === 'vigente') return <p className="small" style={{ marginTop: 8 }} aria-label="Crecimiento medido"><CostBadge kind="free">{`ya medido el ${when}`}</CostBadge> <span className="muted">Resultado: {a.growth.label ?? 'calculado'}. No hace falta repetirlo: una segunda medición daría lo mismo y gastaría cuota.</span></p>
  if (st.kind === 'medido_no_calculable') return <p className="small" style={{ marginTop: 8 }} aria-label="Crecimiento medido sin resultado"><CostBadge kind="free">{`medido el ${when}, sin resultado`}</CostBadge> <span className="muted">{a.growth.reason} Repetirlo ahora no cambiaría nada; inténtalo más adelante, cuando haya más vídeos, con un análisis nuevo.</span></p>
  return <p className="small" style={{ marginTop: 8 }}>
    <button type="button" className="ghost" disabled={busy} onClick={onMeasure}>{busy ? 'Midiendo…' : `Medir crecimiento (≈ ${UNITS.search} unidades, 1 búsqueda)`}</button>{' '}
    <span className="muted">{st.kind === 'caducado' ? `La medición del ${when} ya caducó. ` : ''}Compara las visualizaciones totales de los vídeos de los últimos {a.recentDays} días con las de los {a.recentDays} anteriores. Solo puede confirmar un indicio de subida; si no hay pruebas suficientes saldrá «No calculable» (no se compara vistas por día entre vídeos de edades distintas, porque inventa subidas).</span>
  </p>
}

const usd = (n: number) => `$${n.toLocaleString('es-ES', { maximumFractionDigits: n < 100 ? 2 : 0 })}`
const rng = (r: { low: number; mid: number; high: number }) => `${usd(r.low)} – ${usd(r.high)} (central ${usd(r.mid)})`
const dateEs = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** One income estimate with its formula, assumptions and confidence, always labelled as ESTIMATED advertising income. */
export function EstimateBlock({ title, e }: { title: string; e: RevenueEstimate }) {
  if (e.status === 'desconocido') return <p className="small"><span className="tag desconocido">DESCONOCIDO</span> <b>{title}:</b> {e.reason}</p>
  return <div className="small" style={{ margin: '6px 0' }}>
    <p style={{ margin: 0 }}><span className="tag estimado">ESTIMADO</span> <b>{title}:</b> {rng(e.range)} · confianza {confidenceLabel(e.confidence).toLowerCase()} · <span className="muted">hipótesis, no es una ganancia verificada</span></p>
    <details><summary className="muted">Fórmula y supuestos</summary>
      <p style={{ margin: '4px 0' }}><b>Fórmula:</b> {e.formula}</p>
      <ul style={{ margin: '0 0 0 16px' }}>{e.assumptions.map(x => <li key={x}>{x}</li>)}</ul>
      {e.sources.length > 0 && <p className="muted" style={{ margin: '4px 0 0' }}>Fuentes del RPM: {e.sources.map(s => <span key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> (consultada el {s.accessed}); </span>)}</p>}
    </details>
  </div>
}

/** Potential advertising income of a niche: a typical video, a strong video and monthly scenarios. Never «what a channel earns». */
export function RevenuePanel({ a }: { a: TopicAnalysis }) {
  const r = nicheRevenue(a)
  return <details style={{ marginTop: 8 }} aria-label="Ingresos potenciales">
    <summary className="small"><b>Ingresos potenciales del nicho</b> <span className="tag estimado">ESTIMADO</span> <span className="muted">solo publicidad · no son ingresos reales de nadie</span></summary>
    {r.typical ? <EstimateBlock title={`Un vídeo típico reciente (${fmtNumber(r.typical.views)} visualizaciones)`} e={r.typical.estimate} /> : <p className="small muted">No hay suficientes vídeos recientes para estimar un vídeo típico.</p>}
    {r.strong && <EstimateBlock title={`Un vídeo que funciona (${fmtNumber(r.strong.views)} visualizaciones)`} e={r.strong.estimate} />}
    {r.monthly.length > 0 && <div className="tableScroll"><table className="dataTable" aria-label="Escenarios mensuales"><caption className="muted small">Si cada vídeo consiguiera lo típico del nicho hoy</caption>
      <thead><tr><th>Vídeos al mes</th><th>Visualizaciones</th><th>Ingreso publicitario estimado</th></tr></thead>
      <tbody>{r.monthly.map(m => m.estimate.status === 'estimado' ? <tr key={m.videosPerMonth}><td>{m.videosPerMonth}</td><td>{fmtNumber(m.estimate.views)}</td><td>{rng(m.estimate.range)}</td></tr> : null)}</tbody></table></div>}
    <ul className="small muted" style={{ margin: '6px 0 0 16px' }}>{r.notes.map(n => <li key={n}>{n}</li>)}</ul>
    <p className="small muted">Lo que YouTube no da y aquí no se inventa: el RPM real de ningún canal, los países de los espectadores, patrocinios, afiliados ni membresías.</p>
  </details>
}

/** The videos and channels the conclusions rest on, with links, dates, views and a per-video estimate. */
export function EvidencePanel({ a }: { a: TopicAnalysis }) {
  const vids = a.topVideos
  const country = a.region ? shortCountry(a.region) : 'sin país'
  const lang = languageLabel(a.language)
  if (!vids.length) return <p className="small muted">Este análisis no guardó los vídeos de ejemplo (el navegador no tenía espacio). Vuelve a analizar el tema para verlos.</p>
  return <details style={{ marginTop: 8 }} open aria-label="Vídeos y canales que respaldan">
    <summary className="small"><b>Vídeos y canales que respaldan esta conclusión</b> <span className="muted">· país pedido: {country} · idioma: {lang}</span></summary>
    <div className="tableScroll"><table className="dataTable" aria-label={`Vídeos de ${a.topic}`}>
      <thead><tr><th>Vídeo</th><th>Canal</th><th>Visualizaciones</th><th>Publicado</th><th>Vistas/día</th><th>Ingreso publicitario estimado (hipótesis)</th></tr></thead>
      <tbody>{vids.map(v => { const e = videoRevenue(v, a.region); return <tr key={v.videoId}>
        <td><a href={v.url} target="_blank" rel="noreferrer">{v.title}</a></td>
        <td><a href={`https://www.youtube.com/channel/${v.channelId}`} target="_blank" rel="noreferrer">{v.channelTitle}</a><div className="muted">{typeof v.observed.channelSubscribers === 'number' ? `${fmtNumber(v.observed.channelSubscribers)} suscriptores` : 'suscriptores no públicos'}{v.channelCountry ? ` · país declarado por el canal: ${shortCountry(v.channelCountry)} (no es la audiencia)` : ''}</div></td>
        <td>{v.observed.views === null ? '—' : fmtNumber(v.observed.views)}</td><td>{dateEs(v.publishedAt)}</td><td>{v.calculated.viewsPerDay === null ? '—' : fmtNumber(v.calculated.viewsPerDay)}</td>
        <td>{e.status === 'estimado' ? <>{rng(e.range)}<div className="muted">confianza {confidenceLabel(e.confidence).toLowerCase()}</div></> : <span className="tag desconocido">DESCONOCIDO</span>}</td></tr> })}</tbody></table></div>
    <p className="small muted" style={{ marginTop: 6 }}>Crecimiento: {a.growth.state === 'calculable' ? `${a.growth.label} (comparando dos ventanas de ${a.recentDays} días).` : 'no calculable todavía (necesita una segunda ventana de tiempo: botón «Medir crecimiento»).'}</p>
  </details>
}

/** What is data, what is an estimate and what nobody can know from public YouTube data. */
export function DataKinds({ a }: { a: TopicAnalysis }) {
  return <details style={{ marginTop: 8 }} aria-label="Qué es dato y qué es estimación">
    <summary className="small"><b>Qué es dato, qué es estimación y qué se desconoce</b></summary>
    <div className="small" style={{ display: 'grid', gap: 6, marginTop: 6 }}>
      <p style={{ margin: 0 }}><span className="tag observado">DATO DE YOUTUBE</span> Título, enlace, canal, fecha, duración, visualizaciones, suscriptores públicos y país que el canal declara (si lo declara). Fecha de la consulta: {dateEs(a.fetchedAt)}.</p>
      <p style={{ margin: 0 }}><span className="tag calculado">CALCULADO</span> Demanda, oferta, competencia, oportunidad, vistas por día y la señal de crecimiento: operaciones sobre esos datos, con la muestra de {a.quality.examined} resultados.</p>
      <p style={{ margin: 0 }}><span className="tag estimado">ESTIMADO</span> Ingresos publicitarios (visualizaciones × RPM de estudios del sector), nicho y formato deducidos del texto, y la orientación geográfica.</p>
      <p style={{ margin: 0 }}><span className="tag desconocido">DESCONOCIDO</span> País real de los espectadores, RPM e ingresos reales de cualquier canal, patrocinios y otros ingresos, retención y búsquedas por mes. YouTube no los da para canales ajenos y aquí no se inventan.</p>
    </div>
  </details>
}

/** The sources registry: what is connected, what is pending and exactly what each pending one needs. */
export function SourcesPanel() {
  return <section className="panel" aria-label="Fuentes de datos" style={{ marginTop: 14 }}>
    <h3>De dónde salen los datos</h3>
    <p className="muted small" style={{ margin: '4px 0 8px' }}>Solo están conectadas las fuentes oficiales o de referencia que no cuestan dinero. Las demás se listan con lo que haría falta para conectarlas; no se contratan ni se rastrean webs sin permiso.</p>
    <ul className="small" style={{ margin: '0 0 0 16px' }}>{SOURCES_REGISTRY.map(s => <li key={s.id} style={{ marginBottom: 8 }}>
      <b>{s.name}</b> — <span className={`pill ${s.status === 'conectada' || s.status === 'referencia_incluida' ? 'ok' : 'warn'}`}>{STATUS_LABEL[s.status]}</span> <span className="muted">· {s.cost}</span>
      <div><b>Aporta:</b> {s.gives.join('; ')}.</div><div><b>No puede dar:</b> {s.cannot.join('; ')}.</div>
      {s.needs.length > 0 && <div><b>Para conectarla necesito de ti:</b> {s.needs.join('; ')}.</div>}
      {s.note && <div className="muted">{s.note}</div>}
      <a href={s.docs} target="_blank" rel="noreferrer">Documentación</a>
    </li>)}</ul>
  </section>
}

/** Estimated advertising income of a channel: lifetime (from its public total views) and the last 30 days of uploads. */
export function ChannelRevenuePanel({ c }: { c: ChannelAnalysis }) {
  const r = channelRevenue(c)
  return <section className="panel" aria-label="Ingresos estimados del canal" style={{ marginTop: 12 }}>
    <h4 style={{ margin: 0 }}>Ingresos publicitarios estimados <span className="tag estimado">ESTIMADO</span></h4>
    <p className="muted small" style={{ margin: '2px 0 6px' }}>No son los ingresos reales del canal: YouTube no los publica. Solo publicidad, a partir de visualizaciones públicas y un RPM de sector.</p>
    <EstimateBlock title={`Toda la vida del canal (${fmtNumber(c.observed.totalViews ?? 0)} visualizaciones)`} e={r.lifetime} />
    {r.last30 ? <EstimateBlock title={`Vídeos de los últimos 30 días (${r.last30.videos} vídeos, ${fmtNumber(r.last30.views)} visualizaciones hasta hoy)`} e={r.last30.estimate} /> : <p className="small muted">No hay vídeos de los últimos 30 días en la muestra.</p>}
    <ul className="small muted" style={{ margin: '4px 0 0 16px' }}>{r.notes.map(n => <li key={n}>{n}</li>)}</ul>
  </section>
}

const OFFICIAL = { units: 10_000, searches: 100 }
/**
 * What an action will cost, in BOTH daily limits, before it runs: units and searches, next to what YouTube allows per day and what has been
 * counted today. Shown for free actions too (0 and 0), so the cost is always visible.
 */
export function CostSummary({ units, searches, usage }: { units: number; searches: number; usage?: { usedToday: number; cap: number; searchesToday: number; searchCap: number } | null }) {
  const f = (n: number) => n.toLocaleString('es-ES')
  return <p className="small" role="note" aria-label="Coste de esta acción" style={{ margin: '4px 0' }}>
    <b>Coste de esta acción: {f(units)} {units === 1 ? 'unidad' : 'unidades'} y {f(searches)} {searches === 1 ? 'búsqueda' : 'búsquedas'}.</b>{' '}
    <span className="muted">Se cuentan contra dos límites diarios distintos de YouTube: {f(OFFICIAL.units)} unidades y {f(OFFICIAL.searches)} búsquedas.{usage ? ` Esta aplicación ha usado hoy ${f(usage.usedToday)} de ${f(usage.cap)} unidades y ${f(usage.searchesToday)} de ${f(usage.searchCap)} búsquedas que se permite.` : ''}</span>
  </p>
}
