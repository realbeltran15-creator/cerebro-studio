'use client'

import { useEffect, useMemo, useState } from 'react'
import { MultiSelect } from '../components/multi-select'
import { useResearch } from './research-context'
import { COUNTRIES, CONTINENTS, LANGUAGES } from '@/lib/research/discovery'
import { CONTENT_TYPE_OPTIONS, FORMAT_OPTIONS, NICHES, nicheLabel } from '@/lib/research/taxonomy'
import { GROUP_SEMANTICS, MAX_COUNTRIES, TAB_FILTERS, forTab, TAB_SCOPE, UNITS, YT_CATEGORIES, activeCount, describeActive, type FilterPart, type MetricFilters, type TabId } from '@/lib/research/filters'
import { countryName } from '@/lib/research/markets'

const countryOptions = COUNTRIES.map(c => [c.code, c.name] as [string, string])
const lookup = (list: Array<[string, string]>) => (v: string) => list.find(([k]) => k === v)?.[1] ?? v
const NAMES = { country: countryName, niche: nicheLabel, language: lookup(LANGUAGES), format: lookup(FORMAT_OPTIONS as Array<[string, string]>), contentType: lookup(CONTENT_TYPE_OPTIONS), category: lookup(YT_CATEGORIES) }

/**
 * One filter panel for every section, with a single rule: what you pick is a DRAFT until you press the button. The button applies it
 * (and, on the sections that list videos, also loads the cheap official charts of the chosen countries, with the cost written on it).
 * Everything on screen was computed with the APPLIED filters shown in the chip bar, and each chip can be removed on its own.
 */
export function FilterPanel({ tab }: { tab: TabId }) {
  const { filters: applied, draft: f, setDraft, apply, reset, dirty, errors, removeChip, presets, savePreset, applyPreset, deletePreset, markets, charts, loadCharts, chartsBusy } = useResearch()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(true)
  const [notice, setNotice] = useState('')
  useEffect(() => { try { const v = window.sessionStorage.getItem('cerebro.research.panel'); if (v === '0') setOpen(false) } catch { /* ignore */ } }, [])
  const toggle = () => { setOpen(o => { try { window.sessionStorage.setItem('cerebro.research.panel', o ? '0' : '1') } catch { /* ignore */ } return !o }) }

  const parts = TAB_FILTERS[tab] as FilterPart[]
  const has = (p: FilterPart) => parts.includes(p)
  const set = (patch: Partial<typeof f>) => setDraft({ ...f, ...patch })
  const met = (patch: Partial<MetricFilters>) => setDraft({ ...f, metrics: { ...f.metrics, ...patch } })
  const logic = (g: keyof typeof f.logic) => (l: 'any' | 'all') => setDraft({ ...f, logic: { ...f.logic, [g]: l } })
  const chips = useMemo(() => describeActive(forTab(tab, applied), NAMES), [applied, tab])
  const keptElsewhere = useMemo(() => describeActive(applied, NAMES).length - chips.length, [applied, chips])
  const pendingCharts = (tab === 'discover' || tab === 'international') ? f.countries.filter(c => !charts[c]) : []
  const cost = pendingCharts.length * UNITS.trending
  const rpm = (k: 'min' | 'max') => (e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.value.trim(); set({ rpm: { ...f.rpm, [k]: v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v) } }) }
  const addContinent = (id: string) => {
    const wanted = COUNTRIES.filter(c => c.continent === id).map(c => c.code)
    const merged = [...new Set([...f.countries, ...wanted])]
    set({ countries: merged.slice(0, MAX_COUNTRIES) })
    if (merged.length > MAX_COUNTRIES) setNotice(`Máximo ${MAX_COUNTRIES} países a la vez: se han añadido los primeros.`); else setNotice('')
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (errors.length || (!dirty && pendingCharts.length === 0)) return
    apply(); setNotice('')
    if (pendingCharts.length) void loadCharts(pendingCharts)
  }
  const activeN = activeCount(applied)
  const label = pendingCharts.length ? `Aplicar y cargar tendencias de ${pendingCharts.length} país${pendingCharts.length === 1 ? '' : 'es'} (${cost} unidades)` : 'Aplicar filtros'

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
      </div><p className="muted small">País = donde YouTube muestra el vídeo, no donde viven los espectadores. Idioma = el que declaró quien subió el vídeo (a veces falta).</p></fieldset>}

      {(has('niches') || has('formats') || has('contentTypes')) && <fieldset className="filterStep"><legend>2 · Qué buscas</legend><div className="filterGrid">
        {has('niches') && <MultiSelect label="Nichos" options={NICHES.map(x => [x.id, x.label])} value={f.niches} onChange={niches => set({ niches })} logic={f.logic.niches} onLogic={logic('niches')} explanation={GROUP_SEMANTICS.niches.explanation} />}
        {has('formats') && <MultiSelect label="Formatos" options={FORMAT_OPTIONS as Array<[string, string]>} value={f.formats} onChange={formats => set({ formats })} logic={f.logic.formats} onLogic={logic('formats')} allEnabled={false} explanation={GROUP_SEMANTICS.formats.explanation} />}
        {has('contentTypes') && <MultiSelect label="Tipos de contenido" options={CONTENT_TYPE_OPTIONS} value={f.contentTypes} onChange={contentTypes => set({ contentTypes })} logic={f.logic.contentTypes} onLogic={logic('contentTypes')} explanation={GROUP_SEMANTICS.contentTypes.explanation} />}
      </div><p className="muted small">Nicho y formato son <b>inferidos</b> (palabras, etiquetas, categoría y duración): YouTube no los confirma.</p></fieldset>}

      {(has('period') || has('rpm')) && <fieldset className="filterStep"><legend>3 · Qué características</legend><div className="filterGrid">
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
      <button type="submit" disabled={errors.length > 0 || chartsBusy || (!dirty && pendingCharts.length === 0)}>{chartsBusy ? 'Cargando tendencias…' : label}</button>
      <button type="button" className="ghost" disabled={activeN === 0 && !dirty} onClick={reset}>Restablecer filtros</button>
      <span className="muted small" aria-live="polite">{dirty ? 'Tienes cambios sin aplicar: los resultados siguen con los filtros anteriores.' : activeN ? `Resultados con ${activeN} filtro${activeN === 1 ? '' : 's'} aplicado${activeN === 1 ? '' : 's'}.` : 'Sin filtros aplicados.'} Mercados: {markets.map(m => m.label).join(' · ')}.</span>
    </div>
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
