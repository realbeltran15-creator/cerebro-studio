'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { Icon } from '../../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { projectProgress, projectStatuses, type ProgressInput } from '@/lib/progress'
import { formatDuration, isMissingScriptsTable, scriptStatusLabels } from '@/lib/scripts'
import type { AssetRow, OpportunityRow, ProjectRow, ScriptRow, StoryboardRow } from '@/lib/types/database'

type Job = { id: string; platform: string; status: string; payload: Record<string, unknown>; created_at: string }
type SceneLite = { storyboard_id: string; duration_ms: number }

export default function ProjectWorkspace() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const supabase = getSupabaseBrowserClient()
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [missing, setMissing] = useState(false)
  const [opps, setOpps] = useState<OpportunityRow[]>([])
  const [scripts, setScripts] = useState<ScriptRow[]>([])
  const [scriptsMigrationPending, setScriptsMigrationPending] = useState(false)
  const [boards, setBoards] = useState<StoryboardRow[]>([])
  const [scenes, setScenes] = useState<SceneLite[]>([])
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [renders, setRenders] = useState(0)
  const [metrics, setMetrics] = useState(0)
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('draft')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setError('')
    const { data: p, error: pe } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
    if (pe) { setError(pe.message); return }
    if (!p) { setMissing(true); return }
    const row = p as ProjectRow
    setProject(row); setDescription(row.description ?? ''); setStatus(row.status)
    const [o, s, b, a, j, r, m] = await Promise.all([
      supabase.from('opportunities').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('scripts').select('id,project_id,version,title,status,updated_at,hook,sections').eq('project_id', id).order('version', { ascending: false }),
      supabase.from('storyboards').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('assets').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(12),
      supabase.from('publication_jobs').select('id,platform,status,payload,created_at').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('render_jobs').select('id', { count: 'exact', head: true }).eq('project_id', id),
      supabase.from('metric_snapshots').select('id', { count: 'exact', head: true }).eq('project_id', id),
    ])
    setOpps((o.data ?? []) as OpportunityRow[])
    if (s.error) { setScriptsMigrationPending(isMissingScriptsTable(s.error)); if (!isMissingScriptsTable(s.error)) setError(s.error.message) }
    setScripts((s.data ?? []) as ScriptRow[])
    const bRows = (b.data ?? []) as StoryboardRow[]
    setBoards(bRows)
    setAssets((a.data ?? []) as AssetRow[])
    setJobs((j.data ?? []) as Job[])
    setRenders(r.count ?? 0)
    setMetrics(m.count ?? 0)
    if (bRows.length) {
      const { data } = await supabase.from('scenes').select('storyboard_id,duration_ms').in('storyboard_id', bRows.map(x => x.id))
      setScenes((data ?? []) as SceneLite[])
    } else setScenes([])
  }, [id, supabase])

  useEffect(() => { void load() }, [load])

  async function saveDetails(event: FormEvent) {
    event.preventDefault()
    if (!project) return
    setBusy(true); setNotice(''); setError('')
    const { error: e } = await supabase.from('projects').update({ description: description.trim() || null, status, updated_at: new Date().toISOString() }).eq('id', project.id)
    setBusy(false)
    if (e) setError(e.message)
    else { setNotice('Proyecto actualizado.'); await load() }
  }

  if (missing) return <StudioShell title="Proyecto no encontrado"><p className="emptyState">No existe o no tienes acceso. <Link className="open" href="/projects">Volver a proyectos →</Link></p></StudioShell>
  if (!project) return <StudioShell title="Proyecto"><p className="muted">{error || 'Cargando proyecto…'}</p></StudioShell>

  const input: ProgressInput = {
    opportunities: opps.length, scripts: scripts.length, approvedScripts: scripts.filter(s => s.status === 'approved').length,
    storyboards: boards.length, scenes: scenes.length, assets: assets.length, renders, publications: jobs.length, metrics,
  }
  const steps = projectProgress(input)
  const next = steps.find(s => s.state === 'next')
  const boardDuration = (boardId: string) => scenes.filter(s => s.storyboard_id === boardId).reduce((t, s) => t + s.duration_ms, 0) / 1000

  return (
    <StudioShell title={project.name} eyebrow="PROYECTO" actions={<>
      <Link className="buttonLink ghost" href="/projects">Todos los proyectos</Link>
      {next && <Link className="buttonLink" href={next.href(project.id)}>Siguiente: {next.label} <Icon name="arrow" size={16} /></Link>}
    </>}>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {scriptsMigrationPending && <p className="warnBox">El módulo de guiones necesita aplicar la migración <code>20260926120000_scripts_module.sql</code> en Supabase.</p>}

      <ol className="pipeline" aria-label="Progreso del proyecto" style={{ listStyle: 'none', padding: 0, margin: '0 0 18px' }}>
        {steps.map(s => (
          <li key={s.key}>
            <Link href={s.href(project.id)} className={`pipe ${s.state === 'done' ? 'done' : s.state === 'next' ? 'next' : ''}`}>
              <b>{s.state === 'done' ? <Icon name="check" size={14} /> : null}{s.label}</b>
              <span>{s.detail}</span>
            </Link>
          </li>
        ))}
      </ol>

      <div className="workspace">
        <section className="panel">
          <h2>Ficha</h2>
          <form onSubmit={saveDetails} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            <label htmlFor="project-status">Estado
              <select id="project-status" value={status} onChange={e => setStatus(e.target.value)}>
                {Object.entries(projectStatuses).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {!(status in projectStatuses) && <option value={status}>{status}</option>}
              </select>
            </label>
            <label htmlFor="project-description">Idea y objetivo
              <textarea id="project-description" value={description} onChange={e => setDescription(e.target.value)} placeholder="De qué trata el vídeo, para quién y qué debe sentir o aprender el espectador." maxLength={4000} />
            </label>
            <p className="muted small">Plataformas: {(project.target_platforms ?? []).join(', ') || 'sin definir'}</p>
            <button disabled={busy}>{busy ? 'Guardando…' : 'Guardar ficha'}</button>
          </form>
        </section>

        <section className="panel">
          <div className="cardHead"><h2>Investigación</h2><Link href="/opportunities">Oportunidades <Icon name="arrow" size={14} /></Link></div>
          {opps.length === 0 ? <p className="muted">No hay oportunidades vinculadas. Convierte una oportunidad en proyecto para conservar su fuente y evidencia aquí.</p> : (
            <div className="list">{opps.map(o => {
              const notes = Array.isArray(o.evidence) ? o.evidence.flatMap(ev => ev && typeof ev === 'object' && !Array.isArray(ev) && typeof ev.note === 'string' && ev.note.trim() ? [ev.note] : []) : []
              return (
                <div className="listItem" key={o.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div><b>{o.title}</b><span>{o.source_platform}{o.query ? ` · ${o.query}` : ''}{o.region ? ` · ${o.region}` : ''}{o.language ? ` · ${o.language}` : ''}</span></div>
                  {notes.map((n, i) => <p key={i} className="muted small">Observación: {n}</p>)}
                  {o.source_id && /^https?:\/\//.test(o.source_id) && <a className="open" href={o.source_id} target="_blank" rel="noopener noreferrer">Fuente original ↗</a>}
                </div>
              )
            })}</div>
          )}
        </section>

        <section className="panel">
          <div className="cardHead"><h2>Guiones</h2><Link href={`/scripts?project=${project.id}`}>{scripts.length ? 'Abrir editor' : 'Crear guion'} <Icon name="arrow" size={14} /></Link></div>
          {scripts.length === 0 ? <p className="muted">Sin guion todavía. El editor usará la ficha y la investigación de este proyecto como punto de partida.</p> : (
            <div className="list">{scripts.map(s => (
              <Link className="listItem" key={s.id} href={`/scripts?project=${project.id}&script=${s.id}`}>
                <div><b>v{s.version} · {s.title}</b><span>{Array.isArray(s.sections) ? s.sections.length : 0} secciones · {new Date(s.updated_at).toLocaleDateString()}</span></div>
                <span className={s.status === 'approved' ? 'pill ok' : 'pill'}>{scriptStatusLabels[s.status] ?? s.status}</span>
              </Link>
            ))}</div>
          )}
        </section>

        <section className="panel">
          <div className="cardHead"><h2>Storyboards</h2><div className="pageActions"><Link href={`/editor?project=${project.id}`}>Montar vídeo <Icon name="arrow" size={14} /></Link><Link href={`/create?project=${project.id}`}>Abrir <Icon name="arrow" size={14} /></Link></div></div>
          {boards.length === 0 ? <p className="muted">Sin storyboard. Genera uno desde un guion para no reescribir la narración.</p> : (
            <div className="list">{boards.map(b => (
              <Link className="listItem" key={b.id} href={`/create?project=${project.id}&storyboard=${b.id}`}>
                <div><b>{b.title}</b><span>{scenes.filter(s => s.storyboard_id === b.id).length} escenas · {b.aspect_ratio}{b.script_id ? ' · desde guion' : ''}</span></div>
                <span className="pill" title="Suma de duraciones planificadas (estimación)">{formatDuration(boardDuration(b.id))}</span>
              </Link>
            ))}</div>
          )}
        </section>

        <section className="panel">
          <div className="cardHead"><h2>Recursos</h2><div className="pageActions"><Link href={`/thumbnails?project=${project.id}`}>Miniaturas <Icon name="arrow" size={14} /></Link><Link href="/library">Biblioteca <Icon name="arrow" size={14} /></Link></div></div>
          {assets.length === 0 ? <p className="muted">Sin imágenes, clips ni voces generadas para este proyecto.</p> : (
            <div className="list">{assets.map(a => (
              <div className="listItem" key={a.id}><div><b>{String(a.provenance?.title || a.provenance?.originalPrompt || a.provenance?.concept || a.asset_type).slice(0, 80)}</b><span>{a.asset_type} · {a.source_provider ?? 'importado'}</span></div><span className="pill">{a.license_status}</span></div>
            ))}</div>
          )}
        </section>

        <section className="panel">
          <div className="cardHead"><h2>Publicación</h2><Link href={`/youtube?project=${project.id}`}>Preparar <Icon name="arrow" size={14} /></Link></div>
          {jobs.length === 0 ? <p className="muted">Nada preparado. Preparar no publica: publicar exige OAuth y tu aprobación.</p> : (
            <div className="list">{jobs.map(j => (
              <div className="listItem" key={j.id}><div><b>{String(j.payload?.title || 'Sin título')}</b><span>{j.platform} · {new Date(j.created_at).toLocaleDateString()}</span></div><span className="pill">{j.status === 'draft' ? 'Preparado, sin publicar' : j.status}</span></div>
            ))}</div>
          )}
        </section>
      </div>
    </StudioShell>
  )
}
