'use client'

import { FormEvent, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Field } from './shared'

export type CatalogRow = { id: string; name: string; status?: string; [k: string]: unknown }

type Spec = {
  table: 'vi_voice_profiles' | 'vi_scenes' | 'vi_wardrobe'
  title: string
  intro: string
  /** jsonb column holding the detail fields */
  jsonColumn: 'settings' | 'environment' | 'details'
  fields: Array<{ key: string; label: string; hint?: string; long?: boolean }>
  topFields?: Array<{ key: string; label: string; options?: Array<[string, string]> }>
  approvable?: boolean
}

export const catalogSpecs: Record<'voice' | 'scenes' | 'wardrobe', Spec> = {
  voice: {
    table: 'vi_voice_profiles', title: 'Voice Profile', jsonColumn: 'settings', approvable: true,
    intro: 'Define la voz de la persona. Las muestras se suben como referencias «Muestras de voz». La estabilidad de la voz se revisa por persona hasta que exista un modelo de verificación de hablante conectado.',
    topFields: [{ key: 'provider', label: 'Proveedor', options: [['', 'Sin asignar'], ['elevenlabs-voice', 'ElevenLabs'], ['openai-voice', 'OpenAI TTS (voces genéricas)']] }, { key: 'provider_voice_id', label: 'ID de voz en el proveedor' }],
    fields: [
      { key: 'language', label: 'Idioma y variante', hint: 'es-ES, es-MX…' }, { key: 'accent', label: 'Acento' }, { key: 'pitch', label: 'Tono (grave/agudo)' },
      { key: 'pace', label: 'Ritmo' }, { key: 'energy', label: 'Energía' }, { key: 'emotionRange', label: 'Rango emocional', long: true },
      { key: 'pronunciation', label: 'Pronunciación y palabras especiales', long: true },
    ],
  },
  scenes: {
    table: 'vi_scenes', title: 'Scene Bible', jsonColumn: 'environment',
    intro: 'Localizaciones recurrentes con geometría, luz y cámara fijas para que el entorno sea coherente entre piezas.',
    fields: [
      { key: 'location', label: 'Lugar' }, { key: 'timeOfDay', label: 'Momento del día' }, { key: 'lighting', label: 'Iluminación (fuente, dirección, color)', long: true },
      { key: 'geometry', label: 'Geometría y objetos fijos', long: true }, { key: 'camera', label: 'Cámara y óptica', hint: 'Altura, distancia focal, encuadre' },
      { key: 'palette', label: 'Paleta de color' },
    ],
  },
  wardrobe: {
    table: 'vi_wardrobe', title: 'Vestuario', jsonColumn: 'details',
    intro: 'Prendas y accesorios canónicos. Las fotos de referencia se suben en la categoría «Vestuario».',
    topFields: [{ key: 'category', label: 'Tipo', options: [['outfit', 'Conjunto'], ['accessory', 'Accesorio'], ['footwear', 'Calzado'], ['hair_style', 'Peinado'], ['makeup', 'Maquillaje']] }],
    fields: [{ key: 'colors', label: 'Colores' }, { key: 'materials', label: 'Materiales y texturas' }, { key: 'fit', label: 'Corte y ajuste' }, { key: 'rules', label: 'Cuándo se usa', long: true }],
  },
}

