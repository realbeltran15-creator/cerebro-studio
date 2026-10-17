'use client'

import { useId } from 'react'

/** Numeric input that keeps "empty" as null (an unanswered question) instead of turning it into 0. */
export function NumField({ label, value, onChange, min = 0, max, step = 1, suffix, placeholder }: { label: string; value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; suffix?: string; placeholder?: string }) {
  const id = useId()
  return <div><label className="muted small" htmlFor={id}>{label}</label>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={value ?? ''} placeholder={placeholder}
        onChange={e => { const t = e.target.value; if (t === '') return onChange(null); const n = Number(t); onChange(Number.isFinite(n) && n >= min && (max === undefined || n <= max) ? n : value) }} />
      {suffix && <span className="muted small">{suffix}</span>}
    </div></div>
}
export function TextField({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const id = useId()
  return <div><label className="muted small" htmlFor={id}>{label}</label>
    {multiline ? <textarea id={id} rows={3} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} /> : <input id={id} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}</div>
}
export function SelectField<T extends string>({ label, value, onChange, options, empty }: { label: string; value: T | null; onChange: (v: T | null) => void; options: Array<[T, string]>; empty: string }) {
  const id = useId()
  return <div><label className="muted small" htmlFor={id}>{label}</label>
    <select id={id} value={value ?? ''} onChange={e => onChange((e.target.value || null) as T | null)}><option value="">{empty}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
}
