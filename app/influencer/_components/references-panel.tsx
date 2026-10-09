'use client'

import { FormEvent, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { uploadProjectMedia, type LicenseStatus } from '@/lib/media-upload'
import { referenceCategories } from '@/lib/virtual-influencer/identity'
import { useSignedUrls, type Persona, type Reference } from './shared'

type AssetLite = { id: string; asset_type: string; provenance: Record<string, unknown> | null }

/** Reference library: files are uploaded as project assets (Biblioteca) and linked by category. */
export function ReferencesPanel({ persona, references, assets, locked, onChanged }: { persona: Persona; references: Reference[]; assets: AssetLite[]; locked: boolean; onChanged: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const [category, setCategory] = useState('face_front')
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [license, setLicense] = useState<LicenseStatus>('owned')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const urls = useSignedUrls(references.map(r => r.asset_id))
  const typeOf = (id: string) => assets.find(a => a.id === id)?.asset_type

  async function upload(e: FormEvent) {
    e.preventDefault()
    if (!file || busy) return
    setBusy(true); setError('')
    try {
      const kind = category === 'voice_sample' ? 'voice' : file.type.startsWith('video/') ? 'video' : 'image'
      const asset = await uploadProjectMedia(supabase, { projectId: persona.project_id, kind, file, title: `${persona.name} · ${category}`, license, licenseNotes: notes, extra: { purpose: 'virtual_influencer_reference', personaId: persona.id, category } })
      const { data: { user } } = await supabase.auth.getUser()
      const { error: re } = await supabase.from('vi_references').insert({ owner_id: user!.id, persona_id: persona.id, asset_id: asset.id, category, notes: notes.trim() || null })
      if (re) throw re
      setFile(null); setFileKey(k => k + 1); setNotes('')
      onChanged()
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo subir la referencia.') } finally { setBusy(false) }
  }

  async function toggle(r: Reference) {
    const { error: e } = await supabase.from('vi_references').update({ approved: !r.approved }).eq('id', r.id)
    if (e) setError(e.message); else onChanged()
  }
  async function unlink(r: Reference) {
    if (!window.confirm('¿Quitar esta referencia de la persona? El archivo sigue en la Biblioteca.')) return
    const { error: e } = await supabase.from('vi_references').delete().eq('id', r.id)
    if (e) setError(e.message); else onChanged()
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <h3>Biblioteca de referencias</h3>
    <p className="muted small">Solo las referencias marcadas como aprobadas cuentan para la identidad. Los archivos se guardan en la Biblioteca del proyecto «{persona.name}».{locked ? ' La identidad aprobada ya fijó sus referencias: los cambios aquí se aplican a la siguiente versión.' : ''}</p>
    <form onSubmit={upload} className="field-row" style={{ alignItems: 'end' }}>
      <label>Categoría<select value={category} onChange={e => setCategory(e.target.value)}>{referenceCategories.map(c => <option key={c.id} value={c.id}>{c.label}{c.min ? ` (mín. ${c.min})` : ''}</option>)}</select></label>
      <label>Archivo<input key={fileKey} type="file" accept={category === 'voice_sample' ? 'audio/*' : 'image/png,image/jpeg,image/webp,video/mp4,video/webm'} onChange={e => setFile(e.target.files?.[0] ?? null)} required /></label>
      <label>Origen<select value={license} onChange={e => setLicense(e.target.value as LicenseStatus)}><option value="owned">Propio / creado para esta persona</option><option value="licensed">Con licencia</option></select></label>
      <label>Notas<input value={notes} onChange={e => setNotes(e.target.value)} maxLength={300} placeholder="Luz, ángulo, qué muestra" /></label>
      <div><button disabled={busy || !file}>{busy ? 'Subiendo…' : 'Añadir referencia'}</button></div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {referenceCategories.map(c => {
      const list = references.filter(r => r.category === c.id)
      const approved = list.filter(r => r.approved).length
      if (!list.length && !c.min) return null
      return <div key={c.id}>
        <b className="small">{c.label}</b> <span className={approved >= c.min ? 'pill ok' : 'pill warn'}>{approved}/{c.min || '—'} aprobadas</span>
        <div className="viThumbs">{list.map(r => <figure key={r.id}>
          {typeOf(r.asset_id) === 'voice' ? (urls[r.asset_id] ? <audio src={urls[r.asset_id]} controls preload="none" style={{ width: '100%' }} /> : <span className="muted small">…</span>)
            : typeOf(r.asset_id) === 'video' ? (urls[r.asset_id] ? <video src={urls[r.asset_id]} muted controls preload="metadata" /> : <span className="muted small">…</span>)
              : urls[r.asset_id] ? <img src={urls[r.asset_id]} alt={c.label} loading="lazy" /> : <span className="muted small">…</span>}
          {r.notes && <span className="muted small">{r.notes}</span>}
          <label className="small"><input type="checkbox" checked={r.approved} onChange={() => void toggle(r)} /> Aprobada</label>
          <button type="button" className="ghost small" onClick={() => void unlink(r)}>Quitar</button>
        </figure>)}</div>
      </div>
    })}
  </section>
}