export function CatalogPanel({ spec, personaId, rows, onChanged }: { spec: Spec; personaId: string; rows: CatalogRow[]; onChanged: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const empty = () => ({ name: '', description: '', ...Object.fromEntries((spec.topFields ?? []).map(f => [f.key, f.options?.[0]?.[0] ?? ''])), ...Object.fromEntries(spec.fields.map(f => [f.key, ''])) }) as Record<string, string>
  const [form, setForm] = useState<Record<string, string>>(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')

  function edit(row: CatalogRow) {
    const json = (row[spec.jsonColumn] ?? {}) as Record<string, string>
    setEditing(row.id)
    setForm({ name: row.name, description: String(row.description ?? ''), ...Object.fromEntries((spec.topFields ?? []).map(f => [f.key, String(row[f.key] ?? '')])), ...Object.fromEntries(spec.fields.map(f => [f.key, json[f.key] ?? ''])) })
  }

  async function save(e: FormEvent) {
    e.preventDefault(); setError('')
    const json = Object.fromEntries(spec.fields.map(f => [f.key, form[f.key]?.trim() ?? '']).filter(([, v]) => v))
    const row: Record<string, unknown> = { name: form.name.trim(), [spec.jsonColumn]: json, updated_at: new Date().toISOString() }
    if (spec.table !== 'vi_voice_profiles') row.description = form.description.trim() || null
    for (const f of spec.topFields ?? []) row[f.key] = form[f.key] || null
    if (spec.table === 'vi_wardrobe') row.category = form.category || 'outfit'
    if (editing) {
      if (spec.approvable) row.status = 'draft' // any change needs a new approval
      const { error: err } = await supabase.from(spec.table).update(row).eq('id', editing)
      if (err) { setError(err.message); return }
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { error: err } = await supabase.from(spec.table).insert({ ...row, owner_id: user!.id, persona_id: personaId })
      if (err) { setError(err.message); return }
    }
    setForm(empty()); setEditing(null); onChanged()
  }

  async function setStatus(row: CatalogRow, status: 'approved' | 'draft') {
    if (status === 'approved' && !window.confirm(`¿Aprobar «${row.name}» tras escuchar sus muestras?`)) return
    const { error: err } = await supabase.from(spec.table).update({ status, updated_at: new Date().toISOString() }).eq('id', row.id)
    if (err) setError(err.message); else onChanged()
  }
  async function remove(row: CatalogRow) {
    if (!window.confirm(`¿Borrar «${row.name}»?`)) return
    const { error: err } = await supabase.from(spec.table).delete().eq('id', row.id)
    if (err) setError(err.message); else onChanged()
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <h3>{spec.title}</h3>
    <p className="muted small">{spec.intro}</p>
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field-row">
        <Field label="Nombre"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required maxLength={120} /></Field>
        {(spec.topFields ?? []).map(f => <Field key={f.key} label={f.label}>{f.options
          ? <select value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : <input value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} maxLength={120} />}</Field>)}
      </div>
      {spec.table !== 'vi_voice_profiles' && <Field label="Descripción"><textarea className="viText" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>}
      <div className="field-row">{spec.fields.map(f => <Field key={f.key} label={f.label} hint={f.hint}>{f.long
        ? <textarea className="viText" value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} />
        : <input value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} maxLength={200} />}</Field>)}</div>
      <div className="pageActions"><button>{editing ? 'Guardar cambios' : 'Añadir'}</button>{editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setForm(empty()) }}>Cancelar</button>}</div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {rows.length === 0 ? <p className="emptyState">Sin elementos todavía.</p> : <div className="list">{rows.map(r => <div key={r.id} className="listItem">
      <div><b>{r.name}</b><span>{Object.values((r[spec.jsonColumn] ?? {}) as Record<string, string>).filter(Boolean).join(' · ').slice(0, 160) || '—'}</span></div>
      <div className="pageActions">
        {spec.approvable && <span className={r.status === 'approved' ? 'pill ok' : 'pill'}>{r.status === 'approved' ? 'Aprobado' : 'Borrador'}</span>}
        {spec.approvable && (r.status === 'approved' ? <button type="button" className="ghost small" onClick={() => void setStatus(r, 'draft')}>Retirar aprobación</button> : <button type="button" className="ghost small" onClick={() => void setStatus(r, 'approved')}>Aprobar</button>)}
        <button type="button" className="ghost small" onClick={() => edit(r)}>Editar</button>
        <button type="button" className="iconButton" aria-label="Borrar" onClick={() => void remove(r)}>✕</button>
      </div>
    </div>)}</div>}
  </section>
}
