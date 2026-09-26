'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { basisLabels, formatDuration } from '@/lib/scripts'
import type { ProjectRow, SceneRow, ScriptBasis, StoryboardRow } from '@/lib/types/database'

type SceneForm = {
  duration: number
  narration: string
  visual_description: string
  visual_prompt: string
  video_prompt: string
  camera: string
  action: string
  ambient_prompt: string
  music: string
  sfx: string
  end_state: string
}

const emptyForm: SceneForm = { duration: 5, narration: '', visual_description: '', visual_prompt: '', video_prompt: '', camera: '', action: '', ambient_prompt: '', music: '', sfx: '', end_state: '' }
const meta = (s: SceneRow, key: string) => (typeof s.metadata?.[key] === 'string' ? (s.metadata[key] as string) : '')

function formFromScene(s: SceneRow): SceneForm {
  return {
    duration: Math.round(s.duration_ms / 100) / 10, narration: s.narration ?? '', visual_prompt: s.visual_prompt ?? '', video_prompt: s.video_prompt ?? '',
    ambient_prompt: s.ambient_prompt ?? '', visual_description: meta(s, 'visual_description'), camera: meta(s, 'camera'), action: meta(s, 'action'),
    music: meta(s, 'music'), sfx: meta(s, 'sfx'), end_state: meta(s, 'end_state'),
  }
}

