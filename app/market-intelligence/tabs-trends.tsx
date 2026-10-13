'use client'

import { useEffect, useMemo, useState } from 'react'
import { YouTubeResults } from '../components/youtube-results'
import { RpmLine, RunBar } from './analysis-views'
import { Results, useFiltered } from './tabs-analysis'
import { useResearch } from './research-context'
import { COUNTRIES, CONTINENTS, neglectedNiches, NEGLECTED } from '@/lib/research/discovery'
import { crossRegionTerms } from '@/lib/research/discovery'
import { blockers, filterVideos, forTab, mergeRegions, UNITS, type SeenVideo } from '@/lib/research/filters'
import { countryName, marketLabel } from '@/lib/research/markets'
import { COUNTRY_RPM, RPM_LABEL, NICHE_RPM, SCENARIO_VIEWS, SOURCES, UNKNOWN_RPM_NICHES, VERIFIED_RPM_STATUS, formatAdjusted, nicheRpm, passesRpmFilter, revenueScenarios } from '@/lib/research/monetization'
import { NICHES, nicheLabel, nichesOf } from '@/lib/research/taxonomy'
import { formatOpportunity } from '@/lib/research/topic-analysis'
import type { YouTubeSaveContext } from '../components/youtube-results'
import { fmtCompact, fmtNumber, fmtUsd, plural } from '@/lib/research/format'

const ctx = (q: string, region: string | null): YouTubeSaveContext => ({ query: q, region, language: null, origin: 'radar' })
const fmt = fmtCompact
const usd = fmtUsd

