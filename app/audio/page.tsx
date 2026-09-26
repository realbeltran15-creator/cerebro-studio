'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { deleteAsset, uploadProjectMedia, type LicenseStatus } from '@/lib/media-upload'
import type { ProjectRow } from '@/lib/types/database'

type AudioAsset = { id: string; asset_type: 'music' | 'sfx'; storage_path: string | null; source_url: string | null; license_status: string; provenance: Record<string, unknown> | null; created_at: string; url?: string }

const licenseLabels: Record<string, string> = { owned: 'Propio', licensed: 'Con licencia', public_domain: 'Dominio público', generated: 'Generado', unknown: 'Sin verificar', restricted: 'Restringido' }
const fmtDuration = (s: unknown) => (typeof s === 'number' ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—')

export default function AudioPage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [items, setItems] = useState<AudioAsset[]>([])
  const [filter, setFilter] = useState<'all' | 'music' | 'sfx'>('all')
  const [kind, setKind] = useState<'music' | 'sfx'>('music')
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [title, setTitle] = useState('')
  const [license, setLicense] = useState<LicenseStatus>('licensed')
  const [sourceUrl, setSourceUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [mood, setMood] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('project')
    void (async () => {
      const { data, error: e } = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
      if (e) { setError(e.message); return }
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows)
      setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
    })()
  }, [supabase])

  const load = useCallback(async (pid: string) => {
    const { data, error: e } = await supabase.from('assets').select('id,asset_type,storage_path,source_url,license_status,provenance,created_at')
      .eq('project_id', pid).in('asset_type', ['music', 'sfx']).order('created_at', { ascending: false }).limit(100)
    if (e) { setError(e.message); return }
    const rows = (data ?? []) as AudioAsset[]
    setItems(rows)
    const withUrls = await Promise.all(rows.map(async a => {
      const r = await fetch(`/api/assets/${a.id}/signed-url`, { cache: 'no-store' })
      const json = await r.json().catch(() => ({})) as { url?: string }
      return { ...a, url: json.url }
    }))
    setItems(withUrls)
  }, [supabase])

  useEffect(() => { if (projectId) void load(projectId) }, [projectId, load])

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!file || !projectId || busy) return
    if (license === 'licensed' && !notes.trim() && !sourceUrl.trim()) { setError('Indica la licencia o el enlace de origen de la pista.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await uploadProjectMedia(supabase, { projectId, kind, file, title: title || file.name, license, sourceUrl, licenseNotes: notes, extra: { mood: mood.trim() || null } })
      setFile(null); setFileKey(k => k + 1); setTitle(''); setSourceUrl(''); setNotes(''); setMood('')
      setNotice(kind === 'music' ? 'Pista de música añadida al proyecto.' : 'Efecto de sonido añadido al proyecto.')
      await load(projectId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir el archivo.')
    } finally { setBusy(false) }
  }

  async function remove(asset: AudioAsset) {
    if (!window.confirm(`¿Borrar «${String(asset.provenance?.title ?? 'pista')}»? No se puede deshacer.`)) return
    setError('')
    try { await deleteAsset(supabase, asset); setItems(list => list.filter(a => a.id !== asset.id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo borrar.') }
  }

  const visible = filter === 'all' ? items : items.filter(a => a.asset_type === filter)

  return <StudioShell title="Música y sonidos" eyebrow="RECURSOS" actions={projectId ? <Link className="buttonLink ghost" href={`/projects/${projectId}`}>Volver al proyecto</Link> : null}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <section className="panel" style={{ marginBottom: 18 }}>
      <form onSubmit={upload} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field-row">
          <label htmlFor="audio-project">Proyecto
            <select id="audio-project" value={projectId} onChange={e => setProjectId(e.target.value)}>
              {projects.length === 0 && <option value="">Sin proyectos</option>}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label htmlFor="audio-kind">Tipo
            <select id="audio-kind" value={kind} onChange={e => setKind(e.target.value as 'music' | 'sfx')}>
              <option value="music">Música</option>
              <option value="sfx">Efecto de sonido</option>
            </select>
          </label>
          <label htmlFor="audio-license">Licencia
            <select id="audio-license" value={license} onChange={e => setLicense(e.target.value as LicenseStatus)}>
              <option value="licensed">Con licencia (biblioteca, compra)</option>
              <option value="owned">Propio (compuesto o grabado por ti)</option>
              <option value="public_domain">Dominio público</option>
            </select>
          </label>
        </div>
        <div className="field-row">
          <label htmlFor="audio-file">Archivo de audio
            <input key={fileKey} id="audio-file" type="file" accept="audio/*" onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '')) }} required />
          </label>
          <label htmlFor="audio-title">Título<input id="audio-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} /></label>
          <label htmlFor="audio-mood">Uso o ambiente<input id="audio-mood" value={mood} onChange={e => setMood(e.target.value)} maxLength={80} placeholder="Tensión, cierre, viento…" /></label>
        </div>
        <div className="field-row">
          <label htmlFor="audio-source">Enlace de origen<input id="audio-source" type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="Página de la licencia o de la pista" /></label>
          <label htmlFor="audio-notes">Condiciones de la licencia<input id="audio-notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} placeholder="Ej.: licencia estándar YouTube, atribución requerida…" /></label>
        </div>
        <p className="muted small">Máximo 50 MB para música y 20 MB para efectos. Solo sube audio que puedas usar: la licencia queda registrada junto al archivo para revisarla antes de publicar. No hay proveedor de música generativa conectado.</p>
        <div><button disabled={busy || !file || !projectId}><Icon name="plus" size={16} />{busy ? 'Subiendo…' : 'Añadir al proyecto'}</button></div>
      </form>
    </section>

    <div className="cardHead">
      <h3>Pistas del proyecto ({visible.length})</h3>
      <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Filtrar por tipo" style={{ maxWidth: 200 }}>
        <option value="all">Todo</option>
        <option value="music">Música</option>
        <option value="sfx">Efectos</option>
      </select>
    </div>
    {visible.length === 0 ? <p className="emptyState">Todavía no hay música ni efectos en este proyecto.</p> : <div className="list">
      {visible.map(a => <div key={a.id} className="listItem" style={{ flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <b>{String(a.provenance?.title ?? 'Sin título')}</b>
          <span className="muted small" style={{ display: 'block' }}>
            {a.asset_type === 'music' ? 'Música' : 'Efecto'} · {fmtDuration(a.provenance?.durationSeconds)}{a.provenance?.mood ? ` · ${String(a.provenance.mood)}` : ''} · {licenseLabels[a.license_status] ?? a.license_status}
            {a.source_url && <> · <a href={a.source_url} target="_blank" rel="noopener noreferrer">origen</a></>}
          </span>
          {Boolean(a.provenance?.licenseNotes) && <span className="muted small" style={{ display: 'block' }}>{String(a.provenance?.licenseNotes)}</span>}
        </div>
        {a.url ? <audio src={a.url} controls preload="none" style={{ maxWidth: 320 }} /> : <span className="muted small">Cargando…</span>}
        <button type="button" className="iconButton" aria-label="Borrar pista" onClick={() => void remove(a)}><Icon name="trash" size={16} /></button>
      </div>)}
    </div>}
  </StudioShell>
}
