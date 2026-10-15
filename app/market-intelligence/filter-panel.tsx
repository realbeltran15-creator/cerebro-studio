'use client'

import { QuotaNote } from './insight-panels'
import { useEffect, useMemo, useState } from 'react'
import { MultiSelect } from '../components/multi-select'
import { useResearch } from './research-context'
import { COUNTRIES, CONTINENTS, LANGUAGES } from '@/lib/research/discovery'
import { CONTENT_TYPE_OPTIONS, FORMAT_OPTIONS, NICHES, nicheLabel } from '@/lib/research/taxonomy'
import { GROUP_SEMANTICS, MAX_COUNTRIES, TAB_FILTERS, VERDICT_OPTIONS, forTab, TAB_SCOPE, YT_CATEGORIES, activeCount, describeActive, type AnalysisFilters, type FilterPart, type MetricFilters, type TabId } from '@/lib/research/filters'
import { countryName } from '@/lib/research/markets'
import { parseTopics, planLabel, searchPlanFor } from '@/lib/research/search-plan'
import { suggestSeeds } from '@/lib/research/seeds'
import { fmtNumber } from '@/lib/research/format'

const countryOptions = COUNTRIES.map(c => [c.code, c.name] as [string, string])
const lookup = (list: Array<[string, string]>) => (v: string) => list.find(([k]) => k === v)?.[1] ?? v
const NAMES = { country: countryName, niche: nicheLabel, language: lookup(LANGUAGES), format: lookup(FORMAT_OPTIONS as Array<[string, string]>), contentType: lookup(CONTENT_TYPE_OPTIONS), category: lookup(YT_CATEGORIES) }

/**
 * One filter panel for every section, with a single rule: what you pick is a DRAFT until you press the button. The button applies it
 * (and, on the sections that list videos, also loads the cheap official charts of the chosen countries, with the cost written on it).
 * Everything on screen was computed with the APPLIED filters shown in the chip bar, and each chip can be removed on its own.
 */