/** Official "most popular" charts for the chosen countries (2 units each) merged into one list, with the filters applied. */
export function TrendingCompare({ compact = false, onSaved }: { compact?: boolean; onSaved: () => void }) {
  const { filters, charts, loadCharts, chartsBusy, chartsError } = useResearch()
  const regions = filters.countries
  const missing = regions.filter(r => !charts[r])
  const merged = useMemo(() => mergeRegions(regions.filter(r => charts[r]).map(r => ({ region: r, videos: charts[r] }))), [regions, charts])
  const shown = useMemo(() => filterVideos(merged, filters), [merged, filters])
  const whyEmpty = useMemo(() => (merged.length > 0 && shown.length === 0 ? blockers(merged, filters) : []), [merged, shown, filters])
  const terms = useMemo(() => crossRegionTerms(regions.filter(r => charts[r]).map(r => ({ region: r, videos: charts[r] }))), [regions, charts])
  const perCountry = regions.filter(r => charts[r]).map(r => {
    const vs = charts[r], n = Math.max(vs.length, 1)
    const byNiche = new Map<string, number>(); for (const v of vs) for (const m of nichesOf(v)) byNiche.set(m.niche, (byNiche.get(m.niche) ?? 0) + (v.observed.views ?? 0))
    const langs = new Map<string, number>(); for (const v of vs) if (v.declaredLanguage) langs.set(v.declaredLanguage, (langs.get(v.declaredLanguage) ?? 0) + 1)
    return { r, count: vs.length, niches: [...byNiche.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), langs: [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), langCover: Math.round((vs.filter(v => v.declaredLanguage).length / n) * 100), subsCover: Math.round((vs.filter(v => v.observed.channelSubscribers !== null).length / n) * 100) }
  })
  return <section className="panel" aria-label="Tendencias internacionales">
    {!compact && <h3>Tendencias internacionales</h3>}
    <p className="muted small" style={{ margin: '6px 0 10px' }}>Listas oficiales de populares de cada país ({UNITS.trending} unidades por país). Se comparan los países de los filtros aplicados; no se consulta nada hasta que pulses «Aplicar y cargar tendencias». «País» es donde YouTube muestra el vídeo: <b>no</b> sabemos dónde viven sus espectadores.</p>
    {regions.length < 1 ? <p className="emptyState">Elige uno o más países en los filtros (por ejemplo Estados Unidos, Alemania y Australia) y pulsa «Aplicar y cargar tendencias».</p> : <>
      {missing.length > 0 && !chartsBusy && <p className="notice" role="status">Faltan las tendencias de {missing.map(countryName).join(', ')}: pulsa <b>«Aplicar y cargar tendencias»</b> en los filtros ({missing.length * UNITS.trending} unidades).</p>}
      {chartsBusy && <p className="muted small" role="status">Cargando tendencias…</p>}
      {chartsError && <p className="error" role="alert">{chartsError}</p>}
      {terms.length > 0 && <><p className="authNote">Calculado: términos que aparecen en las listas de varios países a la vez.</p><div className="legend" style={{ margin: '8px 0' }}>{terms.map(t => <span key={t.term} className="pill" title={t.regions.map(countryName).join(', ')}>{t.term} · {t.regions.length} países</span>)}</div></>}
      {perCountry.length > 0 && <div className="tableScroll"><table className="dataTable"><thead><tr><th>País</th><th>Vídeos</th><th>Nichos más vistos (inferidos)</th><th>Idiomas declarados</th><th>Cobertura de datos</th></tr></thead>
        <tbody>{perCountry.map(c => <tr key={c.r}><td>{countryName(c.r)}</td><td>{c.count}</td><td>{c.niches.map(([n, v]) => `${nicheLabel(n)} (${fmt(v)})`).join(', ') || '—'}</td><td>{c.langs.map(([l, n]) => `${l} ×${n}`).join(', ') || 'sin declarar'}</td><td>idioma declarado {c.langCover} % · suscriptores visibles {c.subsCover} %</td></tr>)}</tbody></table></div>}
      {perCountry.length > 1 && perCountry.some(c => Math.abs(c.langCover - perCountry[0].langCover) > 25 || Math.abs(c.subsCover - perCountry[0].subsCover) > 25) && <p className="warnBox" role="status">La cobertura de datos difiere mucho entre países: compara con cautela.</p>}
      {merged.length > 0 && shown.length === 0 && <p className="warnBox" role="status">Ningún vídeo cumple los filtros.{whyEmpty.length ? ` Quitando ${whyEmpty.slice(0, 3).map(w => `${w.group} aparecerían ${w.wouldShow}`).join('; quitando ')}.` : ' Prueba con menos filtros.'}</p>}
      <p className="muted small" style={{ marginTop: 8 }}>{shown.length} de {merged.length} vídeos cumplen los filtros{filters.logic.countries === 'all' && regions.length > 1 ? ' (Todos: el mismo vídeo en todos los países elegidos)' : ''}.</p>
      {continentsNote(regions)}
      <YouTubeResults results={compact ? shown.slice(0, 6) : shown.slice(0, 24)} context={ctx(`internacional:${regions.join('+')}`, null)} onSaved={onSaved} extra={v => <p className="muted small">Visto en: {(v as SeenVideo).regions.map(countryName).join(', ')}</p>} />
    </>}
  </section>
}
const continentsNote = (regions: string[]) => { const cs = [...new Set(regions.map(r => COUNTRIES.find(c => c.code === r)?.continent))].filter(Boolean); return cs.length > 1 ? <p className="muted small">Continentes en la comparación: {cs.map(c => CONTINENTS.find(x => x[0] === c)?.[1]).join(', ')}.</p> : null }

/** Same topic in several markets, from the paid sample analysis. */
export function InternationalTab({ onSaved }: { onSaved: () => void }) {
  const { markets, list } = useResearch()
  const [topic, setTopic] = useState('')
  const t = topic.trim().replace(/\s+/g, ' ')
  const fa = useFiltered(list, 'international')
  const same = fa.rows.filter(a => t && a.topic.toLowerCase() === t.toLowerCase())
  const best = [...same].sort((a, b) => b.indices.opportunity - a.indices.opportunity)[0]
  return <>
    <TrendingCompare onSaved={onSaved} />
    <section className="panel" style={{ marginTop: 14 }} aria-label="Mismo nicho en varios mercados">
      <h3>Un mismo nicho en varios mercados</h3>
      <p className="muted small" style={{ margin: '6px 0 10px' }}>Analiza el mismo tema en cada mercado de los filtros y descubre dónde hay más hueco. Cada mercado cuesta una consulta de {UNITS.topic} unidades; las ya hechas salen de la caché.</p>
      <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="inteligencia artificial para negocios" maxLength={120} aria-label="Tema a comparar" style={{ width: '100%' }} />
      <p className="muted small" style={{ marginTop: 6 }}>Mercados: {markets.map(m => m.label).join(' · ')}</p>
      <RunBar topics={t.length >= 2 ? [t] : []} label="Comparar mercados" />
      {best && same.length > 1 && <p className="notice" role="status">Mayor oportunidad calculada para «{best.topic}»: <b>{marketLabel(best.region, best.language)}</b> ({best.indices.opportunity}/100, confianza {best.confidence}). {best.headline}.</p>}
      {fa.notice}
      <Results list={same} onSaved={onSaved} empty={t ? 'Aún no hay análisis de este tema en los mercados elegidos: pulsa el botón de arriba.' : 'Escribe un tema y analiza los mercados elegidos.'} />
    </section>
  </>
}

