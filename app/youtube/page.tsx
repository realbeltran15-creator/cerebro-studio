'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { ResearchCapture } from './research-capture'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { YouTubePayload } from '@/lib/publication/youtube'
import type { ProjectRow } from '@/lib/types/database'

type Job = { id: string; project_id: string; status: string; created_at: string; approved_at: string | null; payload: YouTubePayload; result: Record<string, unknown> | null }
type Asset = { id: string; asset_type: string; license_status: string; provenance: Record<string, unknown> | null; created_at: string }
type Channel = { external_account_name: string | null; scopes: string[] }

const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
const statusLabels: Record<string, string> = { draft: 'Borrador', awaiting_approval: 'Pendiente de aprobación', approved: 'Aprobado · sin publicar', publishing: 'Publicando…', published: 'Publicado', failed: 'Falló', cancelled: 'Cancelado' }
const privacyLabels = { private: 'Privado', unlisted: 'No listado', public: 'Público' } as const
const categories = [['27', 'Educación'], ['22', 'Gente y blogs'], ['24', 'Entretenimiento'], ['25', 'Noticias y política'], ['28', 'Ciencia y tecnología'], ['19', 'Viajes y eventos'], ['1', 'Cine y animación']] as const

const emptyForm = { videoAssetId: '', thumbnailAssetId: '', title: '', description: '', tags: '', privacyStatus: 'private' as YouTubePayload['privacyStatus'], categoryId: '27', madeForKids: false, containsSyntheticMedia: true }