export function FilterPanel({ tab }: { tab: TabId }) {
  const { filters: applied, draft: f, setDraft, apply, reset, dirty, errors, removeChip, presets, savePreset, applyPreset, deletePreset, markets, charts, analyses, usage, queries, setQueries, runPlan, progress, chartsBusy, search, cancel } = useResearch()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(true)
  const [notice, setNotice] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => { try { const v = window.sessionStorage.getItem('cerebro.research.panel'); if (v === '0') setOpen(false) } catch { /* ignore */ } }, [])
  const toggle = () => { setOpen(o => { try { window.sessionStorage.setItem('cerebro.research.panel', o ? '0' : '1') } catch { /* ignore */ } return !o }) }

  const parts = TAB_FILTERS[tab] as FilterPart[]
  const has = (p: FilterPart) => parts.includes(p)
  const set = (patch: Partial<typeof f>) => setDraft({ ...f, ...patch })
  const ana = (patch: Partial<AnalysisFilters>) => setDraft({ ...f, analysis: { ...f.analysis, ...patch } })
  const met = (patch: Partial<MetricFilters>) => setDraft({ ...f, metrics: { ...f.metrics, ...patch } })
  const logic = (g: keyof typeof f.logic) => (l: 'any' | 'all') => setDraft({ ...f, logic: { ...f.logic, [g]: l } })
  const chips = useMemo(() => describeActive(forTab(tab, applied), NAMES), [applied, tab])
  const keptElsewhere = useMemo(() => describeActive(applied, NAMES).length - chips.length, [applied, chips])
  const plan = useMemo(() => searchPlanFor(tab, f, queries, { analyses, charts, remainingToday: usage?.remaining ?? 6000 }), [tab, f, queries, analyses, charts, usage])
  const typed = tab === 'keywords' ? parseTopics(queries.keywords, 3) : tab === 'niches' ? parseTopics(queries.niches) : []
  const busy = Boolean(progress) || chartsBusy || search.busy
  const rpm = (k: 'min' | 'max') => (e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.value.trim(); set({ rpm: { ...f.rpm, [k]: v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v) } }) }
  const addContinent = (id: string) => {
    const wanted = COUNTRIES.filter(c => c.continent === id).map(c => c.code)
    const merged = [...new Set([...f.countries, ...wanted])]
    set({ countries: merged.slice(0, MAX_COUNTRIES) })
    if (merged.length > MAX_COUNTRIES) setNotice(`Máximo ${MAX_COUNTRIES} países a la vez: se han añadido los primeros.`); else setNotice('')
  }

  const needsConfirm = plan.level === 'confirm'
  const canRun = plan.kind !== 'none' && plan.level !== 'blocked' && (!needsConfirm || confirmed)
  const hasWork = plan.kind !== 'none'
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (errors.length || busy) return
    if (hasWork && !canRun) return
    if (!dirty && !hasWork) return
    apply(); setNotice(''); setConfirmed(false)
    if (hasWork) void runPlan(plan)
  }
  const activeN = activeCount(applied)
  const label = busy ? 'Buscando…' : planLabel(plan)
  const ideas = tab === 'niches' && typed.length === 0 ? suggestSeeds(f.niches, markets[0]?.language ?? null, 6) : []

  if (parts.length === 0) return <p className="muted small" style={{ margin: '0 0 12px' }}>{TAB_SCOPE[tab]}</p>
  return <form className="panel filterPanel" aria-label="Filtros de investigación" onSubmit={submit} style={{ margin: '0 0 14px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <h3>Filtros <span className={`pill ${dirty ? 'warn' : activeN ? 'ok' : ''}`} role="status">{dirty ? 'Cambios sin aplicar' : activeN ? `Aplicados · ${activeN} activos` : 'Sin filtros'}</span></h3>
      <button type="button" className="ghost" aria-expanded={open} onClick={toggle}>{open ? 'Ocultar opciones' : 'Mostrar opciones'}</button>
    </div>
    <p className="muted small" style={{ margin: '4px 0 8px' }}>{TAB_SCOPE[tab]}</p>
    <div aria-label="Filtros activos" style={{ marginBottom: 8 }}>
      {chips.length === 0 ? <p className="muted small">Sin filtros activos en este apartado: se muestra todo.</p> : <div className="legend">{chips.map(c => <button key={c.id} type="button" className="pill info" aria-label={`Quitar ${c.group}: ${c.label}`} onClick={() => removeChip(c)}>{c.group}: {c.label} ✕</button>)}</div>}
      {keptElsewhere > 0 && <p className="muted small">Se conservan {keptElsewhere} filtro{keptElsewhere === 1 ? '' : 's'} que este apartado no usa; vuelven a aplicarse en los apartados donde sí cuentan.</p>}
    </div>

    {open && <>
      {(has('countries') || has('languages')) && <fieldset className="filterStep"><legend>1 · Dónde investigar</legend><div className="filterGrid">
        {has('countries') && <div>
          <MultiSelect label="Países" options={countryOptions} value={f.countries} onChange={countries => { set({ countries }); setNotice('') }} max={MAX_COUNTRIES} logic={f.logic.countries} onLogic={logic('countries')} explanation={GROUP_SEMANTICS.countries.explanation} />
          <div className="legend" style={{ marginTop: 6 }} aria-label="Añadir un continente">{CONTINENTS.map(([id, l]) => <button key={id} type="button" className="pill" onClick={() => addContinent(id)} title={`Añadir los países de ${l}`}>+ {l}</button>)}</div>
          {notice && <p className="muted small" role="status">{notice}</p>}
        </div>}
        {has('languages') && <MultiSelect label="Idiomas" options={LANGUAGES} value={f.languages} onChange={languages => set({ languages })} logic={f.logic.languages} onLogic={logic('languages')} allEnabled={false} explanation={GROUP_SEMANTICS.languages.explanation} />}
        {has('languages') && f.languages.length > 0 && <label className="msOpt"><input type="checkbox" checked={f.includeUndeclaredLanguage} onChange={e => set({ includeUndeclaredLanguage: e.target.checked })} /> Incluir vídeos sin idioma declarado (YouTube solo lo informa en una parte de los vídeos)</label>}
      </div><p className="muted small">País = donde YouTube muestra el vídeo, no donde viven los espectadores. Idioma = el que declaró quien subió el vídeo (a veces falta).</p></fieldset>}

      {(tab === 'niches' || tab === 'keywords' || tab === 'competition' || tab === 'international') && <fieldset className="filterStep"><legend>2 · Qué quieres buscar</legend>
        {tab === 'niches' && <div>
          <label className="muted small" htmlFor="topics">Temas o subnichos (opcional: uno por línea o separados por comas, hasta 6)</label>
          <textarea id="topics" rows={2} value={queries.niches} onChange={e => setQueries({ niches: e.target.value })} placeholder="Déjalo vacío y se probarán ideas de los nichos elegidos, en el idioma de cada mercado" style={{ width: '100%' }} />
          {typed.length === 0 && <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}><label className="muted small" htmlFor="per-market" style={{ flexDirection: 'row', alignItems: 'center' }}>Ideas por mercado</label><input id="per-market" type="number" min={1} max={20} value={queries.perMarket} onChange={e => setQueries({ perMarket: Math.min(Math.max(Number(e.target.value) || 1, 1), 20) })} style={{ width: 80 }} /></div>}
          {ideas.length > 0 && <div className="legend" aria-label="Ideas de temas"><span className="muted small">Ideas para {markets[0]?.label}:</span>{ideas.map(x => <button key={x} type="button" className="pill" onClick={() => setQueries({ niches: parseTopics(`${queries.niches}, ${x}`).join(', ') })}>+ {x}</button>)}</div>}
        </div>}
        {tab === 'keywords' && <div><label className="muted small" htmlFor="kw">Palabra clave (hasta 3)</label><input id="kw" value={queries.keywords} onChange={e => setQueries({ keywords: e.target.value })} placeholder="invertir en bolsa" maxLength={200} /></div>}
        {tab === 'competition' && <div className="marketForm"><div style={{ flex: 1 }}><label className="muted small" htmlFor="yq">Búsqueda en YouTube</label><input id="yq" aria-label="Búsqueda en YouTube" value={queries.competition} onChange={e => setQueries({ competition: e.target.value })} placeholder="Tema, historia o formato" maxLength={200} /></div>
          <div><label className="muted small" htmlFor="yo">Orden</label><select id="yo" value={queries.order} onChange={e => setQueries({ order: e.target.value })}><option value="relevance">Relevancia</option><option value="viewCount">Más vistas</option><option value="date">Más recientes</option><option value="rating">Mejor valorados</option></select></div></div>}
        {tab === 'international' && <div><label className="muted small" htmlFor="tc">Tema a comparar en cada mercado (opcional)</label><input id="tc" aria-label="Tema a comparar" value={queries.international} onChange={e => setQueries({ international: e.target.value })} placeholder="inteligencia artificial para negocios" maxLength={120} /></div>}
      </fieldset>}

      {(has('niches') || has('formats') || has('contentTypes')) && <fieldset className="filterStep"><legend>3 · Qué filtros aplicar</legend><div className="filterGrid">
        {has('niches') && <MultiSelect label="Nichos" options={NICHES.map(x => [x.id, x.label])} value={f.niches} onChange={niches => set({ niches })} logic={f.logic.niches} onLogic={logic('niches')} explanation={GROUP_SEMANTICS.niches.explanation} />}
        {has('formats') && <MultiSelect label="Formatos" options={FORMAT_OPTIONS as Array<[string, string]>} value={f.formats} onChange={formats => set({ formats })} logic={f.logic.formats} onLogic={logic('formats')} allEnabled={false} explanation={GROUP_SEMANTICS.formats.explanation} />}
        {has('contentTypes') && <MultiSelect label="Tipos de contenido" options={CONTENT_TYPE_OPTIONS} value={f.contentTypes} onChange={contentTypes => set({ contentTypes })} logic={f.logic.contentTypes} onLogic={logic('contentTypes')} explanation={GROUP_SEMANTICS.contentTypes.explanation} />}
      </div><p className="muted small">Nicho y formato son <b>inferidos</b> (palabras, etiquetas, categoría y duración): YouTube no los confirma.</p></fieldset>}

      {(has('period') || has('rpm')) && <fieldset className="filterStep"><legend>4 · Qué características</legend><div className="filterGrid">
        {has('period') && <div>
          <label className="muted small" htmlFor="rf-period">Periodo</label>
          <select id="rf-period" value={f.periodDays === null ? '' : String(f.periodDays)} onChange={e => set({ periodDays: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Por defecto (30 días)</option><option value="7">Última semana</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option>
          </select>
          <p className="muted small">En vídeos: solo los publicados en ese periodo. En análisis: ventana de «recientes».</p>
        </div>}
        {has('rpm') && <div>
          <label className="muted small" htmlFor="rf-rpm-min">RPM estimado (USD por 1000 visitas)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="rf-rpm-min" type="number" min={0} step="0.5" inputMode="decimal" placeholder="Mín." value={f.rpm.min ?? ''} onChange={rpm('min')} aria-label="RPM estimado mínimo" />
            <input type="number" min={0} step="0.5" inputMode="decimal" placeholder="Máx." value={f.rpm.max ?? ''} onChange={rpm('max')} aria-label="RPM estimado máximo" />
          </div>
          <label className="msOpt"><input type="checkbox" checked={f.rpm.includeUnknown} onChange={e => set({ rpm: { ...f.rpm, includeUnknown: e.target.checked } })} /> Incluir nichos con RPM desconocido</label>
          <p className="muted small">Filtra por el rango ESTIMADO del nicho; no es el RPM real de nadie.</p>
        </div>}
      </div>
      {has('analysis') && <details open={false}>
        <summary><b>Resultado del análisis</b> <span className="muted small">demanda, oferta, competencia, crecimiento, clasificación</span></summary>
        <div className="filterGrid" style={{ marginTop: 10 }}>
          <Range label="Demanda (mín. 0–100)" a={f.analysis.minDemand} onA={v => ana({ minDemand: v })} />
          <Range label="Oferta (máx. 0–100)" a={f.analysis.maxSupply} onA={v => ana({ maxSupply: v })} />
          <Range label="Competencia (máx. 0–100)" a={f.analysis.maxCompetition} onA={v => ana({ maxCompetition: v })} />
          <Range label="Crecimiento (mín. 0–100)" a={f.analysis.minGrowth} onA={v => ana({ minGrowth: v })} />
          <Range label="Oportunidad (mín. 0–100)" a={f.analysis.minOpportunity} onA={v => ana({ minOpportunity: v })} />
          <MultiSelect label="Clasificación" options={VERDICT_OPTIONS} value={f.analysis.verdicts} onChange={verdicts => ana({ verdicts })} />
          <div><label className="muted small" htmlFor="rf-conf">Confianza mínima</label><select id="rf-conf" value={f.analysis.minConfidence ?? ''} onChange={e => ana({ minConfidence: e.target.value === 'media' ? 'media' : e.target.value === 'baja' ? 'baja' : null })}><option value="">Cualquiera</option><option value="media">Media o superior</option></select></div>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Son los índices que calcula Cerebro Studio con la muestra de YouTube (0–100): filtran los <b>análisis ya hechos</b>, no cambian qué se consulta. Un «nicho desatendido» típico: demanda ≥ 50, competencia ≤ 55 y oferta ≤ 60.</p>
      </details>}
      {has('advanced') && <details>
        <summary><b>Filtros avanzados</b> <span className="muted small">rendimiento, canal, duración, texto y dinero estimado</span></summary>
        <div className="filterGrid" style={{ marginTop: 10 }}>
          <Range label="Visualizaciones" a={f.metrics.minViews} b={f.metrics.maxViews} onA={v => met({ minViews: v })} onB={v => met({ maxViews: v })} />
          <Range label="Vistas por día (mín.)" a={f.metrics.minViewsPerDay} onA={v => met({ minViewsPerDay: v })} />
          <Range label="Me gusta (mín.)" a={f.metrics.minLikes} onA={v => met({ minLikes: v })} />
          <Range label="Comentarios (mín.)" a={f.metrics.minComments} onA={v => met({ minComments: v })} />
          <Range label="Interacción % (mín.)" a={f.metrics.minEngagement} onA={v => met({ minEngagement: v })} step="0.1" />
          <Range label="Suscriptores del canal" a={f.metrics.minSubscribers} b={f.metrics.maxSubscribers} onA={v => met({ minSubscribers: v })} onB={v => met({ maxSubscribers: v })} />
          <Range label="Vistas ÷ suscriptores (mín.)" a={f.metrics.minRatio} onA={v => met({ minRatio: v })} step="0.5" />
          <Range label="Duración en minutos" a={f.metrics.minDurationMin} b={f.metrics.maxDurationMin} onA={v => met({ minDurationMin: v })} onB={v => met({ maxDurationMin: v })} step="0.5" />
          <Range label="Ingreso ESTIMADO por vídeo (USD)" a={f.metrics.minEstRevenue} b={f.metrics.maxEstRevenue} onA={v => met({ minEstRevenue: v })} onB={v => met({ maxEstRevenue: v })} />
          <MultiSelect label="Categoría de YouTube" options={YT_CATEGORIES} value={f.metrics.categories} onChange={categories => met({ categories })} />
          <div><label className="muted small" htmlFor="rf-inc">Debe contener (separadas por comas)</label><input id="rf-inc" value={f.metrics.include} onChange={e => met({ include: e.target.value })} maxLength={200} placeholder="tutorial, 2026" /></div>
          <div><label className="muted small" htmlFor="rf-exc">No debe contener</label><input id="rf-exc" value={f.metrics.exclude} onChange={e => met({ exclude: e.target.value })} maxLength={200} placeholder="reacción, directo" /></div>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Ingreso estimado = visitas ÷ 1000 × RPM ESTIMADO del nicho (no lo que ganó el canal). Sin RPM de referencia el vídeo es DESCONOCIDO y solo pasa con «Incluir nichos con RPM desconocido».</p>
        <p className="muted small"><b>No existe para canales ajenos</b> (YouTube no lo da): RPM real, dinero real, retención, CTR, tiempo de visualización y país real de los espectadores. Solo tus propios canales, con autorización.</p>
      </details>}</fieldset>}
    </>}

    {errors.length > 0 && <ul className="error" role="alert" style={{ margin: '8px 0 0 16px' }}>{errors.map(e => <li key={e}>{e}</li>)}</ul>}
    <div className="applyBar">
      <button type="submit" disabled={errors.length > 0 || busy || (hasWork ? !canRun : !dirty)}>{label}</button>
      {hasWork && <button type="button" className="ghost" disabled={errors.length > 0 || busy || !dirty} onClick={() => { apply(); setNotice(''); setConfirmed(false) }}>Solo aplicar filtros (sin buscar)</button>}
      <button type="button" className="ghost" disabled={activeN === 0 && !dirty} onClick={reset}>Restablecer filtros</button>
      {busy && progress && <button type="button" className="ghost" onClick={cancel}>Cancelar</button>}
      <span className="muted small" aria-live="polite">{dirty ? 'Tienes cambios sin aplicar: los resultados siguen con los filtros anteriores.' : activeN ? `Resultados con ${activeN} filtro${activeN === 1 ? '' : 's'} aplicado${activeN === 1 ? '' : 's'}.` : 'Sin filtros aplicados.'}</span>
    </div>
    {hasWork && <div className="searchPlan" aria-label="Qué hará el botón">
      <p className="small"><b>Se buscará:</b> {plan.summary}{plan.auto ? ' — ideas propuestas por Cerebro Studio a partir de tus nichos (cámbialas escribiendo tus temas)' : ''}.</p>
      <p className="small"><b>Coste previsto:</b> {plan.message}</p>
      {usage && <QuotaNote usage={usage} />}
      {needsConfirm && <label className="msOpt"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Entiendo que esto gastará {fmtNumber(plan.units)} unidades de cuota</label>}
    </div>}
    {!hasWork && (tab === 'niches' || tab === 'keywords' || tab === 'competition') && <p className="muted small" style={{ marginTop: 8 }}>{tab === 'keywords' ? 'Escribe una palabra clave para poder buscar.' : tab === 'competition' ? 'Escribe qué quieres buscar para poder lanzar la búsqueda.' : 'Elige mercados y nichos y escribe temas (o déjalo vacío para recibir ideas).'}</p>}
    <p className="muted small">Mercados: {markets.map(m => m.label).join(' · ')}.</p>
    <details style={{ marginTop: 8 }}>
      <summary className="muted small">Favoritos ({presets.length})</summary>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} placeholder="Nombre para guardar esta combinación" maxLength={60} aria-label="Nombre de la combinación" style={{ maxWidth: 300 }} />
        <button type="button" disabled={!name.trim() || activeCount(f) === 0} onClick={() => { savePreset(name); setName('') }}>Guardar combinación</button>
        {presets.length > 0 && <select aria-label="Aplicar combinación guardada" value="" onChange={e => e.target.value && applyPreset(e.target.value)} style={{ maxWidth: 260 }}><option value="">Aplicar un favorito…</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {presets.map(p => <button key={p.id} type="button" className="pill" aria-label={`Borrar ${p.name}`} onClick={() => deletePreset(p.id)}>{p.name} ✕</button>)}
      </div>
    </details>
  </form>
}

function Range({ label, a, b, onA, onB, step = '1' }: { label: string; a: number | null; b?: number | null; onA: (v: number | null) => void; onB?: (v: number | null) => void; step?: string }) {
  const parse = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v))
  return <div>
    <label className="muted small">{label}</label>
    <div style={{ display: 'flex', gap: 6 }}>
      <input type="number" min={0} step={step} inputMode="decimal" value={a ?? ''} onChange={e => onA(parse(e.target.value))} placeholder={onB ? 'Mín.' : 'Valor'} aria-label={`${label}${onB ? ' mínimo' : ''}`} />
      {onB && <input type="number" min={0} step={step} inputMode="decimal" value={b ?? ''} onChange={e => onB(parse(e.target.value))} placeholder="Máx." aria-label={`${label} máximo`} />}
    </div>
  </div>
}
