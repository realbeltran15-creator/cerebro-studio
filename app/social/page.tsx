'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { instagramReadiness } from '@/lib/editor/container'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SocialPayload } from '@/lib/publication/social'
import type { ProjectRow } from '@/lib/types/database'

type Platform = 'instagram' | 'tiktok'
type Job = { id: string; platform: Platform; status: string; created_at: string; approved_at: string | null; payload: SocialPayload; result: Record<string, unknown> | null }
type Asset = { id: string; license_status: string; storage_path: string | null; provenance: Record<string, unknown> | null; created_at: string }
type Conn = { provider: Platform; external_account_id: string; external_account_name: string | null; scopes: string[]; status: string }
type Creator = { nickname: string | null; username: string | null; privacyOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxDurationSec: number | null; accountId?: string; error?: string }
type Status = { platform: Platform; configured: boolean; env: string[] }

const names: Record<Platform, string> = { instagram: 'Instagram (Reels)', tiktok: 'TikTok' }
const statusLabels: Record<string, string> = { draft: 'Borrador', awaiting_approval: 'Pendiente de aprobación', approved: 'Aprobado · sin publicar', publishing: 'Publicando…', published: 'Publicado', failed: 'Falló', cancelled: 'Cancelado' }
const ttPrivacy = { SELF_ONLY: 'Solo yo (privado)', MUTUAL_FOLLOW_FRIENDS: 'Amigos', FOLLOWER_OF_CREATOR: 'Seguidores', PUBLIC_TO_EVERYONE: 'Público' } as const
const publishScope: Record<Platform, string> = { instagram: 'instagram_business_content_publish', tiktok: 'video.publish' }

const mimeOf = (a?: Asset) => {
  const mime = typeof a?.provenance?.mimeType === 'string' ? a.provenance.mimeType : ''
  return mime || (/\.webm$/i.test(a?.storage_path ?? '') ? 'video/webm' : 'video/mp4')
}
const isMp4 = (a?: Asset) => /^video\/(mp4|quicktime)/i.test(mimeOf(a))

