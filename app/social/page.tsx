'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SocialPayload } from '@/lib/publication/social'
import type { ProjectRow } from '@/lib/types/database'

type Platform = 'instagram' | 'tiktok'
type Job = { id: string; platform: Platform; status: string; created_at: string; approved_at: string | null; payload: SocialPayload; result: Record<string, unknown> | null }
type Asset = { id: string; license_status: string; storage_path: string | null; provenance: Record<string, unknown> | null; created_at: string }
type Conn = { provider: Platform; external_account_name: string | null; scopes: string[]; status: string }
type Status = { platform: Platform; configured: boolean; env: string[] }

const names: Record<Platform, string> = { instagram: 'Instagram (Reels)', tiktok: 'TikTok' }
const statusLabels: Record<string, string> = { draft: 'Borrador', awaiting_approval: 'Pendiente de aprobación', approved: 'Aprobado · sin publicar', publishing: 'Publicando…', published: 'Publicado', failed: 'Falló', cancelled: 'Cancelado' }
const ttPrivacy = { SELF_ONLY: 'Solo yo (privado)', MUTUAL_FOLLOW_FRIENDS: 'Amigos', FOLLOWER_OF_CREATOR: 'Seguidores', PUBLIC_TO_EVERYONE: 'Público' } as const
const publishScope: Record<Platform, string> = { instagram: 'instagram_business_content_publish', tiktok: 'video.publish' }

const isMp4 = (a?: Asset) => {
  const mime = typeof a?.provenance?.mimeType === 'string' ? a.provenance.mimeType : ''
  return mime ? /mp4|quicktime/.test(mime) : !/\.webm$/i.test(a?.storage_path ?? '')
}

const emptyForm = { platform: 'instagram' as Platform, videoAssetId: '', caption: '', privacyLevel: 'SELF_ONLY' as NonNullable<SocialPayload['privacyLevel']>, shareToFeed: true, isAigc: true, disableComment: false, disableDuet: false, disableStitch: false }