/** Reference RPM tables, the revenue scenario calculator and a clear statement of what is and is not verified. */
export function MonetizationTab() {
  const { filters } = useResearch()
  const f = useMemo(() => forTab('money', filters), [filters])
  const [niche, setNiche] = useState(f.niches[0] ?? 'educacion'), [country, setCountry] = useState(f.countries[0] ?? ''), [format, setFormat] = useState<'long' | 'short'>(f.formats.length === 1 && f.formats[0] === 'short' ? 'short' : 'long')
  const [custom, setCustom] = useState('')
  const base = formatAdjusted(nicheRpm(niche), format)
  const customN = Number(custom)
  const rpm = custom.trim() !== '' && Number.isFinite(customN) && customN >= 0 ? { low: customN, mid: customN, high: customN, source: 'tu RPM' } : base.status === 'estimado' ? { low: base.low, mid: base.mid, high: base.high, source: 'referencia ESTIMADA' } : null
  const rows = NICHES.filter(n => (f.niches.length === 0 || f.niches.includes(n.id)) && passesRpmFilter(n.id, f.rpm, format))
  const c = COUNTRY_RPM.find(x => x.code === country)
  return <section className="panel" aria-label="Monetización">
    <h3>Monetización</h3>
    <div className="warnBox" style={{ margin: '8px 0' }}>
      <p><span className="tag verificado">{RPM_LABEL.verificado}</span> RPM leído de tus datos autorizados de YouTube Analytics. <b>No disponible aún:</b> {VERIFIED_RPM_STATUS.reason}</p>
      <p><span className="tag estimado">{RPM_LABEL.estimado}</span> Rangos de estudios identificados, con fecha y confianza. Son referencias, <b>no los ingresos reales de ningún canal ajeno</b>.</p>
      <p><span className="tag desconocido">{RPM_LABEL.desconocido}</span> Sin evidencia suficiente: no se inventa; compara escenarios con tu propio RPM.</p>
    </div>
    <h3 className="sectionTitle">Calculadora de escenarios</h3>
    <div className="marketForm">
      <select value={niche} onChange={e => setNiche(e.target.value)} aria-label="Nicho para el escenario">{NICHES.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
      <select value={format} onChange={e => setFormat(e.target.value as 'long' | 'short')} aria-label="Formato del escenario"><option value="long">Vídeo largo</option><option value="short">Shorts</option></select>
      <select value={country} onChange={e => setCountry(e.target.value)} aria-label="País de la audiencia"><option value="">País de la audiencia: sin especificar</option>{COUNTRIES.map(x => <option key={x.code} value={x.code}>{x.name}</option>)}</select>
      <input type="number" min={0} step="0.1" value={custom} onChange={e => setCustom(e.target.value)} placeholder="Tu RPM (opcional)" aria-label="Tu RPM" />
    </div>
    <RpmLine niche={niche} format={format} />
    {c && <p className="small"><span className="tag estimado">{RPM_LABEL.estimado}</span> {countryName(c.code)}: contenido general ${c.low}–${c.high} por 1000 visitas (punto medio ${c.mid}; {Math.round(c.index * 100)} % del de EE. UU.). Fuente: <a href={SOURCES.blogsCountry.url} target="_blank" rel="noopener noreferrer">{SOURCES.blogsCountry.name}</a>, consultada {SOURCES.blogsCountry.accessed}. Los rangos de las fuentes se contradicen: úsalo solo como orden de magnitud. No se combina con el nicho porque las cifras por nicho son de audiencia mundial mezclada.</p>}
    {rpm ? <div className="tableScroll"><table className="dataTable" aria-label="Escenarios de ingresos"><caption className="muted small">Ingresos = visitas ÷ 1000 × RPM ({rpm.source}). No predice cuántas visitas tendrás.</caption>
      <thead><tr><th>Visitas</th><th>RPM bajo (${rpm.low})</th><th>RPM medio (${rpm.mid})</th><th>RPM alto (${rpm.high})</th></tr></thead>
      <tbody>{revenueScenarios(rpm, SCENARIO_VIEWS).map(s => <tr key={s.views}><td>{fmtNumber(s.views)}</td><td>{usd(s.low)}</td><td>{usd(s.mid)}</td><td>{usd(s.high)}</td></tr>)}</tbody></table></div>
      : <p className="notice" role="status">Este nicho es DESCONOCIDO: escribe tu propio RPM para calcular escenarios.</p>}
    <h3 className="sectionTitle">Referencia por nicho {f.rpm.min !== null || f.rpm.max !== null || f.niches.length ? `(${rows.length} de ${NICHES.length} tras filtros)` : ''}</h3>
    {rows.length === 0 && <p className="warnBox" role="status">Ningún nicho cumple el RPM estimado y los nichos elegidos. Prueba a ampliar el rango o a incluir los nichos con RPM desconocido.</p>}
    <div className="tableScroll"><table className="dataTable"><thead><tr><th>Nicho</th><th>Estado</th><th>RPM estimado (USD/1000)</th><th>Confianza</th><th>Fuente y método</th></tr></thead>
      <tbody>{rows.map(n => { const r = formatAdjusted(nicheRpm(n.id), format); return <tr key={n.id}><td>{n.label}</td>
        {r.status === 'desconocido' ? <><td><span className="tag desconocido">DESCONOCIDO</span></td><td colSpan={3}>{r.reason}</td></> : <><td><span className="tag estimado">ESTIMADO</span></td><td>{usd(r.low)}–{usd(r.high)} ({r.midIsMedian ? 'mediana' : 'medio'} {usd(r.mid)})</td><td>{r.confidence}</td><td className="small">{r.sources.map(s => <span key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a> · consultada {s.accessed}<br /></span>)}<span className="muted">{r.note}</span></td></>}</tr> })}</tbody></table></div>
    <p className="muted small" style={{ marginTop: 8 }}>Nichos sin datos propios: {UNKNOWN_RPM_NICHES.map(nicheLabel).join(', ')}. Los nichos marcados «asimilado» heredan la cifra de otro y tienen confianza muy baja. Las fuentes se consultaron el {SOURCES.airNiche.accessed}; revísalas antes de tomar decisiones de dinero. {Object.keys(NICHE_RPM).length} nichos con referencia.</p>
  </section>
}

function Section({ id, title, children, empty }: { id: string; title: string; children?: React.ReactNode; empty?: string }) {
  return <details open className="panel" style={{ marginBottom: 12 }} aria-label={title}><summary><b>{id}. {title}</b></summary><div style={{ marginTop: 10 }}>{children ?? <p className="muted small">{empty}</p>}</div></details>
}

/** Sections A–H: recommendations built from the charts and analyses the user already has, plus clear next steps for what is missing. */
export function DiscoverTab({ onSaved, goTo }: { onSaved: () => void; goTo: (tab: string) => void }) {
  const { filters, charts, loadCharts, chartsBusy, chartsError, list, markets } = useResearch()
  // The home country is fixed when the tab opens: choosing countries in the filters must never trigger a query by itself.
  const [home] = useState(() => { try { const h = window.localStorage.getItem('cerebro.homeRegion'); return h && COUNTRIES.some(c => c.code === h) ? h : 'ES' } catch { return 'ES' } })
  useEffect(() => { if (!charts[home] && !chartsBusy) void loadCharts([home]) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const wanted = filters.countries.length ? filters.countries : [home]
  const loaded = wanted.filter(r => charts[r])
  const waiting = wanted.filter(r => !charts[r])
  const merged = useMemo(() => mergeRegions(loaded.map(r => ({ region: r, videos: charts[r] }))), [loaded, charts])
  const videos = useMemo(() => filterVideos(merged, filters), [merged, filters])
  const why = useMemo(() => (merged.length > 0 && videos.length === 0 ? blockers(merged, filters) : []), [merged, videos, filters])
  const fa = useFiltered(list, 'discover')
  const analyses = fa.rows

  const byNiche = useMemo(() => { const m = new Map<string, { n: number; views: number }>(); for (const v of videos) for (const x of nichesOf(v)) { const e = m.get(x.niche) ?? { n: 0, views: 0 }; e.n++; e.views += v.observed.views ?? 0; m.set(x.niche, e) } return [...m.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 8) }, [videos])
  const pool = useMemo(() => { const seen = new Map<string, SeenVideo>(); for (const v of [...videos, ...analyses.flatMap(a => a.topVideos).map(v => ({ ...v, regions: [] as string[] }))]) seen.set(v.videoId, seen.get(v.videoId) ?? v); return [...seen.values()] }, [videos, analyses])
  const small = useMemo(() => neglectedNiches(pool).slice(0, 6), [pool])
  const sorted = (f: (a: (typeof analyses)[number]) => number) => [...analyses].sort((a, b) => f(b) - f(a))
  const gaps = sorted(a => a.indices.opportunity).filter(a => a.verdict === 'oportunidad')
  const emerging = sorted(a => a.indices.growth).filter(a => a.indices.growth >= 60 || a.emerging.length > 0).slice(0, 4)
  const money = sorted(a => a.indices.demand).flatMap(a => a.niches.map(n => ({ a, n, r: formatAdjusted(nicheRpm(n), 'long') }))).filter(x => x.r.status === 'estimado' && passesRpmFilter(x.n, filters.rpm)).slice(0, 5)
  const keywords = analyses.filter(a => a.indices.competition <= 55).flatMap(a => a.terms.slice(0, 3).map(t => ({ t, a }))).slice(0, 8)
  const formats = analyses.map(a => ({ a, f: formatOpportunity(a) })).filter(x => x.f.recommended)
  const none = 'Sin análisis todavía.'
  const emptyList = list.length ? 'Ningún análisis cumple los filtros (mira el aviso de arriba).' : none
  return <div>
    <p className="muted small" style={{ marginBottom: 10 }}>Lista oficial de populares de <b>{wanted.map(countryName).join(', ')}</b>{filters.countries.length ? '' : ' (tu país por defecto: elige países en los filtros para cambiarlo)'}. Al entrar solo se carga esa lista ({UNITS.trending} unidades por país); lo demás parte de análisis que tú lances: nada caro se ejecuta solo.</p>
    {waiting.length > 0 && filters.countries.length > 0 && !chartsBusy && <p className="notice" role="status">Faltan las tendencias de {waiting.map(countryName).join(', ')}: pulsa <b>«Aplicar y cargar tendencias»</b> en los filtros ({waiting.length * UNITS.trending} unidades).</p>}
    {chartsBusy && <p className="muted small" role="status">Cargando tendencias…</p>}
    {chartsError && <p className="error" role="alert">{chartsError}</p>}
    {list.length === 0 && <div className="notice" role="status"><p><b>B, C, E, G y H necesitan analizar nichos.</b> Aún no hay análisis: <button type="button" className="ghost" onClick={() => goTo('niches')}>Ir a Nichos</button> (cuesta cuota y siempre pide confirmación).</p></div>}
    {fa.notice}
    <Section id="A" title="Nichos con más visualizaciones" empty={chartsBusy ? 'Cargando tendencias…' : 'Aún no hay listas cargadas.'}>
      {byNiche.length > 0 && <div className="tableScroll"><table className="dataTable"><thead><tr><th>Nicho (inferido)</th><th>Vídeos en la lista</th><th>Visualizaciones sumadas</th></tr></thead><tbody>{byNiche.map(([n, x]) => <tr key={n}><td>{nicheLabel(n)}</td><td>{x.n}</td><td>{fmt(x.views)}</td></tr>)}</tbody></table></div>}
      {merged.length > 0 && videos.length === 0 && <p className="warnBox" role="status">Ningún vídeo de las {plural(merged.length, 'lista', 'listas')} cumple los filtros.{why.length ? ` Quitando ${why.slice(0, 3).map(w => `${w.group} aparecerían ${w.wouldShow}`).join('; quitando ')}.` : ' Prueba con menos filtros.'}</p>}
      {merged.length > 0 && <p className="muted small">Calculado sobre la lista oficial de populares: {plural(videos.length, 'vídeo', 'vídeos')} de {merged.length} tras filtros. Un vídeo puede contar en varios nichos.</p>}
    </Section>
    <Section id="B" title="Nichos descuidados">{gaps.length ? gaps.slice(0, 5).map(a => <p key={a.topic + a.region} className="small"><b>{a.topic}</b> · {marketLabel(a.region, a.language)} — oportunidad {a.indices.opportunity}/100, demanda {a.indices.demand}, competencia {a.indices.competition}, oferta {a.indices.supply}. {a.reasons[0]}</p>) : analyses.length ? <p className="muted small">Ninguno de los {analyses.length} análisis tiene demanda alta con poca oferta y competencia. Eso también es información.</p> : <p className="muted small">{emptyList}</p>}</Section>
    <Section id="C" title="Nichos emergentes">{emerging.length ? emerging.map(a => <p key={a.topic + a.region} className="small"><b>{a.topic}</b> · {marketLabel(a.region, a.language)} — crecimiento {a.indices.growth}/100 ({a.growthPct ?? '—'} %){a.emerging.length ? `; frases al alza: ${a.emerging.slice(0, 3).map(t => t.term).join(', ')}` : ''}</p>) : analyses.length ? <p className="muted small">Ningún análisis muestra un crecimiento claro.</p> : <p className="muted small">{emptyList}</p>}</Section>
    <Section id="D" title="Tendencias internacionales"><TrendingCompare compact onSaved={onSaved} /></Section>
    <Section id="E" title="Oportunidades de monetización">{money.length ? <>{money.map(({ a, n }) => <div key={a.topic + a.region + n}><p className="small"><b>{a.topic}</b> · {marketLabel(a.region, a.language)} — demanda {a.indices.demand}/100, competencia {a.indices.competition}/100</p><RpmLine niche={n} /></div>)}<p className="muted small">RPM de referencia por nicho, no de este tema ni de ningún canal.</p></> : analyses.length ? <p className="muted small">Ningún análisis cae en un nicho con RPM de referencia dentro del filtro.</p> : <p className="muted small">{emptyList}</p>}</Section>
    <Section id="F" title="Oportunidades para canales pequeños" empty="Sin vídeos que lo cumplan todavía.">{small.length > 0 && <><p className="muted small">Vídeos de canales de hasta {fmtNumber(NEGLECTED.maxSubscribers)} suscriptores con al menos {fmtNumber(NEGLECTED.minViews)} vistas y {NEGLECTED.minRatio}× más vistas que suscriptores. Por sí solo esto <b>no</b> prueba que el nicho esté descuidado: mira la sección B.</p><YouTubeResults results={small} context={ctx('canales-pequeños', null)} onSaved={onSaved} /></>}</Section>
    <Section id="G" title="Palabras clave prometedoras">{keywords.length ? <div className="legend">{keywords.map(({ t, a }) => <span key={t.term + a.topic + a.region} className="pill" title={`${a.topic} · ${marketLabel(a.region, a.language)} · competencia ${a.indices.competition}/100`}>{t.term} · {t.videos}</span>)}</div> : analyses.length ? <p className="muted small">No hay frases con competencia manejable.</p> : <p className="muted small">{emptyList}</p>}<p className="muted small">Frases de títulos de temas con competencia ≤ 55. Sin volúmenes de búsqueda.</p></Section>
    <Section id="H" title="Oportunidades por formato">{formats.length ? formats.slice(0, 5).map(({ a, f }) => <p key={a.topic + a.region} className="small"><b>{a.topic}</b> · {marketLabel(a.region, a.language)} → {f.recommended === 'short' ? 'Shorts' : 'vídeo largo'}: {f.reason}</p>) : analyses.length ? <p className="muted small">Los formatos están cubiertos en la muestra.</p> : <p className="muted small">{emptyList}</p>}</Section>
    <p className="muted small">Mercados que se usarían para analizar: {markets.map(m => m.label).join(' · ')}.</p>
  </div>
}
