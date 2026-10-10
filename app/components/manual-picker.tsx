'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { emptyComposition, parseComposition, totalDurationMs, type OutputFormat } from '@/lib/editor/composition'

type Draft = { id: string; project_id: string; updated_at: string; composition: unknown }
type Project = { id: string; name: string }

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

/**
 * Entry point of the manual editor from the main menu: open a saved edit or start an empty one.
 * An empty edit has no storyboard; everything is added from the project's Library (video, images, voice, music, effects).
 */
export function ManualPicker() {
  const supabase = getSupabaseBrowserClient()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState<OutputFormat>('16:9')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [d, p] = await Promise.all([
      supabase.from('render_jobs').select('id,project_id,updated_at,composition').eq('status', 'draft').order('updated_at', { ascending: false }).limit(40),
      supabase.from('projects').select('id,name').order('updated_at', { ascending: false }),
    ])
    if (d.error) setError(d.error.message)
    setDrafts((d.data ?? []) as Draft[])
    const list = (p.data ?? []) as Project[]
    setProjects(list)
    setProjectId(id => id || new URLSearchParams(window.location.search).get('project') || list[0]?.id || '')
  }, [supabase])

  useEffect(() => { void load() }, [load])

  async function create() {
    if (!projectId || busy) return
    setBusy(true); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const composition = { ...emptyComposition(`manual-${crypto.randomUUID()}`, title.trim() || 'Montaje manual', format), editedManually: true }
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: format, status: 'draft', composition }).select('id').single()
      if (e || !data) throw new Error(e?.message ?? 'No se pudo crear el montaje.')
      window.location.href = `/editor/manual?job=${(data as { id: string }).id}`
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el montaje.'); setBusy(false) }
  }

  const nameOf = (id: string) => projects.find(p => p.id === id)?.name ?? 'Proyecto'

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <p className="muted">Edita por separado vídeo, imágenes, voz, música y efectos en una línea de tiempo: corta, divide, duplica, mueve, elimina y reordena clips, y guarda el montaje. Todo se monta con los recursos de la Biblioteca del proyecto.</p>
    {error && <p className="error" role="alert">{error}</p>}

    <section className="panel" aria-labelledby="mp-new">
      <h3 id="mp-new">Montaje nuevo</h3>
      <div className="field-row">
        <label htmlFor="mp-project">Proyecto
          <select id="mp-project" value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label htmlFor="mp-title">Título<input id="mp-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Montaje manual" /></label>
        <label htmlFor="mp-format">Formato
          <select id="mp-format" value={format} onChange={e => setFormat(e.target.value as OutputFormat)}>
            <option value="16:9">Horizontal 16:9</option><option value="9:16">Vertical 9:16 (Shorts, Reels, TikTok)</option><option value="1:1">Cuadrado 1:1</option>
          </select>
        </label>
      </div>
      <div style={{ marginTop: 10 }}><button type="button" onClick={() => void create()} disabled={!projectId || busy}>{busy ? 'Creando…' : 'Crear montaje vacío'}</button></div>
      {projects.length === 0 && <p className="muted small">Crea primero un proyecto en <Link href="/projects">Proyectos</Link>.</p>}
    </section>

    <section className="panel" aria-labelledby="mp-open">
      <h3 id="mp-open">Montajes guardados ({drafts.length})</h3>
      {drafts.length === 0 ? <p className="emptyState">Todavía no hay montajes guardados. Crea uno arriba o genera uno desde el <Link href="/editor">Editor de vídeo</Link>.</p> : <div className="list">
        {drafts.map(d => {
          const c = parseComposition(d.composition)
          return <div key={d.id} className="listItem">
            <span><b>{c?.title || 'Montaje'}</b><span className="muted small" style={{ display: 'block' }}>{nameOf(d.project_id)} · {c ? `${c.clips.length} clips · ${fmt(totalDurationMs(c))} · ${c.format}` : 'montaje no válido'} · {new Date(d.updated_at).toLocaleDateString('es-ES')}</span></span>
            {c && <Link className="buttonLink ghost" href={`/editor/manual?job=${d.id}`}>Abrir</Link>}
          </div>
        })}
      </div>}
    </section>
  </div>
}