// TikTok Content Sharing Guidelines: no default privacy, interactions OFF by default, commercial disclosure OFF by default.
const emptyForm = { platform: 'instagram' as Platform, videoAssetId: '', caption: '', privacyLevel: '' as SocialPayload['privacyLevel'] | '', shareToFeed: true, isAigc: true, allowComment: false, allowDuet: false, allowStitch: false, commercial: false, brandOrganic: false, brandContent: false }

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
  const [creator, setCreator] = useState<Creator | null>(null)

  const loadConnections = useCallback(async () => {
    const [{ data }, s] = await Promise.all([
      supabase.from('channel_connections').select('provider,external_account_id,external_account_name,scopes,status').in('provider', ['instagram', 'tiktok']).eq('status', 'connected'),
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
  // TikTok requires reading the creator's latest info whenever the post form is shown (nickname, privacy options, interactions, length).
  const ttConnected = conns.some(c => c.provider === 'tiktok')
  useEffect(() => {
    if (form.platform !== 'tiktok' || !ttConnected) return
    let off = false
    void fetch('/api/social/tiktok/creator', { cache: 'no-store' }).then(r => r.json() as Promise<Creator>).then(c => { if (!off) setCreator(c) }).catch(() => { if (!off) setCreator({ nickname: null, username: null, privacyOptions: [], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxDurationSec: null, error: 'No se pudo leer tu cuenta de TikTok.' }) })
    return () => { off = true }
  }, [form.platform, ttConnected])

  const conn = (p: Platform) => conns.find(c => c.provider === p) ?? null
  const cfg = (p: Platform) => status.find(s => s.platform === p)
  const selected = useMemo(() => videos.find(v => v.id === form.videoAssetId), [videos, form.videoAssetId])
  const igReady = form.platform === 'instagram' && selected ? instagramReadiness(mimeOf(selected)) : null
  const igFormatProblem = Boolean(igReady && !igReady.ok)

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
      : { ...base, privacyLevel: form.privacyLevel || undefined, isAigc: form.isAigc, disableComment: !form.allowComment, disableDuet: !form.allowDuet, disableStitch: !form.allowStitch, brandOrganic: form.commercial && form.brandOrganic, brandContent: form.commercial && form.brandContent }
  }

  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice('')
    if (!form.videoAssetId) { setError('Elige el vídeo. Si no hay ninguno, renderízalo en el Editor o en Repurposing.'); return }
    if (form.caption.length > 2200) { setError('El texto supera 2.200 caracteres.'); return }
    if (form.platform === 'tiktok') {
      if (!form.privacyLevel) { setError('Elige quién puede ver el vídeo en TikTok.'); return }
      if (form.commercial && !form.brandOrganic && !form.brandContent) { setError('Indica si promocionas tu marca, contenido de marca o ambos (o desactiva la divulgación comercial).'); return }
      if (form.commercial && form.brandContent && form.privacyLevel === 'SELF_ONLY') { setError('El contenido de marca no puede ser privado en TikTok.'); return }
    }
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
    setForm({ ...emptyForm, platform: j.platform, videoAssetId: j.payload.videoAssetId ?? '', caption: j.payload.caption ?? '', privacyLevel: j.payload.privacyLevel ?? '', shareToFeed: j.payload.shareToFeed !== false, isAigc: j.payload.isAigc !== false, allowComment: j.payload.disableComment === false, allowDuet: j.payload.disableDuet === false, allowStitch: j.payload.disableStitch === false, commercial: Boolean(j.payload.brandOrganic || j.payload.brandContent), brandOrganic: Boolean(j.payload.brandOrganic), brandContent: Boolean(j.payload.brandContent) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function risks(j: Job) {
    const v = videos.find(a => a.id === j.payload.videoAssetId)
    const inputs = Array.isArray(v?.provenance?.inputs) ? v!.provenance!.inputs as Array<{ license: string }> : []
    const byLicense = inputs.reduce<Record<string, number>>((m, i) => ({ ...m, [i.license]: (m[i.license] ?? 0) + 1 }), {})
    return [
      `Cuenta: ${conn(j.platform) ? `${conn(j.platform)!.external_account_name ?? 'sin nombre'} (ID ${conn(j.platform)!.external_account_id})` : 'sin conectar'} (${names[j.platform]})`,
      j.platform === 'tiktok' ? `Privacidad: ${j.payload.privacyLevel ? ttPrivacy[j.payload.privacyLevel] : 'sin elegir'}${j.payload.brandContent ? ' · contenido de marca' : ''}${j.payload.brandOrganic ? ' · tu marca' : ''}` : `Reel ${j.payload.shareToFeed === false ? 'solo en la pestaña Reels' : 'también en el feed'} (Instagram publica siempre en público)`,
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
    const c = conn(j.platform)
    if (!c) { setError(`Conecta tu cuenta de ${names[j.platform]}.`); return }
    const where = j.platform === 'instagram' ? 'como Reel público en Instagram' : `en TikTok (${j.payload.privacyLevel ? ttPrivacy[j.payload.privacyLevel].toLowerCase() : 'sin privacidad elegida'})`
    // The destination is confirmed by name AND ID on every publication; the server refuses if another account is connected.
    if (!window.confirm(`Se publicará el vídeo ${where} en la cuenta:\n\n${c.external_account_name ?? 'sin nombre'}\nID: ${c.external_account_id}\n\n${j.platform === 'tiktok' ? 'Al publicar, aceptas la Confirmación de uso de música de TikTok.\n\n' : ''}¿Es la cuenta correcta?`)) return
    setBusy(j.id); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/publish/social/${j.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: c.external_account_id }) })
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
            <p className="small">Cuenta: <b>{c.external_account_name ?? 'conectada'}</b><br /><span className="muted">ID: <code>{c.external_account_id}</code></span></p>
            {!c.scopes.includes(publishScope[p]) && <p className="error small">Falta el permiso de publicación ({publishScope[p]}). Vuelve a conectar.</p>}
            <div className="pageActions"><a className="button ghost" href={`/api/oauth/${p}/start`}>Cambiar de cuenta</a><button type="button" className="ghost" disabled={busy === p} onClick={() => void disconnect(p)}>Desconectar</button></div>
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
          <label>Vídeo<select value={form.videoAssetId} onChange={e => setForm({ ...form, videoAssetId: e.target.value })}><option value="">— Elige un vídeo</option>{videos.map(v => <option key={v.id} value={v.id}>{String(v.provenance?.title ?? 'Vídeo')}{!isMp4(v) ? ' (WebM)' : form.platform === 'instagram' && !instagramReadiness(mimeOf(v)).ok ? ' (códec no válido para Instagram)' : ''} · {new Date(v.created_at).toLocaleDateString()}</option>)}</select></label>
        </div>
        {videos.length === 0 && <p className="muted small">Este proyecto no tiene vídeos. <Link className="open" href={`/repurpose?project=${projectId}`}>Crea un vertical en Repurposing</Link>.</p>}
        {igFormatProblem && <p className="error small" role="alert">{igReady?.reason} También puedes publicarlo en TikTok.</p>}
        {igReady?.ok && igReady.unknown && <p className="warnBox small">No se registró el códec de este MP4. Instagram necesita H.264 o HEVC con audio AAC; si lo rechaza, vuelve a renderizarlo en Chrome, Edge o Safari.</p>}
        <label>Texto / título ({form.caption.length}/2200)<textarea rows={4} value={form.caption} onChange={e => setForm({ ...form, caption: e.target.value })} maxLength={2200} placeholder="Descripción, hashtags y créditos de música o material con licencia." /></label>
        {form.platform === 'tiktok' ? <div role="group" aria-label="Opciones de TikTok" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {creator?.error ? <p className="error small">{creator.error}</p> : creator ? <p className="small">Publicarás como <b>{creator.nickname ?? creator.username ?? 'tu cuenta'}</b>{creator.maxDurationSec ? ` · duración máxima ${creator.maxDurationSec} s` : ''}</p> : conn('tiktok') ? <p className="muted small">Leyendo tu cuenta de TikTok…</p> : <p className="muted small">Conecta TikTok para ver tus opciones de publicación.</p>}
          <label>¿Quién puede ver este vídeo?<select value={form.privacyLevel} onChange={e => setForm({ ...form, privacyLevel: e.target.value as typeof form.privacyLevel })} required>
            <option value="" disabled>— Elige una opción</option>
            {(creator?.privacyOptions?.length ? creator.privacyOptions : []).filter((v): v is keyof typeof ttPrivacy => v in ttPrivacy).map(v => <option key={v} value={v} disabled={form.commercial && form.brandContent && v === 'SELF_ONLY'}>{ttPrivacy[v]}</option>)}
          </select></label>
          <div className="pageActions">
            <label className="pill"><input type="checkbox" checked={form.allowComment && !creator?.commentDisabled} disabled={Boolean(creator?.commentDisabled)} onChange={e => setForm({ ...form, allowComment: e.target.checked })} /> Permitir comentarios</label>
            <label className="pill"><input type="checkbox" checked={form.allowDuet && !creator?.duetDisabled} disabled={Boolean(creator?.duetDisabled)} onChange={e => setForm({ ...form, allowDuet: e.target.checked })} /> Permitir dúos</label>
            <label className="pill"><input type="checkbox" checked={form.allowStitch && !creator?.stitchDisabled} disabled={Boolean(creator?.stitchDisabled)} onChange={e => setForm({ ...form, allowStitch: e.target.checked })} /> Permitir stitch</label>
            <label className="pill"><input type="checkbox" checked={form.isAigc} onChange={e => setForm({ ...form, isAigc: e.target.checked })} /> Etiquetar como contenido generado con IA</label>
          </div>
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={form.commercial} onChange={e => setForm({ ...form, commercial: e.target.checked, brandOrganic: e.target.checked && form.brandOrganic, brandContent: e.target.checked && form.brandContent })} /> Divulgar contenido comercial</label>
          {form.commercial && <div className="pageActions">
            <label className="pill"><input type="checkbox" checked={form.brandOrganic} onChange={e => setForm({ ...form, brandOrganic: e.target.checked })} /> Tu marca</label>
            <label className="pill"><input type="checkbox" checked={form.brandContent} onChange={e => setForm({ ...form, brandContent: e.target.checked, privacyLevel: e.target.checked && form.privacyLevel === 'SELF_ONLY' ? '' : form.privacyLevel })} /> Contenido de marca</label>
            <span className="muted small">{form.brandContent ? 'Se etiquetará como «Colaboración pagada».' : form.brandOrganic ? 'Se etiquetará como «Contenido promocional».' : 'Elige al menos una opción.'}</span>
          </div>}
          <p className="muted small">Al publicar, aceptas la Confirmación de uso de música de TikTok{form.commercial && form.brandContent ? ' y la Política de contenido de marca' : ''}.</p>
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
