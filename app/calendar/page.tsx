'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { canPlan, dayKey, formatAdvice, groupByDay, monthGrid, multiPlatformDrafts, PLATFORMS, platformNames, type CalendarJob, type Platform } from '@/lib/calendar'

type Project = { id: string; name: string }
type Video = { id: string; project_id: string; provenance: Record<string, unknown> | null; created_at: string }
const statusLabels: Record<string, string> = { draft: 'Borrador', awaiting_approval: 'Pendiente de aprobación', approved: 'Aprobado', publishing: 'Publicando', published: 'Publicado', failed: 'Falló', cancelled: 'Cancelado' }
const kindLabels = { published: 'publicado', scheduled: 'programado en YouTube', planned: 'fecha prevista' } as const
const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const editHref = (j: CalendarJob) => `${j.platform === 'youtube' ? '/youtube' : '/social'}?project=${j.project_id}`
const titleOf = (j: CalendarJob) => String(j.payload?.title ?? j.payload?.caption ?? 'Sin título').split('\n')[0].slice(0, 60) || 'Sin título'

/**
 * Editorial calendar: every publication of every platform by day, with planned dates for drafts and one-step drafts for several platforms
 * from the same video. Planned dates are reminders: nothing is published without approving and pressing «Publicar».
 */
export default function CalendarPage() {
  const supabase = getSupabaseBrowserClient()
  const [jobs, setJobs] = useState<CalendarJob[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ projectId: '', videoId: '', title: '', text: '', platforms: ['youtube'] as Platform[], date: '' })

  const load = useCallback(async () => {
    const [j, p, v] = await Promise.all([
      supabase.from('publication_jobs').select('id,project_id,platform,status,scheduled_for,created_at,payload,result').order('created_at', { ascending: false }).limit(500),
      supabase.from('projects').select('id,name').order('updated_at', { ascending: false }),
      supabase.from('assets').select('id,project_id,provenance,created_at').eq('asset_type', 'video').not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300),
    ])
    if (j.error) setError(j.error.message); else setJobs((j.data ?? []) as CalendarJob[])
    setProjects((p.data ?? []) as Project[]); setVideos((v.data ?? []) as Video[])
  }, [supabase])
  useEffect(() => { void load() }, [load])

  const { byDay, undated } = useMemo(() => groupByDay(jobs), [jobs])
  const grid = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor])
  const today = dayKey(new Date())
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? 'Proyecto'
  const projectVideos = videos.filter(v => v.project_id === form.projectId)
  const chosen = videos.find(v => v.id === form.videoId)
  const chosenFormat = typeof chosen?.provenance?.format === 'string' ? chosen.provenance.format : null
  const duplicates = form.videoId ? jobs.filter(j => j.payload?.videoAssetId === form.videoId && form.platforms.includes(j.platform as Platform) && !['cancelled', 'published'].includes(j.status)) : []

  async function plan(j: CalendarJob, value: string) {
    setError(''); setNotice('')
    const scheduled = value ? new Date(`${value}T12:00:00`).toISOString() : null
    const { error: e } = await supabase.from('publication_jobs').update({ scheduled_for: scheduled, updated_at: new Date().toISOString() }).eq('id', j.id).in('status', ['draft', 'awaiting_approval'])
    if (e) setError(e.message); else { setNotice(value ? `Fecha prevista: ${new Date(scheduled!).toLocaleDateString()}. Es un recordatorio: no se publica solo.` : 'Fecha prevista quitada.'); await load() }
  }

  async function createDrafts(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice('')
    if (!form.projectId || !form.videoId) { setError('Elige el proyecto y el vídeo.'); return }
    if (!form.platforms.length) { setError('Elige al menos una plataforma.'); return }
    if (form.platforms.includes('youtube') && !form.title.trim()) { setError('YouTube necesita un título.'); return }
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const rows = multiPlatformDrafts({ videoAssetId: form.videoId, title: form.title, text: form.text, platforms: form.platforms, plannedFor: form.date ? new Date(`${form.date}T12:00:00`).toISOString() : null }, user.id, form.projectId, () => crypto.randomUUID())
      const { error: err } = await supabase.from('publication_jobs').insert(rows)
      if (err) throw new Error(err.message)
      setNotice(`${rows.length} borrador${rows.length === 1 ? '' : 'es'} creado${rows.length === 1 ? '' : 's'} (${form.platforms.map(p => platformNames[p]).join(', ')}). Revísalos y apruébalos en cada plataforma; nada se ha publicado.`)
      setForm(f => ({ ...f, title: '', text: '', date: '' }))
      await load()
    } catch (er) { setError(er instanceof Error ? er.message : 'No se pudieron crear los borradores.') } finally { setBusy(false) }
  }

  const move = (delta: number) => setCursor(c => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  return <StudioShell title="Calendario editorial" eyebrow="PUBLICACIÓN">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <section className="panel" style={{ marginBottom: 18 }} aria-label="Preparar en varias plataformas">
      <h3>Preparar en varias plataformas</h3>
      <p className="muted small">Crea a la vez un borrador por plataforma con el mismo vídeo. YouTube queda en privado; en TikTok elegirás la privacidad al revisarlo. Nada se publica sin aprobar y pulsar «Publicar».</p>
      <form onSubmit={createDrafts} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="field-row">
          <label>Proyecto<select aria-label="Proyecto" value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value, videoId: '' }))}><option value="">— Elige un proyecto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Vídeo<select aria-label="Vídeo" value={form.videoId} onChange={e => setForm(f => ({ ...f, videoId: e.target.value }))} disabled={!form.projectId}><option value="">{projectVideos.length ? '— Elige un vídeo' : 'Sin vídeos en este proyecto'}</option>{projectVideos.map(v => <option key={v.id} value={v.id}>{String(v.provenance?.title ?? 'Vídeo').slice(0, 60)}{typeof v.provenance?.format === 'string' ? ` · ${v.provenance.format}` : ''}</option>)}</select></label>
          <label>Fecha prevista<input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></label>
        </div>
        <label>Título (YouTube)<input value={form.title} maxLength={100} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></label>
        <label>Descripción / texto<textarea rows={3} value={form.text} maxLength={2200} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} /></label>
        <div className="pageActions" role="group" aria-label="Plataformas">{PLATFORMS.map(p => <label key={p} className="pill"><input type="checkbox" aria-label={platformNames[p]} checked={form.platforms.includes(p)} onChange={e => setForm(f => ({ ...f, platforms: e.target.checked ? [...f.platforms, p] : f.platforms.filter(x => x !== p) }))} /> {platformNames[p]}</label>)}</div>
        {form.platforms.map(p => formatAdvice(chosenFormat, p)).filter(Boolean).map(a => <p key={a} className="warnBox small">{a} <Link className="open" href={`/repurpose?project=${form.projectId}`}>Abrir Convertir a Shorts</Link></p>)}
        {duplicates.length > 0 && <p className="warnBox small">Ya hay {duplicates.length} borrador{duplicates.length === 1 ? '' : 'es'} sin publicar con este vídeo en {[...new Set(duplicates.map(d => platformNames[d.platform as Platform]))].join(', ')}.</p>}
        <div><button type="submit" disabled={busy}>{busy ? 'Creando…' : `Crear ${form.platforms.length || ''} borrador${form.platforms.length === 1 ? '' : 'es'}`}</button></div>
      </form>
    </section>

    <div className="cardHead" style={{ marginBottom: 8 }}>
      <h3 style={{ margin: 0 }}>{months[cursor.m]} {cursor.y}</h3>
      <div className="pageActions"><button type="button" className="ghost small" onClick={() => move(-1)} aria-label="Mes anterior">←</button><button type="button" className="ghost small" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }) }}>Hoy</button><button type="button" className="ghost small" onClick={() => move(1)} aria-label="Mes siguiente">→</button></div>
    </div>
    <div className="calendarGrid" role="grid" aria-label={`Calendario de ${months[cursor.m]} ${cursor.y}`}>
      {/* Rows are layout-neutral (display: contents) but give the grid the structure screen readers need: row > columnheader / gridcell. */}
      <div role="row" style={{ display: 'contents' }}>{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => <div key={d} className="calHead" role="columnheader">{d}</div>)}</div>
      {Array.from({ length: Math.ceil(grid.length / 7) }, (_, w) => grid.slice(w * 7, w * 7 + 7)).map((week, w) => <div key={w} role="row" style={{ display: 'contents' }}>{week.map(c => {
        const items = byDay.get(c.key) ?? []
        return <div key={c.key} role="gridcell" className={`calDay${c.inMonth ? '' : ' out'}${c.key === today ? ' today' : ''}${items.length ? ' busy' : ''}`} aria-label={`${c.day} ${items.length ? `· ${items.length} publicaciones` : ''}`}>
          <span className="calNum">{c.day}</span>
          {items.map(j => <Link key={j.id} className={`calItem plat-${j.platform} kind-${j.kind}`} href={editHref(j)} title={`${platformNames[j.platform as Platform] ?? j.platform} · ${statusLabels[j.status] ?? j.status} · ${kindLabels[j.kind]} · ${projectName(j.project_id)}`}>
            {platformNames[j.platform as Platform]?.slice(0, 2) ?? '?'} · {titleOf(j)}
          </Link>)}
        </div>
      })}</div>)}
    </div>
    <p className="muted small">Leyenda: <span className="calItem kind-published">publicado</span> <span className="calItem kind-scheduled">programado en YouTube (lo publica YouTube)</span> <span className="calItem kind-planned">fecha prevista (recordatorio)</span></p>

    <h3 className="sectionTitle">Sin fecha ({undated.length})</h3>
    {undated.length === 0 ? <p className="emptyState">Todas las publicaciones tienen fecha.</p> : <div className="list">{undated.map(j => <div key={j.id} className="listItem" style={{ flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}><b>{platformNames[j.platform as Platform] ?? j.platform}</b> · {titleOf(j)} <span className="pill">{statusLabels[j.status] ?? j.status}</span><span className="muted small" style={{ display: 'block' }}>{projectName(j.project_id)}</span></div>
      <div className="pageActions">
        {canPlan(j) ? <label className="small">Fecha prevista <input type="date" aria-label={`Fecha prevista de ${titleOf(j)}`} onChange={e => void plan(j, e.target.value)} /></label> : <span className="muted small">Aprobado: la fecha se fija antes de aprobar</span>}
        <Link className="buttonLink ghost small" href={editHref(j)}>Abrir</Link>
      </div>
    </div>)}</div>}
  </StudioShell>
}
