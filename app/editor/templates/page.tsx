'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { assetLabel, type EditorAsset } from '@/lib/editor/client'
import { autoAssign, fillTemplate, loadTemplates, saveTemplates, type Assignment, type MontageTemplate, type SlotKind } from '@/lib/editor/montage-template'

type Project = { id: string; name: string }
const secs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`
const ASSET_COLS = 'id,asset_type,storage_path,license_status,source_provider,provenance,created_at'
const ACCEPTS: Record<SlotKind, string[]> = { visual: ['video', 'image', 'thumbnail'], music: ['music', 'audio'], voice: ['voice', 'audio'], sfx: ['sfx', 'audio'] }

/** Plantillas de montaje: fill a saved montage structure with other files and get a new draft montage. */
export default function MontageTemplatesPage() {
  const supabase = getSupabaseBrowserClient()
  const [templates, setTemplates] = useState<MontageTemplate[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [assign, setAssign] = useState<Assignment>({})
  const [title, setTitle] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try { const t = await loadTemplates(supabase); setTemplates(t.templates); setUpdatedAt(t.updatedAt); setSelected(t.templates[0]?.id ?? '') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron leer tus plantillas.') }
      const { data } = await supabase.from('projects').select('id,name').order('updated_at', { ascending: false })
      const rows = (data ?? []) as Project[]
      const wanted = new URLSearchParams(window.location.search).get('project')
      setProjects(rows); setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
    })()
  }, [supabase])
  const loadAssets = useCallback(async (pid: string) => {
    const { data } = await supabase.from('assets').select(ASSET_COLS).eq('project_id', pid).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
    setAssets((data ?? []) as EditorAsset[])
  }, [supabase])
  useEffect(() => { if (projectId) { setAssign({}); setCreated(null); void loadAssets(projectId) } }, [projectId, loadAssets])

  const t = templates.find(x => x.id === selected) ?? null
  useEffect(() => { setAssign({}); setCreated(null); setConfirmDelete(false); setTitle(t?.name ?? '') }, [t])

  const durationOf = (id: string) => { const p = assets.find(a => a.id === id)?.provenance ?? {}; return typeof p.durationMs === 'number' ? p.durationMs : typeof p.durationSeconds === 'number' ? p.durationSeconds * 1000 : null }
  const preview = t ? fillTemplate(t, assign, { title, durationOf }) : null

  async function create() {
    if (!t || !preview) return
    setBusy(true); setError(''); setNotice('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: preview.composition.format, status: 'draft', composition: preview.composition }).select('id').single()
      if (e) throw new Error(e.message)
      setCreated((data as { id: string }).id)
      setNotice(`Montaje creado con la plantilla «${t.name}». ${preview.warnings.join(' ')}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el montaje.') } finally { setBusy(false) }
  }

  async function remove() {
    if (!t) return
    setBusy(true); setError('')
    try { const next = templates.filter(x => x.id !== t.id); const at = await saveTemplates(supabase, next, updatedAt); setTemplates(next); setUpdatedAt(at); setSelected(next[0]?.id ?? ''); setNotice(`Plantilla «${t.name}» borrada.`) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo borrar.') } finally { setBusy(false) }
  }

  return <StudioShell title="Plantillas de montaje" eyebrow="POSTPRODUCCIÓN" actions={<><Link className="buttonLink ghost" href="/editor/styles">Mis estilos</Link><Link className="buttonLink ghost" href="/editor/manual">Editor manual</Link></>}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice} {created && <Link className="open" href={`/editor/manual?job=${created}`}>Abrir en el editor manual →</Link>}</p>}
    <p className="muted">Una plantilla guarda la estructura completa de un montaje tuyo. Rellena sus huecos con otros archivos y obtienes un montaje nuevo con las mismas pistas, tiempos, transiciones, títulos y efectos. Se guardan desde el editor manual («Guardar como plantilla»).</p>
    {!templates.length ? <section className="panel"><p className="muted">Todavía no tienes plantillas. Abre un montaje en el <Link className="open" href="/editor/manual">editor manual</Link> y pulsa «Guardar como plantilla».</p></section> :
      <div className="editorLayout" style={{ gridTemplateColumns: '280px minmax(0,1fr)' }}>
        <aside className="panel" aria-label="Lista de plantillas">
          <h3>Mis plantillas ({templates.length})</h3>
          <ul className="plainList">{templates.map(x => <li key={x.id}><button type="button" className={x.id === selected ? 'small' : 'ghost small'} aria-pressed={x.id === selected} onClick={() => setSelected(x.id)} style={{ width: '100%', textAlign: 'left' }}>{x.name} · {x.format} · {secs(x.durationMs)}</button></li>)}</ul>
        </aside>
        {t && <section className="panel" aria-label={`Rellenar ${t.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="cardHead"><h3>{t.name}</h3><span className="muted small">{t.clips} clips · {secs(t.durationMs)} · {t.format}</span></div>
          <div className="field-row">
            <label>Proyecto<select aria-label="Proyecto" value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Título del montaje<input aria-label="Título del montaje" value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></label>
            <button type="button" className="ghost" style={{ alignSelf: 'end' }} onClick={() => setAssign(autoAssign(t, assets.map(a => ({ id: a.id, type: a.asset_type }))))}>Rellenar con los más recientes</button>
          </div>
          <table className="table small"><thead><tr><th>Hueco</th><th>Se usa</th><th>Archivo</th></tr></thead><tbody>
            {t.slots.map(s => <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td>{s.uses} vez{s.uses === 1 ? '' : 'es'} · era {s.sourceType}</td>
              <td><select aria-label={`Archivo para ${s.label}`} value={assign[s.key] ?? ''} onChange={e => setAssign(a => ({ ...a, [s.key]: e.target.value || undefined }))}><option value="">— Elegir</option>{assets.filter(a => ACCEPTS[s.kind].includes(a.asset_type)).map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select></td>
            </tr>)}
          </tbody></table>
          {preview && preview.warnings.length > 0 && <ul className="small warning" style={{ paddingLeft: 26 }}>{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
          <div className="pageActions">
            <button type="button" disabled={busy || !projectId || !preview || preview.missing.length === t.slots.length} onClick={() => void create()}>Crear montaje con esta plantilla</button>
            {confirmDelete ? <><button type="button" className="ghost" onClick={() => void remove()}>Confirmar borrado</button><button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button></> : <button type="button" className="ghost" onClick={() => setConfirmDelete(true)}>Borrar plantilla</button>}
          </div>
        </section>}
      </div>}
  </StudioShell>
}
