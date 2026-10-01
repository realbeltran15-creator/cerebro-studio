'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { modelById } from '@/lib/providers/catalog'
import { tierLabels, type CostTier } from '@/lib/providers/directory'
import { describeAsset, originOf, type LibraryAsset } from '@/lib/library'

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

  useEffect(() => {
    void (async () => {
      const [a, p, s] = await Promise.all([
        supabase.from('assets').select('id,asset_type,project_id,storage_path,source_provider,source_url,license_status,provenance,created_at').order('created_at', { ascending: false }).limit(500),
        supabase.from('projects').select('id,name'),
        supabase.from('scenes').select('id,position'),
      ])
      if (a.error) setError(a.error.message); else setAssets((a.data ?? []) as LibraryAsset[])
      setProjects((p.data ?? []) as Project[]); setScenes((s.data ?? []) as Scene[])
    })()
  }, [supabase])

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
    return assets.filter(a => (!type || a.asset_type === type) && (!origin || originOf(a) === origin) && (!projectId || a.project_id === projectId)
      && (!term || JSON.stringify(a.provenance ?? {}).toLowerCase().includes(term)))
  }, [assets, type, origin, projectId, q])
  useEffect(() => { visible.slice(0, 24).filter(a => a.asset_type === 'image' || a.asset_type === 'thumbnail').forEach(a => { if (!urls[a.id]) void url(a.id) }) }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  async function transcribeAsset(a: LibraryAsset) {
    setBusy(a.id); setError(''); setNotice('')
    const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: a.id, language: 'es' }) })
    const j = await r.json().catch(() => ({})) as { asset?: LibraryAsset; duplicate?: boolean; error?: string; attempts?: string[] }
    setBusy('')
    if (!r.ok || !j.asset) { setError(`${j.error ?? 'No se pudo transcribir.'}${j.attempts?.length ? ` (${j.attempts.join(' · ')})` : ''}`); return }
    setNotice(j.duplicate ? 'Este archivo ya tenía subtítulos.' : 'Subtítulos creados y guardados en la Biblioteca.')
    const { data } = await supabase.from('assets').select('id,asset_type,project_id,storage_path,source_provider,source_url,license_status,provenance,created_at').eq('id', j.asset.id).maybeSingle()
    if (data) { setAssets(list => list.some(x => x.id === data.id) ? list : [data as LibraryAsset, ...list]); setSelected(data as LibraryAsset) }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice('Copiado.') } catch { setNotice('No se pudo copiar; selecciona el texto manualmente.') }
  }

  const kinds = [...new Set(assets.map(a => a.asset_type))]
  const subtitleOf = (id: string) => assets.find(x => x.asset_type === 'subtitle' && x.provenance?.sourceAssetId === id)
  const d = selected ? describeAsset(selected) : null
  const usedIn = selected ? assets.filter(a => Array.isArray(a.provenance?.inputs) && (a.provenance.inputs as Array<{ id?: string }>).some(i => i.id === selected.id)) : []
  const madeFrom = selected && Array.isArray(selected.provenance?.inputs) ? (selected.provenance.inputs as Array<{ id?: string }>).map(i => assets.find(a => a.id === i.id)).filter((x): x is LibraryAsset => Boolean(x)) : []

  function preview(a: LibraryAsset, large: boolean) {
    const u = urls[a.id]
    if (a.asset_type === 'image' || a.asset_type === 'thumbnail') return u ? <img src={u} alt={describeAsset(a).title} /> : <div className="mediaEmpty"><Icon name="image" size={large ? 36 : 20} /></div>
    if (!large || !u) return <div className="mediaEmpty"><Icon name={a.asset_type === 'video' ? 'video' : a.asset_type === 'voice' ? 'mic' : a.asset_type === 'subtitle' ? 'script' : 'music'} size={large ? 36 : 20} /></div>
    if (a.asset_type === 'subtitle') return <div className="mediaEmpty"><Icon name="script" size={36} /></div>
    if (a.asset_type === 'video') return <video src={u} controls playsInline />
    return <div className="audioStage"><Icon name="music" size={36} /><audio src={u} controls /></div>
  }

  return (
    <StudioShell title="Biblioteca" eyebrow="ASSETS" actions={<Link className="buttonLink ghost" href="/usage">Costes y créditos</Link>}>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="field-row" style={{ marginBottom: 14 }}>
        <label htmlFor="lib-q">Buscar<input id="lib-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Prompt, autor, modelo, licencia…" /></label>
        <label htmlFor="lib-type">Tipo<select id="lib-type" value={type} onChange={e => setType(e.target.value)}><option value="">Todos</option>{kinds.map(k => <option key={k} value={k}>{typeLabels[k] ?? k}</option>)}</select></label>
        <label htmlFor="lib-origin">Origen<select id="lib-origin" value={origin} onChange={e => setOrigin(e.target.value)}><option value="">Todos</option>{Object.entries(originLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label htmlFor="lib-project">Proyecto<select id="lib-project" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">Todos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <p className="muted small" style={{ marginBottom: 10 }}>{visible.length} de {assets.length} archivos. Pulsa uno para ver cómo se creó.</p>

      <div className="libLayout">
        <div className="thumbGrid">
          {visible.map(a => {
            const info = describeAsset(a)
            return (
              <button key={a.id} type="button" className={selected?.id === a.id ? 'thumb active' : 'thumb'} onClick={() => { setSelected(a); void url(a.id) }} title={info.title}>
                {preview(a, false)}
                <span><b>{typeLabels[a.asset_type] ?? a.asset_type}</b> · {originLabels[originOf(a)]}<br />{info.title.slice(0, 48)}</span>
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
              {madeFrom.length > 0 && <><dt>Hecho con</dt><dd>{madeFrom.map(a => <button key={a.id} type="button" className="linkish" onClick={() => setSelected(a)}>{describeAsset(a).title.slice(0, 30)}</button>)}</dd></>}
              {usedIn.length > 0 && <><dt>Versiones derivadas</dt><dd>{usedIn.map(a => <button key={a.id} type="button" className="linkish" onClick={() => setSelected(a)}>{describeAsset(a).title.slice(0, 30)}</button>)}</dd></>}
            </dl>
            <div className="pageActions">
              {urls[selected.id] && <a className="buttonLink ghost small" href={urls[selected.id]} target="_blank" rel="noopener noreferrer"><Icon name="upload" size={14} />Abrir archivo</a>}
              {['voice', 'video', 'music', 'sfx'].includes(selected.asset_type) && (subtitleOf(selected.id)
                ? <button type="button" className="ghost small" onClick={() => setSelected(subtitleOf(selected.id)!)}>Ver subtítulos</button>
                : <button type="button" className="ghost small" disabled={busy === selected.id} onClick={() => void transcribeAsset(selected)}><Icon name="script" size={14} />{busy === selected.id ? 'Transcribiendo…' : 'Transcribir (subtítulos)'}</button>)}
              {selected.asset_type === 'subtitle' && typeof selected.provenance?.srt === 'string' && <button type="button" className="ghost small" onClick={() => void copy(String(selected.provenance?.srt))}><Icon name="copy" size={14} />Copiar SRT</button>}
            </div>
            {selected.asset_type === 'subtitle' && typeof selected.provenance?.text === 'string' && <pre className="small">{String(selected.provenance.text).slice(0, 4000)}</pre>}
          </aside>
        )}
      </div>
    </StudioShell>
  )
}
