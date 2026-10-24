'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { assetLabel, audioDurationMs, videoDurationMs, type EditorAsset } from '@/lib/editor/client'
import { buildLoopMontage, LOOP_DEFAULTS, type LoopScene } from '@/lib/editor/loop-montage'
import { MAX_TIMELINE_MS, type ExportResolution, type OutputFormat, type Transition } from '@/lib/editor/composition'

const SCENE_TYPES = ['video', 'image', 'thumbnail']
const MUSIC_TYPES = ['music', 'audio']
const durationOf = (a: EditorAsset) => { const p = a.provenance ?? {}; return typeof p.durationMs === 'number' ? p.durationMs : typeof p.durationSeconds === 'number' ? Math.round(p.durationSeconds * 1000) : null }
const TRANSITIONS: Array<[Transition, string]> = [['dissolve', 'Disolución (suave)'], ['fade', 'Fundido'], ['slide', 'Deslizar'], ['wipe', 'Cortina']]

/**
 * «Prepara un vídeo de N minutos con esta música y estas escenas»: picks files from the Library, lays them out in a loop with smooth
 * transitions and opens the result as an ordinary montage in the manual editor. Deterministic and free: no AI, no generation credits.
 */
export function LoopMontagePanel({ projectId, onError }: { projectId: string; onError: (m: string) => void }) {
  const supabase = getSupabaseBrowserClient()
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [music, setMusic] = useState('')
  const [scenes, setScenes] = useState<string[]>([])
  const [minutes, setMinutes] = useState(90)
  const [clipSec, setClipSec] = useState(LOOP_DEFAULTS.clipMs / 1000)
  const [transition, setTransition] = useState<Transition>(LOOP_DEFAULTS.transition)
  const [resolution, setResolution] = useState<ExportResolution>('1080')
  const [title, setTitle] = useState('Vídeo en bucle')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!projectId) return
    let alive = true
    void supabase.from('assets').select('id,project_id,asset_type,storage_path,provenance,license_status,created_at').or(`project_id.eq.${projectId},project_id.is.null`).order('created_at', { ascending: false }).limit(200)
      .then(({ data }: { data: unknown[] | null }) => { if (alive) { setAssets((data ?? []) as EditorAsset[]); setMusic(''); setScenes([]) } })
    return () => { alive = false }
  }, [supabase, projectId])

  const sceneAssets = useMemo(() => assets.filter(a => SCENE_TYPES.includes(a.asset_type)), [assets])
  const musicAssets = useMemo(() => assets.filter(a => MUSIC_TYPES.includes(a.asset_type)), [assets])

  async function create() {
    if (busy || !scenes.length) return
    onError(''); setBusy('Leyendo duraciones…')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const sc: LoopScene[] = []
      for (const id of scenes) {
        const a = assets.find(x => x.id === id)!
        const kind = a.asset_type === 'video' ? 'video' : 'image'
        sc.push({ assetId: id, kind, durationMs: kind === 'video' ? durationOf(a) ?? await videoDurationMs(id).catch(() => null) : null })
      }
      const m = assets.find(x => x.id === music)
      const built = buildLoopMontage({
        title: title.trim() || 'Vídeo en bucle', scenes: sc, targetMs: Math.min(MAX_TIMELINE_MS, minutes * 60_000), clipMs: clipSec * 1000, transition, resolution, format: '16:9' as OutputFormat,
        music: m ? { assetId: m.id, durationMs: durationOf(m) ?? await audioDurationMs(m.id).catch(() => null) } : null,
      })
      setBusy('Creando el montaje…')
      const { data, error } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: '16:9', status: 'draft', composition: built.composition }).select('id').single()
      if (error || !data) throw new Error(error?.message ?? 'No se pudo crear el montaje.')
      window.location.href = `/editor/manual?job=${(data as { id: string }).id}`
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo crear el montaje.'); setBusy('') }
  }

  const toggle = (id: string) => setScenes(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  return <section className="panel" aria-labelledby="lp-title">
    <h3 id="lp-title">Montaje en bucle automático</h3>
    <p className="muted small">Elige la música y las escenas: se reparten en bucle hasta la duración que indiques, con transiciones suaves, y se abre como un montaje normal que puedes retocar. Sin IA y sin coste. Para vídeos largos (1 h o más) usa después «Paquete para renderizar en mi PC».</p>
    <div className="field-row">
      <label htmlFor="lp-name">Nombre del vídeo<input id="lp-name" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} /></label>
      <label htmlFor="lp-min">Duración (min)<input id="lp-min" type="number" min={1} max={MAX_TIMELINE_MS / 60000} value={minutes} onChange={e => setMinutes(Math.max(1, Math.min(MAX_TIMELINE_MS / 60000, Number(e.target.value) || 1)))} /></label>
      <label htmlFor="lp-clip">Cada escena (s)<input id="lp-clip" type="number" min={4} max={120} value={clipSec} onChange={e => setClipSec(Math.max(4, Math.min(120, Number(e.target.value) || 30)))} /></label>
      <label htmlFor="lp-tr">Transición<select id="lp-tr" value={transition} onChange={e => setTransition(e.target.value as Transition)}>{TRANSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label htmlFor="lp-res">Exportación<select id="lp-res" value={resolution} onChange={e => setResolution(e.target.value as ExportResolution)}><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option></select></label>
    </div>
    <label htmlFor="lp-music">Música (se repite en bucle)
      <select id="lp-music" value={music} onChange={e => setMusic(e.target.value)}><option value="">Sin música</option>{musicAssets.map(a => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select>
    </label>
    <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0' }}>
      <legend className="small">Escenas ({scenes.length} elegidas; se usan en el orden en que las marques)</legend>
      {sceneAssets.length === 0 ? <p className="emptyState">No hay vídeos ni imágenes en este proyecto ni en la Biblioteca general.</p> : <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>
        {sceneAssets.map(a => <label key={a.id} className="listItem" style={{ cursor: 'pointer' }}><span><input type="checkbox" checked={scenes.includes(a.id)} onChange={() => toggle(a.id)} /> {a.asset_type === 'video' ? 'Vídeo' : 'Imagen'} · {assetLabel(a)}{scenes.includes(a.id) ? ` · nº ${scenes.indexOf(a.id) + 1}` : ''}</span></label>)}
      </div>}
    </fieldset>
    <div style={{ marginTop: 10 }}><button type="button" onClick={() => void create()} disabled={!scenes.length || Boolean(busy)}>{busy || `Crear montaje de ${minutes} min`}</button></div>
  </section>
}
