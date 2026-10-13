'use client'

import { FORMATS, LANGUAGES, NO_FILTERS, SORTS, activeFilterCount, type ResultFilters, type SortKey, type VideoFormat } from '@/lib/research/discovery'

const num = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null }

/** One filter bar for every list of videos in Investigación. Filtering happens in the browser, so it costs no API quota. */
export function ResultFilterBar({ value, onChange, shown, total }: { value: ResultFilters; onChange: (f: ResultFilters) => void; shown: number; total: number }) {
  const set = (patch: Partial<ResultFilters>) => onChange({ ...value, ...patch })
  const count = activeFilterCount(value)
  return <div className="panel" style={{ margin: '12px 0' }} role="group" aria-label="Filtros de resultados">
    <div className="marketForm">
      <select value={value.format} onChange={e => set({ format: e.target.value as VideoFormat | '' })} aria-label="Formato">
        <option value="">Todos los formatos</option>
        {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      <select value={value.language} onChange={e => set({ language: e.target.value })} aria-label="Idioma del vídeo">
        <option value="">Cualquier idioma</option>
        {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
      <select value={value.maxAgeDays === null ? '' : String(value.maxAgeDays)} onChange={e => set({ maxAgeDays: num(e.target.value) })} aria-label="Antigüedad máxima">
        <option value="">Cualquier antigüedad</option>
        <option value="2">Últimas 48 horas</option><option value="7">Última semana</option><option value="30">Último mes</option><option value="90">Últimos 3 meses</option><option value="365">Último año</option>
      </select>
      <select value={value.sort} onChange={e => set({ sort: e.target.value as SortKey })} aria-label="Ordenar por">
        {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <input type="number" min={0} inputMode="numeric" value={value.minViews ?? ''} onChange={e => set({ minViews: num(e.target.value) })} placeholder="Vistas mínimas" aria-label="Vistas mínimas" />
      <input type="number" min={0} inputMode="numeric" value={value.maxSubscribers ?? ''} onChange={e => set({ maxSubscribers: num(e.target.value) })} placeholder="Suscriptores máx. del canal" aria-label="Suscriptores máximos del canal" />
      <input type="number" min={0} step="0.5" inputMode="decimal" value={value.minRatio ?? ''} onChange={e => set({ minRatio: num(e.target.value) })} placeholder="Vistas ÷ suscriptores mín." aria-label="Ratio mínimo de vistas por suscriptor" />
      <button type="button" className="ghost" disabled={count === 0} onClick={() => onChange(NO_FILTERS)}>Quitar filtros{count ? ` (${count})` : ''}</button>
    </div>
    <p className="muted small" style={{ marginTop: 8 }}>
      Mostrando {shown} de {total}. Los filtros trabajan sobre lo ya descargado y no gastan cuota. Formato = por duración (YouTube no marca los Shorts). Idioma = el que declaró quien subió el vídeo; si no lo declaró, queda fuera al filtrar.
    </p>
  </div>
}
