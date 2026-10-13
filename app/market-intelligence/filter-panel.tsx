'use client'

import { useState } from 'react'
import { MultiSelect } from '../components/multi-select'
import { useResearch } from './research-context'
import { COUNTRIES, CONTINENTS, LANGUAGES } from '@/lib/research/discovery'
import { CONTENT_TYPE_OPTIONS, FORMAT_OPTIONS, NICHES } from '@/lib/research/taxonomy'
import { EMPTY_FILTERS, GROUP_SEMANTICS, YT_CATEGORIES, activeCount, type MetricFilters } from '@/lib/research/filters'

const countryOptions = COUNTRIES.map(c => [c.code, `${c.name} (${CONTINENTS.find(x => x[0] === c.continent)?.[1]})`] as [string, string])
const MAX_COUNTRIES = 8

/** One filter panel shared by every section. Choosing values only changes what is shown or planned: it never calls YouTube. */
export function FilterPanel() {
  const { filters: f, setFilters, presets, savePreset, applyPreset, deletePreset, markets } = useResearch()
  const [name, setName] = useState('')
  const set = (patch: Partial<typeof f>) => setFilters({ ...f, ...patch })
  const logic = (g: keyof typeof f.logic) => (l: 'any' | 'all') => setFilters({ ...f, logic: { ...f.logic, [g]: l } })
  const met = (patch: Partial<MetricFilters>) => setFilters({ ...f, metrics: { ...f.metrics, ...patch } })
  const n = activeCount(f)
  const rpm = (k: 'min' | 'max') => (e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.value.trim(); set({ rpm: { ...f.rpm, [k]: v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v) } }) }
  return <section className="panel" aria-label="Filtros de investigación" style={{ margin: '0 0 14px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <h3>Filtros {n > 0 && <span className="pill info">{n} activos</span>}</h3>
      <button type="button" className="ghost" disabled={n === 0} onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar todos</button>
    </div>
    <p className="muted small" style={{ margin: '4px 0 10px' }}>Combínalos libremente. Elegir valores no gasta cuota: las consultas de pago se planifican aparte y piden confirmación.</p>
    <div className="filterGrid">
      <MultiSelect label="Países" options={countryOptions} value={f.countries} onChange={countries => set({ countries })} max={MAX_COUNTRIES} logic={f.logic.countries} onLogic={logic('countries')} explanation={GROUP_SEMANTICS.countries.explanation} />
      <MultiSelect label="Idiomas" options={LANGUAGES} value={f.languages} onChange={languages => set({ languages })} logic={f.logic.languages} onLogic={logic('languages')} allEnabled={false} explanation={GROUP_SEMANTICS.languages.explanation} />
      <MultiSelect label="Nichos" options={NICHES.map(x => [x.id, x.label])} value={f.niches} onChange={niches => set({ niches })} logic={f.logic.niches} onLogic={logic('niches')} explanation={GROUP_SEMANTICS.niches.explanation} />
      <MultiSelect label="Formatos" options={FORMAT_OPTIONS as Array<[string, string]>} value={f.formats} onChange={formats => set({ formats })} logic={f.logic.formats} onLogic={logic('formats')} allEnabled={false} explanation={GROUP_SEMANTICS.formats.explanation} />
      <MultiSelect label="Tipos de contenido" options={CONTENT_TYPE_OPTIONS} value={f.contentTypes} onChange={contentTypes => set({ contentTypes })} logic={f.logic.contentTypes} onLogic={logic('contentTypes')} explanation={GROUP_SEMANTICS.contentTypes.explanation} />
      <div>
        <label className="muted small" htmlFor="rf-period">Periodo</label>
        <select id="rf-period" value={f.periodDays === null ? '' : String(f.periodDays)} onChange={e => set({ periodDays: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Cualquier fecha</option><option value="7">Última semana</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option>
        </select>
      </div>
      <div>
        <label className="muted small" htmlFor="rf-rpm-min">RPM estimado (USD por 1000 visitas)</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input id="rf-rpm-min" type="number" min={0} step="0.5" inputMode="decimal" placeholder="Mín." value={f.rpm.min ?? ''} onChange={rpm('min')} aria-label="RPM estimado mínimo" />
          <input type="number" min={0} step="0.5" inputMode="decimal" placeholder="Máx." value={f.rpm.max ?? ''} onChange={rpm('max')} aria-label="RPM estimado máximo" />
        </div>
        <label className="msOpt"><input type="checkbox" checked={f.rpm.includeUnknown} onChange={e => set({ rpm: { ...f.rpm, includeUnknown: e.target.checked } })} /> Incluir nichos con RPM desconocido</label>
        <p className="muted small">Filtra por el rango ESTIMADO del nicho (no es el RPM real de nadie).</p>
      </div>
    </div>
    <details style={{ marginTop: 12 }}>
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
        <div><label className="muted small" htmlFor="rf-inc">Debe contener (palabras separadas por comas)</label><input id="rf-inc" value={f.metrics.include} onChange={e => met({ include: e.target.value })} maxLength={200} placeholder="tutorial, 2026" /></div>
        <div><label className="muted small" htmlFor="rf-exc">No debe contener</label><input id="rf-exc" value={f.metrics.exclude} onChange={e => met({ exclude: e.target.value })} maxLength={200} placeholder="reacción, directo" /></div>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Ingreso estimado = visitas ÷ 1000 × RPM ESTIMADO del nicho del vídeo (no lo que ganó el canal). Si el nicho no tiene referencia, el vídeo cuenta como DESCONOCIDO y solo pasa con «Incluir nichos con RPM desconocido».</p>
      <div className="warnBox" role="note" style={{ marginTop: 8 }}>
        <p><b>Métricas que YouTube no da de canales ajenos</b> y que por eso no se pueden filtrar: RPM y dinero real, retención de audiencia, CTR de miniaturas, tiempo de visualización y país real de los espectadores. Solo existen para <b>tus propios canales</b>, con tu autorización (YouTube Analytics): la retención a 7 días ya se mide en la Fábrica de Shorts. Lo que sí se filtra aquí son estimaciones y métricas públicas.</p>
      </div>
    </details>
    <p className="muted small" style={{ marginTop: 10 }}>Mercados que se usarían para analizar: {markets.map(m => m.label).join(' · ')}. País = dónde YouTube muestra el vídeo; no es dónde viven los espectadores.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre para guardar esta combinación" maxLength={60} aria-label="Nombre de la combinación" style={{ maxWidth: 300 }} />
      <button type="button" disabled={!name.trim() || n === 0} onClick={() => { savePreset(name); setName('') }}>Guardar combinación</button>
      {presets.length > 0 && <select aria-label="Aplicar combinación guardada" value="" onChange={e => e.target.value && applyPreset(e.target.value)} style={{ maxWidth: 260 }}>
        <option value="">Filtros favoritos…</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>}
      {presets.length > 0 && <details><summary className="muted small">Gestionar</summary><div className="legend">{presets.map(p => <button key={p.id} type="button" className="pill" aria-label={`Borrar ${p.name}`} onClick={() => deletePreset(p.id)}>{p.name} ✕</button>)}</div></details>}
    </div>
  </section>
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
