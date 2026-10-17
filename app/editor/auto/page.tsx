'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { RenderPanel } from '../../components/render-panel'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { assetLabel, musicTypes, signedUrl, type EditorAsset } from '@/lib/editor/client'
import { autoComposition, defaultAutoEdit, detectShots, findSilences, planSegments, summarize, type AutoEditOptions, type Interval } from '@/lib/editor/auto-edit'
import { frameDifferences, loudness } from '@/lib/editor/analyze'
import { applyStyle, type EditStyle } from '@/lib/editor/style'
import { loadStyles } from '@/lib/editor/styles-store'
import type { Composition } from '@/lib/editor/composition'
import type { ProjectRow } from '@/lib/types/database'

type Analysis = { durationMs: number; rms: number[]; diffs: number[] }
const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`

export default function AutoEditPage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [videoId, setVideoId] = useState('')
  const [musicId, setMusicId] = useState('')
  const [opts, setOpts] = useState<AutoEditOptions>(defaultAutoEdit)
  const [styles, setStyles] = useState<EditStyle[]>([])
  const [styleName, setStyleName] = useState('')
  const [useCaptions, setUseCaptions] = useState(true)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ jobId: string; comp: Composition; changes: string[] } | null>(null)

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('project')
    void (async () => {
      const { data } = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows); setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
      const s = await loadStyles(supabase); setStyles(s)
    })()
  }, [supabase])

  useEffect(() => {
    if (!projectId) return
    setAnalysis(null); setCreated(null); setVideoId('')
    void (async () => {
      const { data } = await supabase.from('assets').select('id,asset_type,storage_path,license_status,source_provider,provenance,created_at').eq('project_id', projectId).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
      setAssets((data ?? []) as EditorAsset[])
    })()
  }, [projectId, supabase])

  const videos = useMemo(() => assets.filter(a => a.asset_type === 'video'), [assets])
  const music = useMemo(() => assets.filter(a => musicTypes.includes(a.asset_type)), [assets])
  const subtitle = useMemo(() => assets.find(a => a.asset_type === 'subtitle' && a.provenance?.sourceAssetId === videoId), [assets, videoId])

  const plan = useMemo(() => {
    if (!analysis) return null
    const silences: Interval[] = analysis.rms.length ? findSilences(analysis.rms, 50, opts.silenceThreshold, opts.minSilenceMs) : []
    const shots = detectShots(analysis.diffs, 4)
    const segments = planSegments(analysis.durationMs, silences, shots, opts)
    return { silences, shots, segments, ...summarize(analysis.durationMs, segments) }
  }, [analysis, opts])

  async function analyze() {
    if (!videoId) return
    setBusy(true); setError(''); setCreated(null); setAnalysis(null)
    try {
      setProgress('Descargando el vídeo de la nube…')
      const blob = await (await fetch(await signedUrl(videoId))).blob()
      setProgress('Midiendo el audio (silencios)…')
      const a = await loudness(blob, 50)
      const f = await frameDifferences(blob, 4, p => setProgress(`Buscando cambios de plano… ${Math.round(p * 100)} %`))
      setAnalysis({ durationMs: f.durationMs || a.durationMs, rms: a.rms, diffs: f.diffs })
      setProgress('')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo analizar el vídeo.'); setProgress('') } finally { setBusy(false) }
  }

  async function transcribeNow() {
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: videoId, language: 'es' }) })
      const j = await r.json() as { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'No se pudo transcribir.')
      const { data } = await supabase.from('assets').select('id,asset_type,storage_path,license_status,source_provider,provenance,created_at').eq('project_id', projectId).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
      setAssets((data ?? []) as EditorAsset[])
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo transcribir.') } finally { setBusy(false) }
  }

  async function create() {
    if (!plan || !plan.segments.length) return
    setBusy(true); setError('')
    try {
      const video = videos.find(v => v.id === videoId)
      const segs = Array.isArray(subtitle?.provenance?.segments) ? subtitle!.provenance!.segments as Array<{ start: number; end: number; text: string }> : []
      let comp = autoComposition({
        assetId: videoId, title: `Montaje automático · ${video ? assetLabel(video) : ''}`.slice(0, 120), segments: plan.segments, options: opts, musicAssetId: musicId || null,
        captions: useCaptions ? segs.map(s => ({ start: s.start * 1000, end: s.end * 1000, text: s.text })) : [],
      })
      let changes: string[] = []
      const style = styles.find(s => s.name === styleName)
      if (style) { const r = applyStyle(comp, style, id => (id === videoId ? 'video' : 'other')); comp = { ...r.composition, format: opts.format }; changes = r.changes }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: comp.format, status: 'draft', composition: comp }).select('id').single()
      if (e) throw new Error(e.message)
      setCreated({ jobId: (data as { id: string }).id, comp, changes })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el montaje.') } finally { setBusy(false) }
  }

  const set = <K extends keyof AutoEditOptions>(k: K, v: AutoEditOptions[K]) => setOpts(o => ({ ...o, [k]: v }))

  return <StudioShell title="Montaje automático" eyebrow="POSTPRODUCCIÓN" actions={<Link className="buttonLink ghost" href="/editor">Editor</Link>}>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="hero"><div><small>EDICIÓN AUTOMÁTICA · GRATIS · EN TU NAVEGADOR</small><h2>Del bruto al montaje en un clic</h2><p>Quita silencios (jump cuts), corta en cada cambio de plano, divide las tomas largas, pone transiciones, música y subtítulos. Puedes aplicar un estilo que haya aprendido de ti. Después lo retocas en el editor manual o lo exportas en MP4.</p></div></div>

    <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <div className="field-row">
        <label>Proyecto<select value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Vídeo en bruto<select value={videoId} onChange={e => { setVideoId(e.target.value); setAnalysis(null); setCreated(null) }}><option value="">— Elige un vídeo</option>{videos.map(v => <option key={v.id} value={v.id}>{assetLabel(v)}</option>)}</select></label>
        <label>Música (opcional)<select value={musicId} onChange={e => setMusicId(e.target.value)}><option value="">— Sin música</option>{music.map(m => <option key={m.id} value={m.id}>{assetLabel(m)}</option>)}</select></label>
      </div>
      {videos.length === 0 && <p className="muted small">No hay vídeos en este proyecto. <Link className="open" href="/library">Súbelo en la Biblioteca</Link>.</p>}
      <div className="field-row">
        <label>Formato<select value={opts.format} onChange={e => set('format', e.target.value as AutoEditOptions['format'])}><option value="9:16">9:16 (Shorts, Reels, TikTok)</option><option value="16:9">16:9 (YouTube)</option><option value="1:1">1:1</option></select></label>
        <label>Transiciones<select value={opts.transition} onChange={e => set('transition', e.target.value as AutoEditOptions['transition'])}><option value="fade_on_shots">Fundido en cambios de plano, corte en el resto</option><option value="cut">Solo cortes secos</option><option value="fade">Fundido siempre</option></select></label>
        <label>Duración máxima de clip ({secs(opts.maxClipMs)})<input type="range" min={2000} max={15000} step={500} value={opts.maxClipMs} onChange={e => set('maxClipMs', Number(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={opts.removeSilences} onChange={e => set('removeSilences', e.target.checked)} /> Quitar silencios</label>
        <label>Silencio a partir de ({secs(opts.minSilenceMs)})<input type="range" min={300} max={2000} step={100} value={opts.minSilenceMs} onChange={e => set('minSilenceMs', Number(e.target.value))} disabled={!opts.removeSilences} /></label>
        <label>Sensibilidad al silencio ({Math.round(opts.silenceThreshold * 100)} %)<input type="range" min={0.02} max={0.2} step={0.01} value={opts.silenceThreshold} onChange={e => set('silenceThreshold', Number(e.target.value))} disabled={!opts.removeSilences} /></label>
        <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={opts.cutOnShots} onChange={e => set('cutOnShots', e.target.checked)} /> Cortar en cambios de plano</label>
      </div>
      <div className="field-row">
        <label>Aplicar mi estilo<select value={styleName} onChange={e => setStyleName(e.target.value)}><option value="">— Ninguno</option>{styles.map(s => <option key={s.name} value={s.name}>{s.name} · {s.samples} sesión{s.samples === 1 ? '' : 'es'}</option>)}</select></label>
        <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={useCaptions} disabled={!subtitle} onChange={e => setUseCaptions(e.target.checked)} /> Subtítulos de la transcripción</label>
        {videoId && !subtitle && <button type="button" className="ghost" disabled={busy} onClick={() => void transcribeNow()}>Transcribir para subtítulos</button>}
      </div>
      {styles.length === 0 && <p className="muted small">Consejo: en el <Link className="open" href="/editor">editor manual</Link> pulsa «Grabar mi forma de editar» y Cerebro aprenderá tu estilo para aplicarlo aquí.</p>}
      <div className="pageActions">
        <button type="button" disabled={!videoId || busy} onClick={() => void analyze()}>{busy && progress ? progress : 'Analizar vídeo'}</button>
        {plan && <button type="button" disabled={busy || !plan.segments.length} onClick={() => void create()}>Crear montaje ({plan.clips} clips)</button>}
      </div>
      {plan && <p className="small">Duración {secs(analysis!.durationMs)} → <b>{secs(plan.kept)}</b> · {plan.silences.length} silencios quitados ({secs(plan.removed)}) · {plan.shots.length} cambios de plano · {plan.clips} clips{analysis!.rms.length === 0 ? ' · el vídeo no tiene audio: no se quitan silencios' : ''}</p>}
    </section>

    {created && <>
      <p className="notice" role="status">Montaje creado. {created.changes.length ? `Estilo aplicado: ${created.changes.join(' ')} ` : ''}<Link className="open" href={`/editor/manual?job=${created.jobId}`}>Abrir en el editor manual →</Link></p>
      <RenderPanel projectId={projectId} composition={created.comp} assets={assets} />
    </>}
  </StudioShell>
}