export default function CreatePage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [boards, setBoards] = useState<StoryboardRow[]>([])
  const [scenes, setScenes] = useState<SceneRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState('')
  const [form, setForm] = useState<SceneForm>(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const loadScenes = useCallback(async (id: string) => {
    const { data, error: e } = await supabase.from('scenes').select('*').eq('storyboard_id', id).order('position')
    setScenes((data ?? []) as SceneRow[])
    if (e) setError(e.message)
  }, [supabase])

  const load = useCallback(async () => {
    const [{ data: p, error: pe }, { data: b, error: be }] = await Promise.all([
      supabase.from('projects').select('*').order('updated_at', { ascending: false }),
      supabase.from('storyboards').select('*').order('created_at', { ascending: false }),
    ])
    const projectRows = (p ?? []) as ProjectRow[]
    const boardRows = (b ?? []) as StoryboardRow[]
    setProjects(projectRows); setBoards(boardRows)
    if (pe || be) setError(pe?.message || be?.message || 'Error al cargar')
    return { projectRows, boardRows }
  }, [supabase])

  useEffect(() => {
    void (async () => {
      const { projectRows, boardRows } = await load()
      const params = new URLSearchParams(window.location.search)
      const requestedProject = params.get('project')
      const requestedBoard = params.get('storyboard')
      if (requestedProject && projectRows.some(x => x.id === requestedProject)) setProjectId(requestedProject)
      const board = boardRows.find(x => x.id === requestedBoard)
      if (board) { setProjectId(board.project_id); setSelected(board.id); await loadScenes(board.id) }
    })()
  }, [load, loadScenes])

  function selectBoard(id: string) {
    setSelected(id); setEditing(null); setForm(emptyForm); setError(''); setNotice('')
    void loadScenes(id)
    const b = boards.find(x => x.id === id)
    if (b) window.history.replaceState(null, '', `/create?project=${b.project_id}&storyboard=${id}`)
  }

  async function createBoard(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !projectId || !title.trim()) return
    setBusy(true)
    const { data, error: e } = await supabase.from('storyboards').insert({ owner_id: user.id, project_id: projectId, title: title.trim(), aspect_ratio: '16:9' }).select('id').single()
    setBusy(false)
    if (e) { setError(e.message); return }
    setTitle(''); setNotice('Storyboard creado. Añade escenas sin coste de IA.')
    await load()
    if (data) selectBoard(data.id)
  }

  async function saveScene(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('')
    if (!selected || busy) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setBusy(true)
    const existing = editing ? scenes.find(s => s.id === editing) : null
    const metadata = {
      ...(existing?.metadata ?? {}),
      visual_description: form.visual_description.trim() || null, camera: form.camera.trim() || null, action: form.action.trim() || null,
      music: form.music.trim() || null, sfx: form.sfx.trim() || null, end_state: form.end_state.trim() || null,
      duration_is_estimate: existing ? existing.metadata?.duration_is_estimate === true && Math.round(form.duration * 1000) === existing.duration_ms : false,
    }
    const fields = {
      duration_ms: Math.round(form.duration * 1000), narration: form.narration.trim() || null, visual_prompt: form.visual_prompt.trim() || null,
      video_prompt: form.video_prompt.trim() || null, ambient_prompt: form.ambient_prompt.trim() || null, metadata,
    }
    const nextPosition = scenes.reduce((m, s) => Math.max(m, s.position), 0) + 1
    const { error: e } = existing
      ? await supabase.from('scenes').update(fields).eq('id', existing.id)
      : await supabase.from('scenes').insert({ ...fields, owner_id: user.id, storyboard_id: selected, position: nextPosition })
    setBusy(false)
    if (e) { setError(e.message); return }
    setForm(emptyForm); setEditing(null)
    setNotice(existing ? `Escena ${existing.position} actualizada.` : 'Escena guardada. No se ha solicitado ninguna generación de pago.')
    await loadScenes(selected)
  }

  function editScene(s: SceneRow) { setEditing(s.id); setForm(formFromScene(s)); setNotice(''); document.getElementById('scene-form')?.scrollIntoView({ behavior: 'smooth' }) }

  const board = boards.find(b => b.id === selected)
  const total = scenes.reduce((t, s) => t + s.duration_ms, 0) / 1000
  const editingIndex = editing ? scenes.findIndex(s => s.id === editing) : scenes.length
  const previous = editingIndex > 0 ? scenes[editingIndex - 1] : null
  const set = (key: keyof SceneForm) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: key === 'duration' ? Number(e.target.value) : e.target.value }))

  return (
    <StudioShell title="Storyboard y escenas" eyebrow="PRODUCCIÓN" actions={projectId ? <Link className="buttonLink ghost" href={`/projects/${projectId}`}>Volver al proyecto</Link> : null}>
      <form className="projectForm" onSubmit={createBoard}>
        <select aria-label="Proyecto" value={projectId} onChange={e => { setProjectId(e.target.value); setSelected(''); setScenes([]) }} required>
          <option value="">Selecciona proyecto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input aria-label="Título del storyboard" value={title} onChange={e => setTitle(e.target.value)} placeholder="Storyboard vacío (o créalo desde un guion)" required maxLength={160} />
        <button disabled={busy}><Icon name="plus" size={16} />Crear storyboard</button>
      </form>
      {projectId && <p className="muted small" style={{ marginTop: -12, marginBottom: 16 }}>Consejo: desde <Link className="open" href={`/scripts?project=${projectId}`}>Guiones</Link> puedes convertir un guion en storyboard con la narración ya repartida por escenas.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="grid">
        {boards.filter(b => !projectId || b.project_id === projectId).map(b => (
          <article key={b.id} style={b.id === selected ? { borderColor: 'var(--accent)' } : undefined}>
            <small>Versión {b.version} · {b.aspect_ratio}{b.script_id ? ' · desde guion' : ''}</small>
            <h3 style={{ margin: '6px 0' }}>{b.title}</h3>
            <p>Proyecto: {projects.find(p => p.id === b.project_id)?.name || '—'}</p>
            <button type="button" className="ghost small" style={{ marginTop: 10 }} onClick={() => selectBoard(b.id)}>{b.id === selected ? 'Abierto' : 'Abrir escenas'}</button>
          </article>
        ))}
      </div>

      {board && <>
        <div className="cardHead" style={{ marginTop: 26 }}>
          <h2>{board.title}</h2>
          <span className="pill" title="Suma de duraciones planificadas">{scenes.length} escenas · {formatDuration(total)}</span>
        </div>
        <div className="sceneGrid">
          {scenes.map((s, i) => {
            const basis = s.metadata?.basis as ScriptBasis | undefined
            const sources = Array.isArray(s.metadata?.sources) ? (s.metadata.sources as unknown[]).filter(x => typeof x === 'string') as string[] : []
            return (
              <article key={s.id} className="scene">
                <div className="cardHead" style={{ marginBottom: 6 }}>
                  <small>Escena {s.position} · {s.duration_ms / 1000} s{s.metadata?.duration_is_estimate ? ' (estimada)' : ''}</small>
                  <button type="button" className="ghost small" onClick={() => editScene(s)}>Editar</button>
                </div>
                {meta(s, 'heading') && <h3>{meta(s, 'heading')}</h3>}
                {basis && basis in basisLabels && <span className="pill" style={{ marginTop: 6 }}>{basisLabels[basis]}{sources.length ? ` · ${sources.length} fuente(s)` : ''}</span>}
                {i > 0 && meta(scenes[i - 1], 'end_state') && <p className="continuity" style={{ marginTop: 8 }}>Viene de: {meta(scenes[i - 1], 'end_state')}</p>}
                <dl>
                  <dt>Narración</dt><dd>{s.narration || '—'}</dd>
                  <dt>Descripción</dt><dd>{meta(s, 'visual_description') || '—'}</dd>
                  <dt>Prompt imagen</dt><dd>{s.visual_prompt || '—'}</dd>
                  <dt>Prompt vídeo</dt><dd>{s.video_prompt || '—'}</dd>
                  <dt>Cámara</dt><dd>{meta(s, 'camera') || '—'}</dd>
                  <dt>Acción</dt><dd>{meta(s, 'action') || '—'}</dd>
                  <dt>Ambiente</dt><dd>{s.ambient_prompt || '—'}</dd>
                  <dt>Música</dt><dd>{meta(s, 'music') || '—'}</dd>
                  <dt>Efectos</dt><dd>{meta(s, 'sfx') || '—'}</dd>
                  <dt>Estado final</dt><dd>{meta(s, 'end_state') || '—'}</dd>
                </dl>
              </article>
            )
          })}
        </div>

        <form id="scene-form" className="panel" onSubmit={saveScene} style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="cardHead" style={{ marginBottom: 0 }}>
            <h3>{editing ? `Editar escena ${scenes[editingIndex]?.position}` : `Añadir escena ${scenes.length + 1}`}</h3>
            {editing && <button type="button" className="ghost small" onClick={() => { setEditing(null); setForm(emptyForm) }}>Cancelar edición</button>}
          </div>
          {previous && <p className="continuity">Continuidad: la escena anterior termina en «{meta(previous, 'end_state') || 'sin estado final definido'}». Empieza desde ahí.</p>}
          <label htmlFor="sc-duration">Duración (segundos)<input id="sc-duration" type="number" min="0.5" max="600" step="0.5" value={form.duration} onChange={set('duration')} required /></label>
          <label htmlFor="sc-narration">Narración<textarea id="sc-narration" value={form.narration} onChange={set('narration')} placeholder="Texto que dirá la voz" /></label>
          <label htmlFor="sc-desc">Descripción visual<textarea id="sc-desc" value={form.visual_description} onChange={set('visual_description')} placeholder="Qué se ve, en lenguaje de guion" /></label>
          <div className="field-row">
            <label htmlFor="sc-img">Prompt de imagen<textarea id="sc-img" value={form.visual_prompt} onChange={set('visual_prompt')} placeholder="16:9, anatomía natural, sin texto ni logos" /></label>
            <label htmlFor="sc-vid">Prompt de vídeo<textarea id="sc-vid" value={form.video_prompt} onChange={set('video_prompt')} placeholder="Movimiento y acción del clip" /></label>
          </div>
          <div className="field-row">
            <label htmlFor="sc-cam">Movimiento de cámara<input id="sc-cam" value={form.camera} onChange={set('camera')} placeholder="Travelling lento hacia delante" /></label>
            <label htmlFor="sc-act">Acción<input id="sc-act" value={form.action} onChange={set('action')} placeholder="Qué ocurre en el plano" /></label>
          </div>
          <div className="field-row">
            <label htmlFor="sc-amb">Sonido ambiente<input id="sc-amb" value={form.ambient_prompt} onChange={set('ambient_prompt')} placeholder="Selva, lluvia lejana" /></label>
            <label htmlFor="sc-mus">Música<input id="sc-mus" value={form.music} onChange={set('music')} placeholder="Tensión baja, cuerdas" /></label>
            <label htmlFor="sc-sfx">Efectos<input id="sc-sfx" value={form.sfx} onChange={set('sfx')} placeholder="Motor, impacto" /></label>
          </div>
          <label htmlFor="sc-end">Estado final (para la siguiente escena)<input id="sc-end" value={form.end_state} onChange={set('end_state')} placeholder="Dónde queda el personaje, luz, encuadre…" /></label>
          <button disabled={busy}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar escena (sin coste de IA)'}</button>
        </form>
      </>}
    </StudioShell>
  )
}