export default function YouTubePage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [channel, setChannel] = useState<Channel | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [approving, setApproving] = useState<Job | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('project')
    void (async () => {
      const [{ data }, { data: ch }] = await Promise.all([
        supabase.from('projects').select('*').order('updated_at', { ascending: false }),
        supabase.from('channel_connections').select('external_account_name,scopes').eq('provider', 'youtube').eq('status', 'connected').limit(1),
      ])
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows)
      setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
      setChannel(((ch ?? [])[0] as Channel | undefined) ?? null)
    })()
  }, [supabase])

  const load = useCallback(async (pid: string) => {
    const [{ data: j, error: e }, { data: a }] = await Promise.all([
      supabase.from('publication_jobs').select('id,project_id,status,created_at,approved_at,payload,result').eq('platform', 'youtube').eq('project_id', pid).order('created_at', { ascending: false }),
      supabase.from('assets').select('id,asset_type,license_status,provenance,created_at').eq('project_id', pid).in('asset_type', ['video', 'thumbnail']).not('storage_path', 'is', null).order('created_at', { ascending: false }),
    ])
    if (e) setError(e.message)
    setJobs((j ?? []) as Job[]); setAssets((a ?? []) as Asset[])
  }, [supabase])

  useEffect(() => { if (projectId) { setForm(emptyForm); setEditing(null); void load(projectId) } }, [projectId, load])

  const videos = useMemo(() => assets.filter(a => a.asset_type === 'video'), [assets])
  const thumbs = useMemo(() => assets.filter(a => a.asset_type === 'thumbnail'), [assets])

  // Defaults: latest render, the project's selected thumbnail.
  useEffect(() => {
    if (editing) return
    setForm(f => ({ ...f, videoAssetId: f.videoAssetId || videos[0]?.id || '', thumbnailAssetId: f.thumbnailAssetId || thumbs.find(t => t.provenance?.selected)?.id || '' }))
  }, [videos, thumbs, editing])

  function payloadFromForm(): YouTubePayload {
    return {
      title: form.title.trim(), description: form.description.trim(), tags: form.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 30),
      privacyStatus: form.privacyStatus, categoryId: form.categoryId, madeForKids: form.madeForKids, containsSyntheticMedia: form.containsSyntheticMedia,
      videoAssetId: form.videoAssetId || undefined, thumbnailAssetId: form.thumbnailAssetId || null,
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(''); setNotice('')
    if (!form.title.trim()) { setError('El título es obligatorio.'); return }
    if (!form.videoAssetId) { setError('Elige el vídeo. Si no hay ninguno, renderízalo en el Editor.'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('La sesión ha caducado.'); return }
    const payload = payloadFromForm()
    const { error: err } = editing
      ? await supabase.from('publication_jobs').update({ payload, status: 'draft', updated_at: new Date().toISOString() }).eq('id', editing).in('status', ['draft', 'awaiting_approval'])
      : await supabase.from('publication_jobs').insert({ owner_id: user.id, project_id: projectId, platform: 'youtube', status: 'draft', idempotency_key: crypto.randomUUID(), payload })
    if (err) { setError(err.message); return }
    setForm(emptyForm); setEditing(null)
    setNotice(editing ? 'Borrador actualizado.' : 'Publicación preparada como borrador. No se ha enviado nada a YouTube.')
    await load(projectId)
  }

  function edit(job: Job) {
    setEditing(job.id)
    setForm({
      videoAssetId: job.payload.videoAssetId ?? '', thumbnailAssetId: job.payload.thumbnailAssetId ?? '', title: job.payload.title ?? '', description: job.payload.description ?? '',
      tags: (job.payload.tags ?? []).join(', '), privacyStatus: job.payload.privacyStatus ?? 'private', categoryId: job.payload.categoryId ?? '27',
      madeForKids: job.payload.madeForKids ?? false, containsSyntheticMedia: job.payload.containsSyntheticMedia ?? true,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function riskSummary(job: Job) {
    const v = assets.find(a => a.id === job.payload.videoAssetId)
    const inputs = Array.isArray(v?.provenance?.inputs) ? v!.provenance!.inputs as Array<{ type: string; license: string; provider: string | null }> : []
    const byLicense = inputs.reduce<Record<string, number>>((m, i) => ({ ...m, [i.license]: (m[i.license] ?? 0) + 1 }), {})
    return [
      `Canal: ${channel?.external_account_name ?? 'sin conectar'}`,
      `Privacidad: ${privacyLabels[job.payload.privacyStatus ?? 'private']}`,
      `Vídeo: ${String(v?.provenance?.title ?? job.payload.videoAssetId)} (licencia ${v?.license_status ?? '?'})`,
      `Entradas: ${Object.entries(byLicense).map(([k, n]) => `${n} ${k}`).join(', ') || 'sin registro'}`,
      `Contenido sintético declarado: ${job.payload.containsSyntheticMedia === false ? 'no' : 'sí'}`,
      `Dirigido a niños: ${job.payload.madeForKids ? 'sí' : 'no'}`,
    ]
  }

  async function approve() {
    if (!approving || confirmText !== 'APROBAR') return
    setBusy(approving.id); setError('')
    try {
      const r = await fetch(`/api/publish/youtube/${approving.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'APROBAR', riskSummary: riskSummary(approving).join(' · ') }) })
      const json = await r.json() as { error?: string }
      if (!r.ok) throw new Error(json.error ?? 'No se pudo aprobar.')
      setNotice('Aprobado. Todavía no se ha publicado: pulsa «Publicar en YouTube» cuando quieras subirlo.')
      setApproving(null); setConfirmText('')
      await load(projectId)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo aprobar.') } finally { setBusy('') }
  }

  async function publish(job: Job) {
    if (!window.confirm(`Se subirá «${job.payload.title}» a tu canal como ${privacyLabels[job.payload.privacyStatus ?? 'private'].toLowerCase()}. ¿Continuar?`)) return
    setBusy(job.id); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/publish/youtube/${job.id}/publish`, { method: 'POST' })
      const json = await r.json() as { url?: string; error?: string }
      if (!r.ok) throw new Error(json.error ?? 'La publicación falló.')
      setNotice(`Subido a YouTube: ${json.url}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'La publicación falló.') } finally { setBusy(''); await load(projectId) }
  }

  async function cancel(job: Job) {
    const { error: e } = await supabase.from('publication_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', job.id).in('status', ['draft', 'awaiting_approval', 'approved'])
    if (e) setError(e.message); else await load(projectId)
  }

  const canUpload = Boolean(channel?.scopes.includes(UPLOAD_SCOPE))

  return <StudioShell title="YouTube" eyebrow="PUBLICACIÓN">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <div className="hero"><div><small>PUBLICACIÓN CON APROBACIÓN</small><h2>Cola de publicación</h2><p>Prepara título, descripción y privacidad. Nada se sube sin dos pasos tuyos: aprobar el trabajo y pulsar publicar. Por defecto los vídeos se suben como privados.</p></div>
      <div className="status"><b>{jobs.filter(j => j.status === 'published').length}</b><span>publicados</span><span>{channel ? `Canal: ${channel.external_account_name ?? 'conectado'}` : 'Canal sin conectar'}</span>{channel && !canUpload && <Link className="open" href="/connectors">Permitir subida →</Link>}{!channel && <Link className="open" href="/connectors">Conectar →</Link>}</div></div>

    <section className="panel" style={{ marginBottom: 18 }}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="cardHead" style={{ marginBottom: 0 }}><h3>{editing ? 'Editar borrador' : 'Preparar publicación'}</h3>{editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setForm(emptyForm) }}>Cancelar edición</button>}</div>
        <div className="field-row">
          <label>Proyecto
            <select value={projectId} onChange={e => setProjectId(e.target.value)} disabled={Boolean(editing)}>
              {projects.length === 0 && <option value="">Sin proyectos</option>}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Vídeo
            <select value={form.videoAssetId} onChange={e => setForm({ ...form, videoAssetId: e.target.value })}>
              <option value="">— Elige un vídeo</option>
              {videos.map(v => <option key={v.id} value={v.id}>{String(v.provenance?.title ?? 'Vídeo')} · {new Date(v.created_at).toLocaleDateString()}</option>)}
            </select>
          </label>
          <label>Miniatura
            <select value={form.thumbnailAssetId} onChange={e => setForm({ ...form, thumbnailAssetId: e.target.value })}>
              <option value="">— La de YouTube</option>
              {thumbs.map(t => <option key={t.id} value={t.id}>{t.provenance?.selected ? '★ ' : ''}{String(t.provenance?.concept ?? 'Miniatura').slice(0, 50)}</option>)}
            </select>
          </label>
        </div>
        {videos.length === 0 && <p className="muted small">Este proyecto no tiene vídeos. <Link className="open" href={`/editor?project=${projectId}`}>Renderiza uno en el Editor</Link>.</p>}
        <label>Título ({form.title.length}/100)<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} maxLength={100} required /></label>
        <label>Descripción<textarea rows={5} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} maxLength={5000} placeholder="Incluye fuentes y créditos de música o material con licencia." /></label>
        <div className="field-row">
          <label>Etiquetas (separadas por comas)<input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} maxLength={500} /></label>
          <label>Privacidad
            <select value={form.privacyStatus} onChange={e => setForm({ ...form, privacyStatus: e.target.value as YouTubePayload['privacyStatus'] })}>
              {Object.entries(privacyLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Categoría
            <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}>{categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
        <div className="pageActions">
          <label className="pill"><input type="checkbox" checked={form.containsSyntheticMedia} onChange={e => setForm({ ...form, containsSyntheticMedia: e.target.checked })} /> Declarar contenido alterado o sintético (IA realista)</label>
          <label className="pill"><input type="checkbox" checked={form.madeForKids} onChange={e => setForm({ ...form, madeForKids: e.target.checked })} /> Dirigido a niños</label>
        </div>
        <div><button><Icon name="plus" size={16} />{editing ? 'Guardar borrador' : 'Preparar (sin publicar)'}</button></div>
      </form>
    </section>

    {approving && <section className="panel" style={{ marginBottom: 18, borderColor: 'var(--warn, #f5b93b)' }} aria-label="Aprobar publicación">
      <h3>Aprobar «{approving.payload.title}»</h3>
      <ul className="small" style={{ margin: '8px 0 8px 18px' }}>{riskSummary(approving).map(l => <li key={l}>{l}</li>)}</ul>
      <p className="muted small">Aprobar no publica. Después tendrás que pulsar «Publicar en YouTube». Escribe APROBAR para confirmar.</p>
      <div className="pageActions" style={{ marginTop: 8 }}>
        <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="APROBAR" aria-label="Confirmación" style={{ maxWidth: 180 }} />
        <button type="button" disabled={confirmText !== 'APROBAR' || busy === approving.id} onClick={() => void approve()}>Aprobar</button>
        <button type="button" className="ghost" onClick={() => { setApproving(null); setConfirmText('') }}>Cancelar</button>
      </div>
    </section>}

    <h3 className="sectionTitle">Trabajos del proyecto</h3>
    {jobs.length === 0 ? <p className="emptyState">Nada preparado todavía.</p> : <div className="list">{jobs.map(j => {
      const videoUrl = typeof j.result?.url === 'string' ? j.result.url : null
      return <div key={j.id} className="listItem" style={{ flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <b>{j.payload?.title || 'Sin título'}</b> <span className={j.status === 'published' ? 'pill ok' : j.status === 'approved' ? 'pill info' : 'pill'}>{statusLabels[j.status] ?? j.status}</span>
          <span className="muted small" style={{ display: 'block' }}>{privacyLabels[j.payload?.privacyStatus ?? 'private']} · {new Date(j.created_at).toLocaleString()}{j.approved_at ? ` · aprobado ${new Date(j.approved_at).toLocaleString()}` : ''}</span>
          {typeof j.result?.lastError === 'string' && <span className="error small" style={{ display: 'block' }}>Último error: {j.result.lastError}</span>}
          {videoUrl && <a className="open" href={videoUrl} target="_blank" rel="noopener noreferrer">{videoUrl}</a>}
        </div>
        <div className="pageActions">
          {['draft', 'awaiting_approval'].includes(j.status) && <>
            <button type="button" className="ghost" onClick={() => edit(j)}>Editar</button>
            <button type="button" onClick={() => { setApproving(j); setConfirmText('') }} disabled={!j.payload?.videoAssetId}>Revisar y aprobar</button>
          </>}
          {j.status === 'approved' && <button type="button" disabled={!canUpload || busy === j.id} title={canUpload ? undefined : 'Permite la subida de vídeos en Conectores'} onClick={() => void publish(j)}>{busy === j.id ? 'Subiendo…' : 'Publicar en YouTube'}</button>}
          {['draft', 'awaiting_approval', 'approved'].includes(j.status) && <button type="button" className="ghost" onClick={() => void cancel(j)}>Cancelar</button>}
        </div>
      </div>
    })}</div>}

    <div style={{ marginTop: 22 }}><ResearchCapture /></div>
  </StudioShell>
}
