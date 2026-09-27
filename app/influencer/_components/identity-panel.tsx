'use client'

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { parseBible } from '@/lib/virtual-influencer/bible'
import { identityReadiness, nextVersionNumber, parseTraits, traitFields, type Traits } from '@/lib/virtual-influencer/identity'
import { QualityReview } from './quality-review'
import { Field, type IdentityVersion, type Persona, type Reference } from './shared'

const statusLabels: Record<string, string> = { draft: 'Borrador', approved: 'Aprobada', superseded: 'Sustituida' }

export function IdentityPanel({ persona, versions, references, onChanged }: { persona: Persona; versions: IdentityVersion[]; references: Reference[]; onChanged: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const [selectedId, setSelectedId] = useState<string>(versions[0]?.id ?? '')
  const selected = versions.find(v => v.id === selectedId) ?? versions[0] ?? null
  const [traits, setTraits] = useState<Traits>(() => parseTraits(selected?.traits))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setTraits(parseTraits(selected?.traits)) }, [selected?.id, selected?.traits])

  const editable = selected?.status === 'draft'
  const readiness = identityReadiness({ bible: parseBible(persona.bible), traits, references })

  async function newVersion() {
    setError(''); setNotice('')
    const { data: { user } } = await supabase.auth.getUser()
    const base = versions[0] ? parseTraits(versions[0].traits) : {}
    const { data, error: e } = await supabase.from('vi_identity_versions').insert({ owner_id: user!.id, persona_id: persona.id, version: nextVersionNumber(versions), traits: base }).select('id').single()
    if (e) { setError(e.message); return }
    setSelectedId((data as { id: string }).id); onChanged()
  }
  async function saveTraits() {
    if (!selected || !editable) return
    const { error: e } = await supabase.from('vi_identity_versions').update({ traits }).eq('id', selected.id)
    if (e) setError(e.message); else { setNotice('Rasgos guardados.'); onChanged() }
  }
  async function approve() {
    if (!selected) return
    if (!window.confirm(`Aprobar la identidad v${selected.version}. Quedará fijada y no se podrá editar; los cambios futuros crearán otra versión. ¿Continuar?`)) return
    setBusy(true); setError(''); setNotice('')
    await supabase.from('vi_identity_versions').update({ traits }).eq('id', selected.id)
    const r = await fetch(`/api/influencer/${persona.id}/identity/${selected.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'APROBAR' }) })
    const j = await r.json().catch(() => ({})) as { error?: string }
    setBusy(false)
    if (!r.ok) setError(j.error ?? 'No se pudo aprobar.'); else { setNotice(`Identidad v${selected.version} aprobada.`); onChanged() }
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div className="cardHead" style={{ marginBottom: 0 }}>
      <h3>Identidad</h3>
      <div className="pageActions">
        {versions.length > 0 && <select value={selected?.id ?? ''} onChange={e => setSelectedId(e.target.value)} aria-label="Versión">{versions.map(v => <option key={v.id} value={v.id}>v{v.version} · {statusLabels[v.status] ?? v.status}</option>)}</select>}
        <button type="button" className="ghost" onClick={() => void newVersion()} disabled={versions.some(v => v.status === 'draft')}>Nueva versión</button>
      </div>
    </div>
    <p className="muted small">Una versión aprobada es inmutable (lo garantiza la base de datos). Para cambiar la identidad se crea otra versión, que se revisa y aprueba de nuevo.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!selected ? <p className="emptyState">Crea la primera versión de la identidad.</p> : <>
      <div className="field-row">{traitFields.map(f => <Field key={f.key} label={f.label} hint={f.hint}>
        <textarea className="viText" value={traits[f.key] ?? ''} disabled={!editable} onChange={e => setTraits(t => ({ ...t, [f.key]: e.target.value }))} maxLength={1000} />
      </Field>)}</div>
      {editable && <div><button type="button" className="ghost" onClick={() => void saveTraits()}>Guardar rasgos</button></div>}
      {selected.status !== 'draft' && <p className="muted small">Referencias fijadas en esta versión: {selected.reference_asset_ids.length}. Aprobada {selected.approved_at ? new Date(selected.approved_at).toLocaleString() : '—'}.</p>}
      {editable && <div>
        <b className="small">Requisitos para aprobar</b>
        {readiness.ready ? <p className="notice small">Bible, rasgos y referencias completos. Falta la revisión de calidad y tu aprobación.</p>
          : <ul className="warnList">{readiness.missing.map(m => <li key={m}>{m}</li>)}</ul>}
      </div>}
      <QualityReview personaId={persona.id} subjectType="identity_version" subjectId={selected.id} kind="identity" readOnly={!editable} />
      {editable && <div><button type="button" disabled={busy || !readiness.ready} onClick={() => void approve()}>{busy ? 'Aprobando…' : `Aprobar identidad v${selected.version}`}</button></div>}
    </>}
  </section>
}
