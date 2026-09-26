'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { RenderPanel } from '../components/render-panel'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { emptyComposition, parseComposition, syncWithScenes, totalDurationMs, MAX_CLIP_MS, MIN_CLIP_MS, type Clip, type Composition, type OutputFormat } from '@/lib/editor/composition'
import { assetLabel, audioDurationMs, musicTypes, visualTypes, voiceTypes, type EditorAsset } from '@/lib/editor/client'
import type { ProjectRow } from '@/lib/types/database'

type Board = { id: string; title: string; aspect_ratio: string; created_at: string }
type Scene = { id: string; position: number; duration_ms: number; narration: string | null; visual_prompt: string | null }
type Render = { id: string; status: string; output_format: string; error: string | null; created_at: string; output_asset_id: string | null; url?: string }

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
const statusLabels: Record<string, string> = { rendering: 'Renderizando', completed: 'Completado', failed: 'Falló', cancelled: 'Cancelado', queued: 'En cola' }

export default function EditorPage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [boards, setBoards] = useState<Board[]>([])
  const [boardId, setBoardId] = useState('')
  const [scenes, setScenes] = useState<Scene[]>([])
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [comp, setComp] = useState<Composition | null>(null)
  const [dirty, setDirty] = useState(false)
  const [renders, setRenders] = useState<Render[]>([])
  const [busyClip, setBusyClip] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requested, setRequested] = useState<{ project: string | null; storyboard: string | null }>({ project: null, storyboard: null })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const wanted = { project: params.get('project'), storyboard: params.get('storyboard') }
    setRequested(wanted)
    void (async () => {
      const { data, error: e } = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
      if (e) { setError(e.message); return }
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows)
      setProjectId(wanted.project && rows.some(p => p.id === wanted.project) ? wanted.project : rows[0]?.id ?? '')
    })()
  }, [supabase])

  const loadAssets = useCallback(async (pid: string) => {
    const { data } = await supabase.from('assets').select('id,asset_type,storage_path,license_status,source_provider,provenance,created_at')
      .eq('project_id', pid).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
    setAssets((data ?? []) as EditorAsset[])
  }, [supabase])

  const loadRenders = useCallback(async (pid: string) => {
    const { data } = await supabase.from('render_jobs').select('id,status,output_format,error,created_at,output_asset_id')
      .eq('project_id', pid).neq('status', 'draft').order('created_at', { ascending: false }).limit(8)
    const rows = (data ?? []) as Render[]
    setRenders(rows)
    const withUrls = await Promise.all(rows.map(async r => {
      if (!r.output_asset_id) return r
      const res = await fetch(`/api/assets/${r.output_asset_id}/signed-url`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({})) as { url?: string }
      return { ...r, url: json.url }
    }))
    setRenders(withUrls)
  }, [supabase])

  useEffect(() => {
    if (!projectId) return
    setComp(null); setJobId(null); setScenes([]); setError(''); setNotice('')
    void loadAssets(projectId); void loadRenders(projectId)
    void (async () => {
      const { data } = await supabase.from('storyboards').select('id,title,aspect_ratio,created_at').eq('project_id', projectId).order('created_at', { ascending: false })
      const rows = (data ?? []) as Board[]
      setBoards(rows)
      setBoardId(requested.storyboard && rows.some(b => b.id === requested.storyboard) ? requested.storyboard : rows[0]?.id ?? '')
    })()
  }, [projectId, requested.storyboard, supabase, loadAssets, loadRenders])

  useEffect(() => {
    if (!boardId) return
    void (async () => {
      setError('')
      const board = boards.find(b => b.id === boardId)
      const [{ data: sceneRows, error: se }, { data: jobs }] = await Promise.all([
        supabase.from('scenes').select('id,position,duration_ms,narration,visual_prompt').eq('storyboard_id', boardId).order('position'),
        supabase.from('render_jobs').select('id,composition').eq('project_id', projectId).eq('status', 'draft').eq('composition->>storyboardId', boardId).order('updated_at', { ascending: false }).limit(1),
      ])
      if (se) { setError(se.message); return }
      const list = (sceneRows ?? []) as Scene[]
      setScenes(list)
      const job = (jobs ?? [])[0] as { id: string; composition: unknown } | undefined
      const base = parseComposition(job?.composition) ?? emptyComposition(boardId, board?.title ?? 'Montaje', (board?.aspect_ratio as OutputFormat) === '9:16' ? '9:16' : '16:9')
      setJobId(job?.id ?? null)
      setComp(syncWithScenes(base, list))
      setDirty(!job)
    })()
  }, [boardId, boards, projectId, supabase])

  function patch(p: Partial<Composition>) { setComp(c => c ? { ...c, ...p } : c); setDirty(true); setNotice('') }
  function patchClip(sceneId: string, p: Partial<Clip>) {
    setComp(c => c ? { ...c, clips: c.clips.map(k => k.sceneId === sceneId ? { ...k, ...p } : k) } : c); setDirty(true); setNotice('')
  }

  async function save(): Promise<void> {
    if (!comp || !projectId) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('La sesión ha caducado.')
    if (jobId) {
      const { error: e } = await supabase.from('render_jobs').update({ composition: comp, output_format: comp.format, updated_at: new Date().toISOString() }).eq('id', jobId)
      if (e) throw new Error(e.message)
    } else {
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: comp.format, status: 'draft', composition: comp }).select('id').single()
      if (e) throw new Error(e.message)
      setJobId((data as { id: string }).id)
    }
    setDirty(false)
  }

  async function saveClick() {
    setError('')
    try { await save(); setNotice('Montaje guardado.') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') }
  }

  async function generate(clip: Clip, kind: 'voice' | 'image') {
    const scene = scenes.find(s => s.id === clip.sceneId)
    const text = kind === 'voice' ? clip.narration?.trim() : (scene?.visual_prompt?.trim() || clip.narration?.trim())
    if (!text) { setError(kind === 'voice' ? 'La escena no tiene narración.' : 'La escena no tiene prompt visual ni narración.'); return }
    setBusyClip(`${clip.sceneId}:${kind}`); setError(''); setNotice('')
    try {
      const body = kind === 'voice' ? { projectId, text: text.slice(0, 4000) } : { projectId, prompt: text.slice(0, 4000), style: 'cinematic' }
      const r = await fetch(`/api/providers/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await r.json() as { asset?: { id: string }; error?: string }
      if (!r.ok || !json.asset) throw new Error(json.error ?? 'La generación falló.')
      await loadAssets(projectId)
      if (kind === 'voice') {
        const ms = await audioDurationMs(json.asset.id).catch(() => null)
        patchClip(clip.sceneId, { voiceAssetId: json.asset.id, ...(ms ? { durationMs: Math.min(Math.max(ms + 400, MIN_CLIP_MS), MAX_CLIP_MS) } : {}) })
      } else patchClip(clip.sceneId, { visualAssetId: json.asset.id })
      setNotice(kind === 'voice' ? 'Voz generada, asignada y duración ajustada. Guarda el montaje.' : 'Imagen generada y asignada. Guarda el montaje.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La generación falló.')
    } finally { setBusyClip('') }
  }

  async function fitToVoice(clip: Clip) {
    if (!clip.voiceAssetId) return
    setBusyClip(`${clip.sceneId}:fit`); setError('')
    try {
      const ms = await audioDurationMs(clip.voiceAssetId)
      patchClip(clip.sceneId, { durationMs: Math.min(Math.max(ms + 400, MIN_CLIP_MS), MAX_CLIP_MS) })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo medir la voz.') } finally { setBusyClip('') }
  }

  const visuals = useMemo(() => assets.filter(a => visualTypes.includes(a.asset_type)), [assets])
  const voices = useMemo(() => assets.filter(a => voiceTypes.includes(a.asset_type)), [assets])
  const music = useMemo(() => assets.filter(a => musicTypes.includes(a.asset_type)), [assets])

  return <StudioShell title="Editor" eyebrow="POSTPRODUCCIÓN" actions={projectId ? <Link className="buttonLink ghost" href={`/projects/${projectId}`}>Volver al proyecto</Link> : null}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="field-row">
        <label htmlFor="ed-project">Proyecto
          <select id="ed-project" value={projectId} onChange={e => { if (dirty && !window.confirm('Hay cambios sin guardar. ¿Cambiar de proyecto?')) return; setRequested({ project: null, storyboard: null }); setProjectId(e.target.value) }}>
            {projects.length === 0 && <option value="">Sin proyectos</option>}
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label htmlFor="ed-board">Storyboard
          <select id="ed-board" value={boardId} onChange={e => { if (dirty && !window.confirm('Hay cambios sin guardar. ¿Cambiar de storyboard?')) return; setBoardId(e.target.value) }}>
            {boards.length === 0 && <option value="">Sin storyboards</option>}
            {boards.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </label>
        {comp && <label htmlFor="ed-format">Formato
          <select id="ed-format" value={comp.format} onChange={e => patch({ format: e.target.value as OutputFormat })}>
            <option value="16:9">16:9 horizontal (YouTube)</option>
            <option value="9:16">9:16 vertical</option>
            <option value="1:1">1:1 cuadrado</option>
          </select>
        </label>}
      </div>
      {boards.length === 0 && projectId && <p className="muted small" style={{ marginTop: 8 }}>Este proyecto no tiene storyboard. <Link className="open" href={`/scripts?project=${projectId}`}>Crea uno desde un guion</Link>.</p>}
    </section>

    {comp && <>
      <div className="editorBar panel" style={{ marginBottom: 14 }}>
        <div className="stats">
          <span className="pill">{comp.clips.length} escenas</span>
          <span className="pill info">{fmt(totalDurationMs(comp))}</span>
          {dirty && <span className="pill warn">Cambios sin guardar</span>}
        </div>
        <div className="pageActions">
          <Link className="buttonLink ghost" href={`/create?project=${projectId}&storyboard=${boardId}`}>Editar escenas</Link>
          <button type="button" onClick={() => void saveClick()} disabled={!dirty}>Guardar montaje</button>
        </div>
      </div>

      <h3 className="sectionTitle">Línea de tiempo</h3>
      <div className="list">
        {comp.clips.map((clip, i) => {
          const scene = scenes.find(s => s.id === clip.sceneId)
          return <section key={clip.sceneId} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="cardHead" style={{ marginBottom: 0 }}>
              <b>Escena {i + 1}</b>
              <span className="muted small">{clip.narration ? `${clip.narration.slice(0, 140)}${clip.narration.length > 140 ? '…' : ''}` : 'Sin narración'}</span>
            </div>
            <div className="field-row">
              <label>Imagen o vídeo
                <select value={clip.visualAssetId ?? ''} onChange={e => patchClip(clip.sceneId, { visualAssetId: e.target.value || null })}>
                  <option value="">— Sin visual (negro)</option>
                  {visuals.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}
                </select>
              </label>
              <label>Voz
                <select value={clip.voiceAssetId ?? ''} onChange={e => patchClip(clip.sceneId, { voiceAssetId: e.target.value || null })}>
                  <option value="">— Sin voz</option>
                  {voices.map(a => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}
                </select>
              </label>
              <label>Duración (s)
                <input type="number" min={MIN_CLIP_MS / 1000} max={MAX_CLIP_MS / 1000} step={0.1} value={clip.durationMs / 1000}
                  onChange={e => patchClip(clip.sceneId, { durationMs: Math.min(Math.max(Math.round(Number(e.target.value) * 1000) || MIN_CLIP_MS, MIN_CLIP_MS), MAX_CLIP_MS) })} />
              </label>
              <label>Movimiento
                <select value={clip.motion} onChange={e => patchClip(clip.sceneId, { motion: e.target.value as Clip['motion'] })}>
                  <option value="kenburns">Zoom lento</option>
                  <option value="none">Fijo</option>
                </select>
              </label>
            </div>
            <div className="pageActions">
              <button type="button" className="ghost" disabled={Boolean(busyClip) || !clip.narration?.trim()} onClick={() => void generate(clip, 'voice')}><Icon name="mic" size={16} />{busyClip === `${clip.sceneId}:voice` ? 'Generando voz…' : 'Generar voz'}</button>
              <button type="button" className="ghost" disabled={Boolean(busyClip) || !(scene?.visual_prompt?.trim() || clip.narration?.trim())} onClick={() => void generate(clip, 'image')}><Icon name="image" size={16} />{busyClip === `${clip.sceneId}:image` ? 'Generando imagen…' : 'Generar imagen'}</button>
              <button type="button" className="ghost" disabled={Boolean(busyClip) || !clip.voiceAssetId} onClick={() => void fitToVoice(clip)}>{busyClip === `${clip.sceneId}:fit` ? 'Midiendo…' : 'Ajustar a la voz'}</button>
            </div>
          </section>
        })}
      </div>

      <h3 className="sectionTitle">Audio y subtítulos</h3>
      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="field-row">
          <label>Música de fondo
            <select value={comp.musicAssetId ?? ''} onChange={e => patch({ musicAssetId: e.target.value || null })}>
              <option value="">— Sin música</option>
              {music.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}
            </select>
          </label>
          <label>Volumen de música ({Math.round(comp.musicVolume * 100)}%)
            <input type="range" min={0} max={1} step={0.05} value={comp.musicVolume} onChange={e => patch({ musicVolume: Number(e.target.value) })} />
          </label>
          <label>Transición (ms)
            <input type="number" min={0} max={1500} step={50} value={comp.fadeMs} onChange={e => patch({ fadeMs: Math.min(Math.max(Number(e.target.value) || 0, 0), 1500) })} />
          </label>
        </div>
        <div className="pageActions" style={{ marginTop: 10 }}>
          <label className="pill"><input type="checkbox" checked={comp.duckMusic} onChange={e => patch({ duckMusic: e.target.checked })} /> Bajar música bajo la voz</label>
          <label className="pill"><input type="checkbox" checked={comp.subtitles} onChange={e => patch({ subtitles: e.target.checked })} /> Subtítulos incrustados</label>
          <Link className="open" href={`/audio?project=${projectId}`}>Añadir música o efectos →</Link>
        </div>
      </section>

      <RenderPanel projectId={projectId} composition={comp} assets={assets} beforeRender={dirty ? save : undefined} onRendered={() => void loadRenders(projectId)} />
    </>}

    {renders.length > 0 && <>
      <h3 className="sectionTitle">Renders del proyecto</h3>
      <div className="grid">{renders.map(r => <article key={r.id}>
        <small>{statusLabels[r.status] ?? r.status} · {r.output_format}</small>
        {r.url ? <video src={r.url} controls preload="metadata" style={{ width: '100%', borderRadius: 8, marginTop: 6 }} /> : r.error ? <p className="error small">{r.error}</p> : null}
        <p className="muted small">{new Date(r.created_at).toLocaleString()}</p>
      </article>)}</div>
    </>}
  </StudioShell>
}