export default function SocialPage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [videos, setVideos] = useState<Asset[]>([])
  const [conns, setConns] = useState<Conn[]>([])
  const [status, setStatus] = useState<Status[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [approving, setApproving] = useState<Job | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadConnections = useCallback(async () => {
    const [{ data }, s] = await Promise.all([
      supabase.from('channel_connections').select('provider,external_account_name,scopes,status').in('provider', ['instagram', 'tiktok']).eq('status', 'connected'),
      fetch('/api/social/status').then(r => r.ok ? r.json() as Promise<{ platforms: Status[] }> : { platforms: [] }).catch(() => ({ platforms: [] as Status[] })),
    ])
    setConns((data ?? []) as Conn[]); setStatus(s.platforms)
  }, [supabase])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const msg: Record<string, string> = { connected: 'conectado correctamente.', not_configured: 'no está configurado en el servidor (faltan credenciales de la app).', denied: 'conexión cancelada.', error: 'no se pudo conectar. Inténtalo de nuevo.', state: 'la sesión de conexión caducó. Vuelve a intentarlo.' }
    for (const p of ['instagram', 'tiktok'] as Platform[]) { const v = q.get(p); if (v) (v === 'connected' ? setNotice : setError)(`${names[p]}: ${msg[v] ?? v}`) }
    const wanted = q.get('project')
    void (async () => {
      const { data } = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows)
      setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
      await loadConnections()
    })()
  }, [supabase, loadConnections])

  const load = useCallback(async (pid: string) => {
    const [{ data: j, error: e }, { data: a }] = await Promise.all([
      supabase.from('publication_jobs').select('id,platform,status,created_at,approved_at,payload,result').in('platform', ['instagram', 'tiktok']).eq('project_id', pid).order('created_at', { ascending: false }),
      supabase.from('assets').select('id,license_status,storage_path,provenance,created_at').eq('project_id', pid).eq('asset_type', 'video').not('storage_path', 'is', null).order('created_at', { ascending: false }),
    ])
    if (e) setError(e.message)
    setJobs((j ?? []) as Job[]); setVideos((a ?? []) as Asset[])
  }, [supabase])
  useEffect(() => { if (projectId) { setForm(emptyForm); setEditing(null); void load(projectId) } }, [projectId, load])
  useEffect(() => { if (!editing) setForm(f => ({ ...f, videoAssetId: f.videoAssetId || videos[0]?.id || '' })) }, [videos, editing])

  const conn = (p: Platform) => conns.find(c => c.provider === p) ?? null
  const cfg = (p: Platform) => status.find(s => s.platform === p)
  const selected = useMemo(() => videos.find(v => v.id === form.videoAssetId), [videos, form.videoAssetId])
  const igFormatProblem = form.platform === 'instagram' && selected && !isMp4(selected)

  async function disconnect(p: Platform) {
    if (!window.confirm(`¿Desconectar ${names[p]}? Se borrarán las credenciales guardadas.`)) return
    setBusy(p)
    const r = await fetch(`/api/oauth/${p}/disconnect`, { method: 'POST' })
    setBusy('')
    if (!r.ok) setError('No se pudo desconectar.'); else { setNotice(`${names[p]} desconectado.`); await loadConnections() }
  }

  function payload(): SocialPayload {
    const base: SocialPayload = { videoAssetId: form.videoAssetId || undefined, caption: form.caption.trim() }
    return form.platform === 'instagram' ? { ...base, shareToFeed: form.shareToFeed }
      : { ...base, privacyLevel: form.privacyLevel, isAigc: form.isAigc, disableComment: form.disableComment, disableDuet: form.disableDuet, disableStitch: form.disableStitch }
  }

  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice('')
    if (!form.videoAssetId) { setError('Elige el vídeo. Si no hay ninguno, renderízalo en el Editor o en Repurposing.'); return }
    if (form.caption.length > 2200) { setError('El texto supera 2.200 caracteres.'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('La sesión ha caducado.'); return }
    const { error: err } = editing
      ? await supabase.from('publication_jobs').update({ payload: payload(), status: 'draft', updated_at: new Date().toISOString() }).eq('id', editing).in('status', ['draft', 'awaiting_approval'])
      : await supabase.from('publication_jobs').insert({ owner_id: user.id, project_id: projectId, platform: form.platform, status: 'draft', idempotency_key: crypto.randomUUID(), payload: payload() })
    if (err) { setError(err.message); return }
    setNotice(editing ? 'Borrador actualizado.' : `Borrador para ${names[form.platform]} preparado. No se ha enviado nada.`)
    setForm(emptyForm); setEditing(null); await load(projectId)
  }

  function edit(j: Job) {
    setEditing(j.id)
    setForm({ ...emptyForm, platform: j.platform, videoAssetId: j.payload.videoAssetId ?? '', caption: j.payload.caption ?? '', privacyLevel: j.payload.privacyLevel ?? 'SELF_ONLY', shareToFeed: j.payload.shareToFeed !== false, isAigc: j.payload.isAigc !== false, disableComment: Boolean(j.payload.disableComment), disableDuet: Boolean(j.payload.disableDuet), disableStitch: Boolean(j.payload.disableStitch) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function risks(j: Job) {
    const v = videos.find(a => a.id === j.payload.videoAssetId)
    const inputs = Array.isArray(v?.provenance?.inputs) ? v!.provenance!.inputs as Array<{ license: string }> : []
    const byLicense = inputs.reduce<Record<string, number>>((m, i) => ({ ...m, [i.license]: (m[i.license] ?? 0) + 1 }), {})
    return [
      `Cuenta: ${conn(j.platform)?.external_account_name ?? 'sin conectar'} (${names[j.platform]})`,
      j.platform === 'tiktok' ? `Privacidad: ${ttPrivacy[j.payload.privacyLevel ?? 'SELF_ONLY']}` : `Reel ${j.payload.shareToFeed === false ? 'solo en la pestaña Reels' : 'también en el feed'} (Instagram publica siempre en público)`,
      `Vídeo: ${String(v?.provenance?.title ?? j.payload.videoAssetId)} · licencia ${v?.license_status ?? '?'}${j.platform === 'instagram' && v && !isMp4(v) ? ' · ⚠ no es MP4' : ''}`,
      `Entradas: ${Object.entries(byLicense).map(([k, n]) => `${n} ${k}`).join(', ') || 'sin registro'}`,
      j.platform === 'tiktok' ? `Etiqueta de contenido IA: ${j.payload.isAigc === false ? 'no' : 'sí'}` : 'Instagram: añade en el texto si el contenido es generado con IA',
    ]
  }

  async function approve() {
    if (!approving || confirmText !== 'APROBAR') return
    setBusy(approving.id); setError('')
    try {
      const r = await fetch(`/api/publish/social/${approving.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'APROBAR', riskSummary: risks(approving).join(' · ') }) })
      const json = await r.json() as { error?: string }
      if (!r.ok) throw new Error(json.error ?? 'No se pudo aprobar.')
      setNotice('Aprobado. Todavía no se ha publicado: pulsa «Publicar» cuando quieras.')
      setApproving(null); setConfirmText(''); await load(projectId)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo aprobar.') } finally { setBusy('') }
  }

  async function publish(j: Job) {
    const where = j.platform === 'instagram' ? 'como Reel público en Instagram' : `en TikTok (${ttPrivacy[j.payload.privacyLevel ?? 'SELF_ONLY'].toLowerCase()})`
    if (!window.confirm(`Se publicará el vídeo ${where}. ¿Continuar?`)) return
    setBusy(j.id); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/publish/social/${j.id}/publish`, { method: 'POST' })
      const json = await r.json() as { url?: string; mediaId?: string; error?: string; pending?: boolean }
      if (r.status === 202 || json.pending) setNotice(json.error ?? 'Sigue procesándose. Vuelve a pulsar «Publicar» en unos minutos.')
      else if (!r.ok) throw new Error(json.error ?? 'La publicación falló.')
      else setNotice(`Publicado en ${names[j.platform]}${json.url ? `: ${json.url}` : ` (id ${json.mediaId})`}.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'La publicación falló.') } finally { setBusy(''); await load(projectId) }
  }

  async function cancel(j: Job) {
    const { error: e } = await supabase.from('publication_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', j.id).in('status', ['draft', 'awaiting_approval', 'approved'])
    if (e) setError(e.message); else await load(projectId)
  }

  return <StudioShell title="Redes sociales" eyebrow="PUBLICACIÓN">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <div className="hero"><div><small>INSTAGRAM Y TIKTOK · APIS OFICIALES</small><h2>Shorts, Reels y TikToks con aprobación</h2><p>Conecta tus cuentas con OAuth oficial, prepara borradores y publica solo tras aprobar y pulsar publicar. TikTok publica en privado (solo tú) por defecto; las apps sin auditar solo pueden publicar en privado.</p></div>
      <div className="status"><b>{jobs.filter(j => j.status === 'published').length}</b><span>publicados</span><Link className="open" href="/youtube">YouTube →</Link></div></div>

    <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 18 }}>
      {(['instagram', 'tiktok'] as Platform[]).map(p => {
        const c = conn(p); const s = cfg(p)
        return <section key={p} className="panel" aria-label={names[p]}>
          <div className="cardHead"><h3>{names[p]}</h3><span className={c ? 'pill ok' : s?.configured ? 'pill' : 'pill warn'}>{c ? 'Conectado' : s?.configured ? 'Sin conectar' : 'Preparado para integración'}</span></div>
          {c ? <>
            <p className="small">Cuenta: <b>{c.external_account_name ?? 'conectada'}</b></p>
            {!c.scopes.includes(publishScope[p]) && <p className="error small">Falta el permiso de publicación ({publishScope[p]}). Vuelve a conectar.</p>}
            <div className="pageActions"><a className="button ghost" href={`/api/oauth/${p}/start`}>Reconectar</a><button type="button" className="ghost" disabled={busy === p} onClick={() => void disconnect(p)}>Desconectar</button></div>
          </> : s?.configured ? <a className="button" href={`/api/oauth/${p}/start`}>Conectar {names[p]}</a>
            : <p className="muted small">Falta configurar en el servidor: {s?.env.join(', ') ?? '…'}. {p === 'instagram' ? 'Requiere app de Meta con «Instagram API with Instagram Login» y cuenta profesional.' : 'Requiere app de TikTok for Developers con Login Kit y Content Posting API.'}</p>}
        </section>
      })}
    </div>

    <section className="panel" style={{ marginBottom: 18 }}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="cardHead" style={{ marginBottom: 0 }}><h3>{editing ? 'Editar borrador' : 'Preparar publicación'}</h3>{editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setForm(emptyForm) }}>Cancelar edición</button>}</div>
        <div className="field-row">
          <label>Proyecto<select value={projectId} onChange={e => setProjectId(e.target.value)} disabled={Boolean(editing)}>{projects.length === 0 && <option value="">Sin proyectos</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Plataforma<select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value as Platform })} disabled={Boolean(editing)}>{(['instagram', 'tiktok'] as Platform[]).map(p => <option key={p} value={p}>{names[p]}</option>)}</select></label>
          <label>Vídeo<select value={form.videoAssetId} onChange={e => setForm({ ...form, videoAssetId: e.target.value })}><option value="">— Elige un vídeo</option>{videos.map(v => <option key={v.id} value={v.id}>{String(v.provenance?.title ?? 'Vídeo')}{isMp4(v) ? '' : ' (WebM)'} · {new Date(v.created_at).toLocaleDateString()}</option>)}</select></label>
        </div>
        {videos.length === 0 && <p className="muted small">Este proyecto no tiene vídeos. <Link className="open" href={`/repurpose?project=${projectId}`}>Crea un vertical en Repurposing</Link>.</p>}
        {igFormatProblem && <p className="error small">Instagram solo acepta MP4/MOV. Este vídeo es WebM (render del navegador): usa un vídeo MP4 (por ejemplo generado con IA o subido) o publícalo en TikTok.</p>}
        <label>Texto / título ({form.caption.length}/2200)<textarea rows={4} value={form.caption} onChange={e => setForm({ ...form, caption: e.target.value })} maxLength={2200} placeholder="Descripción, hashtags y créditos de música o material con licencia." /></label>
        {form.platform === 'tiktok' ? <div className="pageActions">
          <label>Privacidad<select value={form.privacyLevel} onChange={e => setForm({ ...form, privacyLevel: e.target.value as typeof form.privacyLevel })}>{Object.entries(ttPrivacy).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="pill"><input type="checkbox" checked={form.isAigc} onChange={e => setForm({ ...form, isAigc: e.target.checked })} /> Etiquetar como contenido generado con IA</label>
          <label className="pill"><input type="checkbox" checked={form.disableComment} onChange={e => setForm({ ...form, disableComment: e.target.checked })} /> Sin comentarios</label>
          <label className="pill"><input type="checkbox" checked={form.disableDuet} onChange={e => setForm({ ...form, disableDuet: e.target.checked })} /> Sin dúos</label>
          <label className="pill"><input type="checkbox" checked={form.disableStitch} onChange={e => setForm({ ...form, disableStitch: e.target.checked })} /> Sin stitch</label>
        </div> : <div className="pageActions"><label className="pill"><input type="checkbox" checked={form.shareToFeed} onChange={e => setForm({ ...form, shareToFeed: e.target.checked })} /> Mostrar también en el feed del perfil</label></div>}
        <div><button><Icon name="plus" size={16} />{editing ? 'Guardar borrador' : 'Preparar (sin publicar)'}</button></div>
      </form>
    </section>

    {approving && <section className="panel" style={{ marginBottom: 18, borderColor: 'var(--warn, #f5b93b)' }} aria-label="Aprobar publicación">
      <h3>Aprobar publicación en {names[approving.platform]}</h3>
      <ul className="small" style={{ margin: '8px 0 8px 18px' }}>{risks(approving).map(l => <li key={l}>{l}</li>)}</ul>
      <p className="muted small">Aprobar no publica. Después tendrás que pulsar «Publicar». Escribe APROBAR para confirmar.</p>
      <div className="pageActions" style={{ marginTop: 8 }}>
        <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="APROBAR" aria-label="Confirmación" style={{ maxWidth: 180 }} />
        <button type="button" disabled={confirmText !== 'APROBAR' || busy === approving.id} onClick={() => void approve()}>Aprobar</button>
        <button type="button" className="ghost" onClick={() => { setApproving(null); setConfirmText('') }}>Cancelar</button>
      </div>
    </section>}

    <h3 className="sectionTitle">Trabajos del proyecto</h3>
    {jobs.length === 0 ? <p className="emptyState">Nada preparado todavía.</p> : <div className="list">{jobs.map(j => {
      const c = conn(j.platform); const canPublish = Boolean(c?.scopes.includes(publishScope[j.platform]))
      const url = typeof j.result?.url === 'string' && j.result.url ? j.result.url : null
      return <div key={j.id} className="listItem" style={{ flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <b>{names[j.platform]}</b> <span className={j.status === 'published' ? 'pill ok' : j.status === 'approved' ? 'pill info' : 'pill'}>{statusLabels[j.status] ?? j.status}</span>
          <span className="muted small" style={{ display: 'block' }}>{(j.payload.caption || 'Sin texto').slice(0, 90)} · {new Date(j.created_at).toLocaleString()}</span>
          {typeof j.result?.containerId === 'string' && j.status !== 'published' && <span className="muted small" style={{ display: 'block' }}>Instagram está procesando el vídeo; al pulsar «Publicar» se reanuda.</span>}
          {typeof j.result?.lastError === 'string' && <span className="error small" style={{ display: 'block' }}>Último error: {j.result.lastError}</span>}
          {url && <a className="open" href={url} target="_blank" rel="noopener noreferrer">{url}</a>}
        </div>
        <div className="pageActions">
          {['draft', 'awaiting_approval'].includes(j.status) && <><button type="button" className="ghost" onClick={() => edit(j)}>Editar</button><button type="button" onClick={() => { setApproving(j); setConfirmText('') }} disabled={!j.payload.videoAssetId}>Revisar y aprobar</button></>}
          {j.status === 'approved' && <button type="button" disabled={!canPublish || busy === j.id} title={canPublish ? undefined : 'Conecta la cuenta con permiso de publicación'} onClick={() => void publish(j)}>{busy === j.id ? 'Publicando…' : 'Publicar'}</button>}
          {['draft', 'awaiting_approval', 'approved'].includes(j.status) && <button type="button" className="ghost" onClick={() => void cancel(j)}>Cancelar</button>}
        </div>
      </div>
    })}</div>}
  </StudioShell>
}
