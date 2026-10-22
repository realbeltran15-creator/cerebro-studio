'use client'

import Link from 'next/link'
import { manualEditorHref } from '@/lib/editor/from-assets'
import { useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { modelById } from '@/lib/providers/catalog'
import { tierLabels, type CostTier } from '@/lib/providers/directory'
import { deletionCheck, describeAsset, downloadText, LIBRARY_PAGE, originOf, type AssetReferences, type LibraryAsset } from '@/lib/library'
import { addTag, allTags, autoTags, createCollection, deleteCollection, EMPTY_ORG, forgetAsset, loadOrg, relatedAssets, removeTag, saveOrg, toggleInCollection, type LibraryOrg } from '@/lib/library-org'
import { deleteAsset, uploadKindFor, uploadProjectMedia, validateUpload, type LicenseStatus, type UploadKind } from '@/lib/media-upload'

type Project = { id: string; name: string }
type Scene = { id: string; position: number }

const typeLabels: Record<string, string> = { image: 'Imagen', thumbnail: 'Miniatura', video: 'Vídeo', voice: 'Voz', music: 'Música', sfx: 'Efecto / ambiente', subtitle: 'Subtítulos', audio: 'Audio', other: 'Otro' }
const originLabels = { generated: 'Generado con IA', imported: 'Banco gratuito', uploaded: 'Subido', render: 'Montaje / render' } as const
const licenseLabels: Record<string, string> = { owned: 'Propio', licensed: 'Con licencia', public_domain: 'Dominio público', generated: 'Generado', unknown: 'Sin verificar', restricted: 'Restringido' }

export default function LibraryPage() {
  const supabase = getSupabaseBrowserClient()
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [type, setType] = useState('')
  const [origin, setOrigin] = useState('')
  const [projectId, setProjectId] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<LibraryAsset | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')

  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Tags and collections (one settings row per owner; see lib/library-org.ts).
  const [org, setOrg] = useState<LibraryOrg>(EMPTY_ORG)
  const [orgState, setOrgState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [tagFilter, setTagFilter] = useState('')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [newTag, setNewTag] = useState('')
  const [newCollection, setNewCollection] = useState('')
  useEffect(() => { void loadOrg(supabase).then(setOrg).catch(() => setOrgState('error')) }, [supabase])
  async function changeOrg(next: LibraryOrg) {
    const prev = org
    setOrg(next); setOrgState('saving')
    try { await saveOrg(supabase, next); setOrgState('idle') } catch (e) { setOrg(prev); setOrgState('error'); setError(e instanceof Error ? `No se pudo guardar la organización: ${e.message}` : 'No se pudo guardar la organización.') }
  }
  const COLS = 'id,asset_type,project_id,storage_path,source_provider,source_url,license_status,provenance,created_at'
  useEffect(() => {
    void (async () => {
      const [a, p, s] = await Promise.all([
        supabase.from('assets').select(COLS).order('created_at', { ascending: false }).range(0, LIBRARY_PAGE - 1),
        supabase.from('projects').select('id,name'),
        supabase.from('scenes').select('id,position'),
      ])
      if (a.error) setError(a.error.message); else { setAssets((a.data ?? []) as LibraryAsset[]); setHasMore((a.data ?? []).length === LIBRARY_PAGE) }
      setProjects((p.data ?? []) as Project[]); setScenes((s.data ?? []) as Scene[])
    })()
  }, [supabase])
  async function loadMore() {
    setLoadingMore(true)
    const { data, error: e } = await supabase.from('assets').select(COLS).order('created_at', { ascending: false }).range(assets.length, assets.length + LIBRARY_PAGE - 1)
    setLoadingMore(false)
    if (e) { setError(e.message); return }
    const rows = (data ?? []) as LibraryAsset[]
    setAssets(list => [...list, ...rows.filter(r => !list.some(x => x.id === r.id))]); setHasMore(rows.length === LIBRARY_PAGE)
  }

  // ---------- Upload ----------
  const [uploading, setUploading] = useState(false)
  const [upFile, setUpFile] = useState<File | null>(null)
  const [upKind, setUpKind] = useState<UploadKind>('image')
  const [upProject, setUpProject] = useState('')
  const [upTitle, setUpTitle] = useState('')
  const [upLicense, setUpLicense] = useState<LicenseStatus>('owned')
  const [upProgress, setUpProgress] = useState<number | null>(null)
  function pickFile(f: File | null) {
    setUpFile(f); setError('')
    if (!f) return
    const k = uploadKindFor(f)
    if (!k) { setError(`Formato no admitido (${f.type || 'desconocido'}).`); setUpFile(null); return }
    setUpKind(k); setUpTitle(t => t || f.name.replace(/\.[^.]+$/, ''))
  }
  async function upload() {
    if (!upFile || !upProject) { setError('Elige un archivo y el proyecto al que pertenece.'); return }
    const problem = validateUpload(upKind, upFile)
    if (problem) { setError(problem); return }
    setBusy('upload'); setError(''); setNotice(''); setUpProgress(0)
    try {
      const { id } = await uploadProjectMedia(supabase, { projectId: upProject, kind: upKind, file: upFile, title: upTitle, license: upLicense, onProgress: f => setUpProgress(f) })
      const { data } = await supabase.from('assets').select(COLS).eq('id', id).maybeSingle()
      if (data) { setAssets(list => [data as LibraryAsset, ...list]); setSelected(data as LibraryAsset) }
      setNotice('Archivo subido a la Biblioteca.'); setUpFile(null); setUpTitle(''); setUploading(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo subir el archivo.') }
    finally { setBusy(''); setUpProgress(null) }
  }

  // ---------- Safe deletion ----------
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; check: ReturnType<typeof deletionCheck> } | null>(null)
  async function referencesOf(a: LibraryAsset): Promise<AssetReferences> {
    const [pubs, renders] = await Promise.all([
      supabase.from('publication_jobs').select('id,platform,status,payload').limit(500),
      supabase.from('render_jobs').select('id').eq('output_asset_id', a.id).limit(20),
    ])
    if (pubs.error) throw new Error(pubs.error.message)
    const publications = ((pubs.data ?? []) as Array<{ id: string; platform: string; status: string; payload: Record<string, unknown> | null }>)
      .filter(j => j.payload?.videoAssetId === a.id || j.payload?.thumbnailAssetId === a.id).map(({ id, platform, status }) => ({ id, platform, status }))
    const derived = assets.filter(x => x.provenance?.sourceAssetId === a.id || (Array.isArray(x.provenance?.inputs) && (x.provenance.inputs as Array<{ id?: string }>).some(i => i.id === a.id)))
    return { publications, renders: renders.error ? [] : ((renders.data ?? []) as Array<{ id: string }>), derived: derived.map(d => ({ id: d.id, asset_type: d.asset_type })) }
  }
  async function askDelete(a: LibraryAsset) {
    setError(''); setNotice('')
    try { setConfirmDelete({ id: a.id, check: deletionCheck(await referencesOf(a)) }) }
    catch (e) { setError(`No se pudo comprobar si el archivo está en uso: ${e instanceof Error ? e.message : 'error'}. No se ha borrado nada.`) }
  }
  async function doDelete(a: LibraryAsset) {
    setBusy(a.id)
    try {
      // Re-checked right before deleting: a publication may have been created in the meantime.
      const check = deletionCheck(await referencesOf(a))
      if (!check.allowed) { setConfirmDelete({ id: a.id, check }); return }
      await deleteAsset(supabase, a)
      setAssets(list => list.filter(x => x.id !== a.id)); setSelected(null); setConfirmDelete(null); setNotice('Archivo borrado.')
      if (org.tags[a.id] || org.collections.some(c => c.assetIds.includes(a.id))) void changeOrg(forgetAsset(org, a.id))
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo borrar.') }
    finally { setBusy('') }
  }

  async function url(id: string) {
    if (urls[id]) return urls[id]
    const r = await fetch(`/api/assets/${id}/signed-url`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({})) as { url?: string; error?: string }
    if (!r.ok || !j.url) { setError(j.error ?? 'No se pudo abrir el archivo.'); return '' }
    setUrls(u => ({ ...u, [id]: j.url! }))
    return j.url
  }

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    const inCollection = collectionFilter ? new Set(org.collections.find(c => c.id === collectionFilter)?.assetIds ?? []) : null
    return assets.filter(a => (!type || a.asset_type === type) && (!origin || originOf(a) === origin) && (!projectId || a.project_id === projectId)
      && (!tagFilter || (org.tags[a.id] ?? []).includes(tagFilter) || autoTags(a).includes(tagFilter))
      && (!inCollection || inCollection.has(a.id))
      && (!term || JSON.stringify(a.provenance ?? {}).toLowerCase().includes(term) || (org.tags[a.id] ?? []).some(t => t.includes(term)) || autoTags(a).some(t => t.includes(term))))
  }, [assets, type, origin, projectId, q, tagFilter, collectionFilter, org])
  const tagOptions = useMemo(() => [...new Set([...allTags(org), ...assets.flatMap(autoTags)])].sort((a, b) => a.localeCompare(b, 'es')), [org, assets])
  useEffect(() => { visible.slice(0, 24).filter(a => a.asset_type === 'image' || a.asset_type === 'thumbnail').forEach(a => { if (!urls[a.id]) void url(a.id) }) }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  async function transcribeAsset(a: LibraryAsset) {
    setBusy(a.id); setError(''); setNotice('')
    const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: a.id, language: 'es' }) })
    const j = await r.json().catch(() => ({})) as { asset?: LibraryAsset; duplicate?: boolean; error?: string; attempts?: string[] }
    setBusy('')
    if (!r.ok || !j.asset) { setError(`${j.error ?? 'No se pudo transcribir.'}${j.attempts?.length ? ` (${j.attempts.join(' · ')})` : ''}`); return }
    setNotice(j.duplicate ? 'Este archivo ya tenía subtítulos.' : 'Subtítulos creados y guardados en la Biblioteca.')
    const { data } = await supabase.from('assets').select(COLS).eq('id', j.asset.id).maybeSingle()
    if (data) { setAssets(list => list.some(x => x.id === data.id) ? list : [data as LibraryAsset, ...list]); setSelected(data as LibraryAsset) }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice('Copiado.') } catch { setNotice('No se pudo copiar; selecciona el texto manualmente.') }
  }

  const kinds = [...new Set(assets.map(a => a.asset_type))]
  const subtitleOf = (id: string) => assets.find(x => x.asset_type === 'subtitle' && x.provenance?.sourceAssetId === id)
  const d = selected ? describeAsset(selected) : null
  const related = selected ? relatedAssets(selected, assets) : { madeFrom: [], derived: [] }
  const usedIn = related.derived
  const madeFrom = related.madeFrom

  function preview(a: LibraryAsset, large: boolean) {
    const u = urls[a.id]
    if (a.asset_type === 'image' || a.asset_type === 'thumbnail') return u ? <img src={u} alt={describeAsset(a).title} /> : <div className="mediaEmpty"><Icon name="image" size={large ? 36 : 20} /></div>
    if (!large || !u) return <div className="mediaEmpty"><Icon name={a.asset_type === 'video' ? 'video' : a.asset_type === 'voice' ? 'mic' : a.asset_type === 'subtitle' ? 'script' : 'music'} size={large ? 36 : 20} /></div>
    if (a.asset_type === 'subtitle') return <div className="mediaEmpty"><Icon name="script" size={36} /></div>
    if (a.asset_type === 'video') return <video src={u} controls playsInline />
    return <div className="audioStage"><Icon name="music" size={36} /><audio src={u} controls /></div>
  }

  return (
    <StudioShell title="Biblioteca" eyebrow="ASSETS" actions={<><button type="button" className="small" onClick={() => setUploading(u => !u)}><Icon name="upload" size={14} />Subir archivo</button><Link className="buttonLink" href="/add">Añadir materiales (móvil, Drive, iPhone)</Link><Link className="buttonLink ghost" href="/usage">Costes y créditos</Link></>}>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {uploading && (
        <section className="panel" aria-label="Subir archivo" style={{ marginBottom: 14 }}>
          <div className="field-row">
            <label htmlFor="up-file">Archivo<input id="up-file" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/*" onChange={e => pickFile(e.target.files?.[0] ?? null)} /></label>
            <label htmlFor="up-kind">Tipo<select id="up-kind" value={upKind} onChange={e => setUpKind(e.target.value as UploadKind)}>{(['image', 'video', 'voice', 'music', 'sfx'] as UploadKind[]).map(k => <option key={k} value={k}>{typeLabels[k]}</option>)}</select></label>
            <label htmlFor="up-project">Proyecto<select id="up-project" value={upProject} onChange={e => setUpProject(e.target.value)}><option value="">Elige…</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label htmlFor="up-title">Título<input id="up-title" value={upTitle} onChange={e => setUpTitle(e.target.value)} maxLength={160} /></label>
            <label htmlFor="up-license">Licencia<select id="up-license" value={upLicense} onChange={e => setUpLicense(e.target.value as LicenseStatus)}><option value="owned">Propio</option><option value="licensed">Con licencia</option><option value="public_domain">Dominio público</option><option value="restricted">Restringido (no se podrá publicar)</option></select></label>
          </div>
          <p className="muted small">Imágenes hasta 25 MB, vídeo hasta 50 MB, audio hasta 50 MB. Se guarda en tu almacenamiento privado con su licencia.</p>
          <div className="pageActions">
            <button type="button" disabled={!upFile || !upProject || busy === 'upload'} onClick={() => void upload()}>{busy === 'upload' ? `Subiendo… ${Math.round((upProgress ?? 0) * 100)} %` : 'Subir'}</button>
            <button type="button" className="ghost" onClick={() => { setUploading(false); setUpFile(null) }}>Cancelar</button>
          </div>
        </section>
      )}
      <div className="field-row" style={{ marginBottom: 14 }}>
        <label htmlFor="lib-q">Buscar<input id="lib-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Prompt, autor, modelo, licencia…" /></label>
        <label htmlFor="lib-type">Tipo<select id="lib-type" value={type} onChange={e => setType(e.target.value)}><option value="">Todos</option>{kinds.map(k => <option key={k} value={k}>{typeLabels[k] ?? k}</option>)}</select></label>
        <label htmlFor="lib-origin">Origen<select id="lib-origin" value={origin} onChange={e => setOrigin(e.target.value)}><option value="">Todos</option>{Object.entries(originLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label htmlFor="lib-project">Proyecto<select id="lib-project" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">Todos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label htmlFor="lib-tag">Etiqueta<select id="lib-tag" value={tagFilter} onChange={e => setTagFilter(e.target.value)}><option value="">Todas</option>{tagOptions.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
        <label htmlFor="lib-collection">Colección<select id="lib-collection" value={collectionFilter} onChange={e => setCollectionFilter(e.target.value)}><option value="">Todas</option>{org.collections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.assetIds.length})</option>)}</select></label>
      </div>
      <form className="pageActions" style={{ marginBottom: 10 }} onSubmit={e => { e.preventDefault(); const id = crypto.randomUUID(); const next = createCollection(org, newCollection, id); if (next !== org) { void changeOrg(next); setCollectionFilter(id) } setNewCollection('') }}>
        <input aria-label="Nueva colección" placeholder="Nueva colección (p. ej. «Intro lofi»)" value={newCollection} onChange={e => setNewCollection(e.target.value)} maxLength={80} style={{ maxWidth: 280 }} />
        <button type="submit" className="ghost small" disabled={!newCollection.trim()}>Crear colección</button>
        {collectionFilter && <button type="button" className="ghost small danger" onClick={() => { if (window.confirm('¿Borrar esta colección? Los archivos no se borran.')) { void changeOrg(deleteCollection(org, collectionFilter)); setCollectionFilter('') } }}>Borrar colección</button>}
        {orgState === 'saving' && <span className="muted small">Guardando…</span>}
      </form>
      <p className="muted small" style={{ marginBottom: 10 }}>{visible.length} de {assets.length}{hasMore ? '+' : ''} archivos cargados. Pulsa uno para ver cómo se creó.{hasMore && <> <button type="button" className="linkish" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Cargando…' : 'Cargar más'}</button></>}</p>

      <div className="libLayout">
        <div className="thumbGrid">
          {visible.map(a => {
            const info = describeAsset(a)
            return (
              <button key={a.id} type="button" className={selected?.id === a.id ? 'thumb active' : 'thumb'} onClick={() => { setSelected(a); void url(a.id) }} title={info.title}>
                {preview(a, false)}
                <span><b>{typeLabels[a.asset_type] ?? a.asset_type}</b> · {originLabels[originOf(a)]}<br />{info.title.slice(0, 48)}{(org.tags[a.id] ?? []).length > 0 && <><br /><small className="muted">#{(org.tags[a.id] ?? []).slice(0, 3).join(' #')}</small></>}</span>
              </button>
            )
          })}
          {visible.length === 0 && <p className="emptyState">No hay archivos con estos filtros.</p>}
        </div>

        {selected && d && (
          <aside className="panel libDetail" aria-label="Procedencia del archivo">
            <div className="cardHead"><h2 className="panelTitle">{d.title.slice(0, 80)}</h2><button type="button" className="iconButton" aria-label="Cerrar" onClick={() => setSelected(null)}>✕</button></div>
            <div className="stage">{preview(selected, true)}</div>
            <dl className="provList">
              <dt>Tipo</dt><dd>{typeLabels[selected.asset_type] ?? selected.asset_type} · {originLabels[originOf(selected)]}</dd>
              <dt>Fecha</dt><dd>{new Date(selected.created_at).toLocaleString()}</dd>
              <dt>Proyecto</dt><dd>{selected.project_id ? <Link className="open" href={`/projects/${selected.project_id}`}>{projects.find(p => p.id === selected.project_id)?.name ?? '—'}</Link> : '—'}</dd>
              {d.sceneId && <><dt>Escena</dt><dd>Escena {scenes.find(s => s.id === d.sceneId)?.position ?? '—'}</dd></>}
              <dt>Proveedor</dt><dd>{d.provider}</dd>
              {d.model && <><dt>Modelo</dt><dd>{modelById(d.model)?.label ?? d.model}</dd></>}
              {d.tier && <><dt>Coste</dt><dd><span className={`tierBadge tier-${d.tier}`}>{tierLabels[d.tier as CostTier] ?? d.tier}</span> {d.cost}</dd></>}
              {d.prompt && <><dt>Prompt</dt><dd className="pre">{d.prompt}</dd></>}
              {d.finalPrompt && d.finalPrompt !== d.prompt && <><dt>Prompt enviado</dt><dd className="pre small">{d.finalPrompt}</dd></>}
              {d.params && <><dt>Parámetros</dt><dd className="small">{d.params}</dd></>}
              <dt>Licencia</dt><dd>{licenseLabels[selected.license_status] ?? selected.license_status}{d.license ? ` · ${d.license}` : ''}</dd>
              {d.attribution && <><dt>Atribución</dt><dd>{d.attribution}</dd></>}
              {d.sourceUrl && <><dt>Original</dt><dd><a className="open" href={d.sourceUrl} target="_blank" rel="noopener noreferrer">Ver fuente ↗</a></dd></>}
              <dt>Etiquetas</dt><dd>
                <span className="muted small">{autoTags(selected).join(' · ')}</span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>{(org.tags[selected.id] ?? []).map(t => <button key={t} type="button" className="pill" aria-label={`Quitar etiqueta ${t}`} onClick={() => void changeOrg(removeTag(org, selected.id, t))}>#{t} ✕</button>)}</span>
                <form style={{ display: 'flex', gap: 6, marginTop: 6 }} onSubmit={e => { e.preventDefault(); if (newTag.trim()) void changeOrg(addTag(org, selected.id, newTag)); setNewTag('') }}>
                  <input aria-label="Nueva etiqueta" list="lib-tag-list" value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Añadir etiqueta" maxLength={40} />
                  <datalist id="lib-tag-list">{allTags(org).map(t => <option key={t} value={t} />)}</datalist>
                  <button type="submit" className="ghost small" disabled={!newTag.trim()}>Añadir</button>
                </form>
              </dd>
              {org.collections.length > 0 && <><dt>Colecciones</dt><dd style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{org.collections.map(c => <label key={c.id} className="pill"><input type="checkbox" checked={c.assetIds.includes(selected.id)} onChange={() => void changeOrg(toggleInCollection(org, c.id, selected.id))} /> {c.name}</label>)}</dd></>}
              {madeFrom.length > 0 && <><dt>Hecho con</dt><dd>{madeFrom.map(a => <button key={a.id} type="button" className="linkish" onClick={() => setSelected(a)}>{describeAsset(a).title.slice(0, 30)}</button>)}</dd></>}
              {usedIn.length > 0 && <><dt>Versiones derivadas</dt><dd>{usedIn.map(a => <button key={a.id} type="button" className="linkish" onClick={() => setSelected(a)}>{describeAsset(a).title.slice(0, 30)}</button>)}</dd></>}
            </dl>
            <div className="pageActions">
              {selected.project_id && ['video', 'image', 'voice', 'music', 'sfx'].includes(selected.asset_type) && <Link className="buttonLink small" href={manualEditorHref(selected.project_id, [selected.id])}><Icon name="scissors" size={14} />Editar en el Editor manual</Link>}
              {urls[selected.id] && <a className="buttonLink ghost small" href={urls[selected.id]} target="_blank" rel="noopener noreferrer"><Icon name="upload" size={14} />Abrir archivo</a>}
              {['voice', 'video', 'music', 'sfx'].includes(selected.asset_type) && (subtitleOf(selected.id)
                ? <button type="button" className="ghost small" onClick={() => setSelected(subtitleOf(selected.id)!)}>Ver subtítulos</button>
                : <button type="button" className="ghost small" disabled={busy === selected.id} onClick={() => void transcribeAsset(selected)}><Icon name="script" size={14} />{busy === selected.id ? 'Transcribiendo…' : 'Transcribir (subtítulos)'}</button>)}
              {selected.asset_type === 'subtitle' && typeof selected.provenance?.srt === 'string' && <button type="button" className="ghost small" onClick={() => void copy(String(selected.provenance?.srt))}><Icon name="copy" size={14} />Copiar SRT</button>}
              {selected.asset_type === 'subtitle' && typeof selected.provenance?.srt === 'string' && <button type="button" className="ghost small" onClick={() => downloadText(`${d.title.replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 60) || 'subtitulos'}.srt`, String(selected.provenance?.srt), 'application/x-subrip')}><Icon name="upload" size={14} />Descargar SRT</button>}
              <button type="button" className="ghost small danger" disabled={busy === selected.id} onClick={() => void askDelete(selected)}><Icon name="trash" size={14} />Borrar</button>
            </div>
            {confirmDelete?.id === selected.id && (
              <div className={confirmDelete.check.allowed ? 'notice' : 'error'} role="alert">
                {confirmDelete.check.allowed ? <p>¿Borrar definitivamente este archivo? Se elimina del almacenamiento y no se puede deshacer.</p> : <p>No se puede borrar:</p>}
                {confirmDelete.check.reasons.map(r => <p key={r} className="small">{r}</p>)}
                {confirmDelete.check.warnings.map(w => <p key={w} className="small">{w}</p>)}
                <div className="pageActions">
                  {confirmDelete.check.allowed && <button type="button" className="danger small" disabled={busy === selected.id} onClick={() => void doDelete(selected)}>{busy === selected.id ? 'Borrando…' : 'Sí, borrar'}</button>}
                  <button type="button" className="ghost small" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                </div>
              </div>
            )}
            {selected.asset_type === 'subtitle' && typeof selected.provenance?.text === 'string' && <pre className="small">{String(selected.provenance.text).slice(0, 4000)}</pre>}
          </aside>
        )}
      </div>
    </StudioShell>
  )
}
