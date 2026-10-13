'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Logic } from '@/lib/research/filters'

export type Option = [value: string, label: string]

/** Searchable multi-select with "select all" and "clear", plus an optional Any/All switch whose meaning is explained next to it. */
export function MultiSelect({ label, options, value, onChange, logic, onLogic, allEnabled = true, explanation, max }: {
  label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void
  logic?: Logic; onLogic?: (l: Logic) => void; allEnabled?: boolean; explanation?: string; max?: number
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const shown = useMemo(() => options.filter(([, l]) => l.toLowerCase().includes(q.trim().toLowerCase())), [options, q])
  const names = value.map(v => options.find(([k]) => k === v)?.[1] ?? v)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : max && value.length >= max ? value : [...value, v])
  return <div ref={ref} className="msWrap">
    <label className="muted small" htmlFor={id}>{label}</label>
    <button id={id} type="button" className="msButton" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span>{value.length === 0 ? 'Cualquiera' : value.length <= 2 ? names.join(', ') : `${value.length} seleccionados`}</span><span aria-hidden>▾</span>
    </button>
    {open && <div className="msPop" role="group" aria-label={`Opciones de ${label}`}>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={`Buscar en ${label.toLowerCase()}…`} aria-label={`Buscar en ${label}`} autoFocus />
      <div className="msActions">
        <button type="button" className="ghost" onClick={() => onChange(max ? shown.slice(0, max).map(([v]) => v) : [...new Set([...value, ...shown.map(([v]) => v)])])}>Seleccionar todos{q ? ' (los visibles)' : ''}</button>
        <button type="button" className="ghost" onClick={() => onChange([])}>Limpiar</button>
      </div>
      {max && <p className="muted small">Máximo {max} a la vez.</p>}
      {shown.length === 0 && <p className="muted small">Sin coincidencias.</p>}
      {shown.map(([v, l]) => <label key={v} className="msOpt"><input type="checkbox" checked={value.includes(v)} onChange={() => toggle(v)} /> {l}</label>)}
    </div>}
    {value.length > 0 && <div className="legend" style={{ marginTop: 6 }}>{value.slice(0, 6).map((v, i) => <button key={v} type="button" className="pill" aria-label={`Quitar ${names[i]}`} onClick={() => toggle(v)}>{names[i]} ✕</button>)}{value.length > 6 && <span className="pill">+{value.length - 6}</span>}</div>}
    {logic && onLogic && <div style={{ marginTop: 4 }}>
      <div className="logicToggle" role="group" aria-label={`Lógica de ${label}`}>
        <button type="button" aria-pressed={logic === 'any'} onClick={() => onLogic('any')}>Cualquiera (OR)</button>
        <button type="button" aria-pressed={logic === 'all'} disabled={!allEnabled} onClick={() => onLogic('all')} title={allEnabled ? '' : 'No aplicable a vídeos sueltos: mira la nota'}>Todos (AND)</button>
      </div>
      {explanation && <p className="muted small" style={{ marginTop: 4 }}>{explanation}</p>}
    </div>}
  </div>
}
