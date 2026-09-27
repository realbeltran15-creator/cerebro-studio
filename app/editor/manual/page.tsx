'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { RenderPanel } from '../../components/render-panel'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { audioStartMs, parseComposition, totalDurationMs, MAX_CLIP_MS, MIN_CLIP_MS, type AudioClip, type Clip, type Composition, type OutputFormat } from '@/lib/editor/composition'
import { addAudioClip, addClip, commit, fromClip, deleteAudioClip, deleteClip, duplicateClip, historyOf, moveAudioClip, moveClip, redo, splitClip, toManual, trimStart, undo, updateAudioClip, updateClip, type History } from '@/lib/editor/timeline'
import { assetLabel, audioDurationMs, musicTypes, visualTypes, voiceTypes, type EditorAsset } from '@/lib/editor/client'
import { SaveConflictError } from '@/lib/editor/jobs'

type Job = { id: string; project_id: string; status: string; updated_at: string; composition: unknown }
type Selection = { kind: 'clip' | 'audio'; id: string } | null

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`
const secs = (ms: number) => Math.round(ms / 100) / 10
const kindColor: Record<string, string> = { image: '#3b6fd8', video: '#8b5cf6', none: '#444', voice: '#2f9e6b', music: '#c77d1f', sfx: '#c0463a' }

export default function ManualEditorPage() {
  const supabase = getSupabaseBrowserClient()
  const [job, setJob] = useState<Job | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [pxPerSec, setPxPerSec] = useState(40)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [addAsset, setAddAsset] = useState('')
  const [addAudio, setAddAudio] = useState('')
  const [addAudioKind, setAddAudioKind] = useState<AudioClip['kind']>('music')
  const [splitAt, setSplitAt] = useState('')
  const [previewFromSelected, setPreviewFromSelected] = useState(false)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  const comp = history?.present ?? null
  const apply = useCallback((next: (c: Composition) => Composition) => {
    setHistory(h => (h ? commit(h, next(h.present)) : h)); setDirty(true); setNotice('')
  }, [])

  const load = useCallback(async () => {
    const id = new URLSearchParams(window.location.search).get('job')
    if (!id) { setError('Falta el montaje (?job=).'); return }
    const { data, error: e } = await supabase.from('render_jobs').select('id,project_id,status,updated_at,composition').eq('id', id).maybeSingle()
    if (e || !data) { setError(e?.message ?? 'Montaje no encontrado.'); return }
    const row = data as Job
    if (row.status !== 'draft') { setError('Solo se editan montajes guardados (borradores).'); return }
    const parsed = parseComposition(row.composition)
    if (!parsed) { setError('El montaje guardado no es válido.'); return }
    setJob(row); setSavedAt(row.updated_at)
    const { data: a } = await supabase.from('assets').select('id,asset_type,storage_path,license_status,source_provider,provenance,created_at').eq('project_id', row.project_id).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
    setAssets((a ?? []) as EditorAsset[])
    if (parsed.editedManually) { setHistory(historyOf(parsed)); return }
    // First time in manual mode: move clip voices to the audio track with their real length.
    setBusy('convert')
    const durations: Record<string, number> = {}
    for (const v of [...new Set(parsed.clips.map(c => c.voiceAssetId).filter((x): x is string => Boolean(x)))]) {
      durations[v] = await audioDurationMs(v).catch(() => 0) || 0
    }
    setHistory(historyOf(toManual(parsed, Object.fromEntries(Object.entries(durations).filter(([, ms]) => ms > 0)))))
    setDirty(true); setBusy('')
    setNotice('Montaje abierto en modo manual: las voces pasaron a la pista de audio enlazadas a su clip. Guarda para conservar el cambio.')
  }, [supabase])
  useEffect(() => { void load() }, [load])

  const save = useCallback(async () => {
    if (!job || !comp || !savedAt) return
    const { data, error: e } = await supabase.from('render_jobs').update({ composition: comp, output_format: comp.format, updated_at: new Date().toISOString() })
      .eq('id', job.id).eq('updated_at', savedAt).select('updated_at')
    if (e) throw new Error(e.message)
    if (!data?.length) throw new SaveConflictError()
    setSavedAt((data[0] as { updated_at: string }).updated_at); setDirty(false)
  }, [job, comp, savedAt, supabase])

  async function saveClick() {
    setError(''); setBusy('save')
    try { await save(); setNotice('Montaje guardado.') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setBusy('') }
  }

  // Keyboard: undo/redo and delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); setHistory(h => (h ? (e.shiftKey ? redo(h) : undo(h)) : h)); setDirty(true) }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); setHistory(h => (h ? redo(h) : h)); setDirty(true) }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault()
        apply(c => (selection.kind === 'clip' ? deleteClip(c, selection.id) : deleteAudioClip(c, selection.id)))
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apply, selection])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Thumbnails of the images used on the timeline (signed URLs, fetched once per asset).
  const imageIds = useMemo(() => [...new Set((history?.present.clips ?? []).map(c => c.visualAssetId).filter((id): id is string => Boolean(id) && assets.find(a => a.id === id)?.asset_type !== 'video'))].sort().join(','), [history, assets])
  useEffect(() => {
    const missing = imageIds ? imageIds.split(',').filter(id => !thumbs[id]) : []
    if (!missing.length) return
    let alive = true
    void Promise.all(missing.map(async id => {
      const r = await fetch(`/api/assets/${id}/signed-url`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({})) as { url?: string }
      return [id, j.url ?? ''] as const
    })).then(pairs => { if (alive) setThumbs(t => ({ ...t, ...Object.fromEntries(pairs.filter(([, u]) => u)) })) })
    return () => { alive = false }
  }, [imageIds, thumbs])

  const visuals = useMemo(() => assets.filter(a => visualTypes.includes(a.asset_type)), [assets])
  const audios = useMemo(() => assets.filter(a => voiceTypes.includes(a.asset_type) || musicTypes.includes(a.asset_type)), [assets])
  const typeOf = (id: string | null) => (id ? assets.find(a => a.id === id)?.asset_type ?? 'image' : 'none')
  const label = (id: string | null) => { const a = id ? assets.find(x => x.id === id) : undefined; return a ? assetLabel(a) : 'Sin visual' }

  // Pointer drag on the right edge of a clip changes its duration; on an audio block it moves it.
  const drag = useRef<{ kind: 'resize' | 'move'; id: string; startX: number; startValue: number } | null>(null)
  function onPointerDown(e: ReactPointerEvent, kind: 'resize' | 'move', id: string, startValue: number) {
    e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, id, startX: e.clientX, startValue }
    // Snapshot for undo: the drag then replaces `present` live without one entry per pixel.
    setHistory(h => (h ? { past: [...h.past, h.present].slice(-100), present: h.present, future: [] } : h))
  }
  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current
    if (!d) return
    const deltaMs = ((e.clientX - d.startX) / pxPerSec) * 1000
    // Live update without pushing a history entry per pixel: replace the present snapshot.
    setHistory(h => {
      if (!h) return h
      const next = d.kind === 'resize' ? updateClip(h.present, d.id, { durationMs: d.startValue + deltaMs }) : moveAudioClip(h.present, d.id, d.startValue + deltaMs)
      return { ...h, present: next }
    })
    setDirty(true)
  }
  function onPointerUp() {
    const d = drag.current
    drag.current = null
    // A click without movement leaves an identical snapshot on the undo stack: drop it.
    if (d) setHistory(h => (h && h.past.length && h.past[h.past.length - 1] === h.present ? { ...h, past: h.past.slice(0, -1) } : h))
  }

  if (!comp || !job) return <StudioShell title="Editor manual" eyebrow="POSTPRODUCCIÓN">
    {error ? <p className="error" role="alert">{error} <Link className="open" href="/editor">Volver al editor</Link></p> : <p className="muted">{busy === 'convert' ? 'Preparando el montaje (midiendo voces)…' : 'Cargando…'}</p>}
  </StudioShell>

  const total = totalDurationMs(comp)
  const selClip = selection?.kind === 'clip' ? comp.clips.find(c => c.id === selection.id) ?? null : null
  const selAudio = selection?.kind === 'audio' ? (comp.audioClips ?? []).find(a => a.id === selection.id) ?? null : null
  const width = Math.max(total / 1000 * pxPerSec, 600)
  const rows: Array<{ key: AudioClip['kind']; label: string }> = [{ key: 'voice', label: 'Voz' }, { key: 'music', label: 'Música' }, { key: 'sfx', label: 'Efectos' }]

  return <StudioShell title="Editor manual" eyebrow="POSTPRODUCCIÓN" actions={<Link className="buttonLink ghost" href={`/editor?project=${job.project_id}&storyboard=${comp.storyboardId}`}>Editor automático</Link>}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <div className="editorBar panel" style={{ marginBottom: 12 }}>
      <div className="stats">
        <span className="pill">{comp.clips.length} clips</span>
        <span className="pill info">{fmt(total)}</span>
        {dirty && <span className="pill warn">Cambios sin guardar</span>}
        <label className="small">Formato{' '}
          <select value={comp.format} onChange={e => apply(c => ({ ...c, format: e.target.value as OutputFormat }))}>
            <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
          </select>
        </label>
        <label className="small">Zoom timeline <input type="range" min={10} max={160} value={pxPerSec} onChange={e => setPxPerSec(Number(e.target.value))} /></label>
      </div>
      <div className="pageActions">
        <button type="button" className="ghost" disabled={!history?.past.length} onClick={() => { setHistory(h => (h ? undo(h) : h)); setDirty(true) }} title="Ctrl+Z">Deshacer</button>
        <button type="button" className="ghost" disabled={!history?.future.length} onClick={() => { setHistory(h => (h ? redo(h) : h)); setDirty(true) }} title="Ctrl+Shift+Z">Rehacer</button>
        <button type="button" onClick={() => void saveClick()} disabled={!dirty || busy === 'save'}>{busy === 'save' ? 'Guardando…' : 'Guardar montaje'}</button>
      </div>
    </div>

    <section className="panel" style={{ marginBottom: 12, overflowX: 'auto' }} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div style={{ width, position: 'relative' }}>
        <div className="muted small" style={{ position: 'relative', height: 18 }}>
          {Array.from({ length: Math.ceil(total / 1000 / 5) + 1 }, (_, i) => <span key={i} style={{ position: 'absolute', left: i * 5 * pxPerSec }}>{i * 5}s</span>)}
        </div>
        <div style={{ display: 'flex', height: 64, marginTop: 4 }} aria-label="Pista de vídeo">
          {comp.clips.map((clip, i) => <div key={clip.id} draggable
            onDragStart={e => { if (drag.current) { e.preventDefault(); return } setDragId(clip.id) }} onDragOver={e => e.preventDefault()}
            onDrop={() => { if (dragId && dragId !== clip.id) apply(c => moveClip(c, dragId, i)); setDragId(null) }}
            onClick={() => setSelection({ kind: 'clip', id: clip.id })}
            style={{ width: clip.durationMs / 1000 * pxPerSec, minWidth: 12, position: 'relative', flex: 'none', background: thumbs[clip.visualAssetId ?? ''] ? `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${thumbs[clip.visualAssetId ?? '']}) center / cover` : kindColor[typeOf(clip.visualAssetId)] ?? '#555', borderRadius: 6, marginRight: 2, padding: '4px 6px', overflow: 'hidden', cursor: 'grab', outline: selection?.id === clip.id ? '2px solid #fff' : 'none', color: '#fff', fontSize: 11 }}
            title={`${label(clip.visualAssetId)} · ${secs(clip.durationMs)} s`}>
            <b>{i + 1}</b> {label(clip.visualAssetId)}<br />{secs(clip.durationMs)} s{clip.transition === 'cut' ? ' · corte' : ''}{clip.text ? ' · T' : ''}{clip.muted ? ' · 🔇' : ''}
            <span onMouseDown={e => { e.preventDefault(); e.stopPropagation() }} onPointerDown={e => onPointerDown(e, 'resize', clip.id, clip.durationMs)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: 'rgba(255,255,255,0.35)' }} aria-label="Cambiar duración" />
          </div>)}
        </div>
        {rows.map(row => <div key={row.key} style={{ position: 'relative', height: 34, marginTop: 6, background: 'var(--bg-2)', borderRadius: 6 }} aria-label={`Pista de ${row.label}`}>
          <span className="muted small" style={{ position: 'absolute', left: 4, top: 8, pointerEvents: 'none' }}>{row.label}</span>
          {(comp.audioClips ?? []).filter(a => a.kind === row.key).map(a => {
            const start = audioStartMs(comp, a)
            return <div key={a.id} onClick={() => setSelection({ kind: 'audio', id: a.id })} onPointerDown={e => onPointerDown(e, 'move', a.id, start)}
              style={{ position: 'absolute', left: start / 1000 * pxPerSec, width: Math.max(a.durationMs / 1000 * pxPerSec, 8), top: 3, height: 28, background: kindColor[a.kind], opacity: a.muted ? 0.4 : 1, borderRadius: 5, color: '#fff', fontSize: 11, padding: '6px 6px', overflow: 'hidden', cursor: 'grab', outline: selection?.id === a.id ? '2px solid #fff' : 'none', whiteSpace: 'nowrap' }}
              title={`${label(a.assetId)} · ${secs(start)}–${secs(start + a.durationMs)} s${a.linkedClipId ? ' · enlazado a su clip' : ''}`}>
              {a.linkedClipId ? '🔗 ' : ''}{label(a.assetId)}
            </div>
          })}
        </div>)}
        {comp.musicAssetId && <p className="muted small" style={{ marginTop: 6 }}>Música de fondo global: {label(comp.musicAssetId)} ({Math.round(comp.musicVolume * 100)}%, {comp.duckMusic ? 'baja bajo la voz' : 'sin ducking'})</p>}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Arrastra los clips para reordenarlos y su borde derecho para cambiar la duración; arrastra los bloques de audio para moverlos (se desenlazan de su clip). Supr borra la selección; Ctrl+Z / Ctrl+Shift+Z deshacen y rehacen.</p>
    </section>

    <div className="field-row" style={{ alignItems: 'start', marginBottom: 12 }}>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3>Añadir</h3>
        <label>Clip de imagen o vídeo
          <select value={addAsset} onChange={e => setAddAsset(e.target.value)}><option value="">— Elegir de la Biblioteca</option>{visuals.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select>
        </label>
        <button type="button" className="ghost" disabled={!addAsset} onClick={() => { const at = selClip ? comp.clips.findIndex(c => c.id === selClip.id) + 1 : comp.clips.length; apply(c => addClip(c, addAsset, 5000, at)); setAddAsset('') }}>Añadir clip {selClip ? 'tras el seleccionado' : 'al final'}</button>
        <label>Audio
          <select value={addAudio} onChange={e => setAddAudio(e.target.value)}><option value="">— Elegir de la Biblioteca</option>{audios.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select>
        </label>
        <label>Pista<select value={addAudioKind} onChange={e => setAddAudioKind(e.target.value as AudioClip['kind'])}><option value="voice">Voz / voice-over</option><option value="music">Música</option><option value="sfx">Efecto</option></select></label>
        <button type="button" className="ghost" disabled={!addAudio || busy === 'audio'} onClick={() => void (async () => {
          setBusy('audio')
          const ms = await audioDurationMs(addAudio).catch(() => 5000)
          const linked = selClip && addAudioKind === 'voice' ? selClip.id : null
          apply(c => addAudioClip(c, { assetId: addAudio, kind: addAudioKind, linkedClipId: linked, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: Math.min(ms, addAudioKind === 'music' ? totalDurationMs(c) : ms), volume: addAudioKind === 'music' ? 0.3 : 1, muted: false }))
          setAddAudio(''); setBusy('')
        })()}>{busy === 'audio' ? 'Midiendo…' : addAudioKind === 'voice' && selClip ? 'Añadir enlazado al clip seleccionado' : 'Añadir al inicio'}</button>
        <Link className="open small" href={`/audio?project=${job.project_id}`}>Subir música o efectos →</Link>
      </section>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3>{selClip ? `Clip ${comp.clips.findIndex(c => c.id === selClip.id) + 1}` : selAudio ? 'Audio' : 'Selecciona un clip'}</h3>
        {selClip && <ClipInspector clip={selClip} isVideo={typeOf(selClip.visualAssetId) === 'video'} visuals={visuals} splitAt={splitAt} setSplitAt={setSplitAt}
          onChange={p => apply(c => updateClip(c, selClip.id, p))}
          onTrim={d => apply(c => trimStart(c, selClip.id, d))}
          onSplit={ms => { apply(c => splitClip(c, selClip.id, ms)); setSplitAt('') }}
          onDuplicate={() => apply(c => duplicateClip(c, selClip.id))}
          onDelete={() => { apply(c => deleteClip(c, selClip.id)); setSelection(null) }}
          onMove={dir => apply(c => moveClip(c, selClip.id, c.clips.findIndex(k => k.id === selClip.id) + dir))} />}
        {selAudio && <>
          <p className="small">{label(selAudio.assetId)} · {selAudio.linkedClipId ? 'enlazado a su clip' : 'posición absoluta'}</p>
          <div className="field-row">
            <label>Inicio (s)<input type="number" min={0} step={0.1} value={secs(audioStartMs(comp, selAudio))} onChange={e => apply(c => moveAudioClip(c, selAudio.id, Number(e.target.value) * 1000))} /></label>
            <label>Recortar inicio (s)<input type="number" min={0} step={0.1} value={secs(selAudio.trimInMs)} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { trimInMs: Math.max(0, Number(e.target.value) * 1000) }))} /></label>
            <label>Duración (s)<input type="number" min={0.1} step={0.1} value={secs(selAudio.durationMs)} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { durationMs: Number(e.target.value) * 1000 }))} /></label>
          </div>
          <label>Volumen ({Math.round(selAudio.volume * 100)}%)<input type="range" min={0} max={2} step={0.05} value={selAudio.volume} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { volume: Number(e.target.value) }))} /></label>
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={selAudio.muted} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { muted: e.target.checked }))} /> Silenciar</label>
          <div className="pageActions">
            {selClip === null && selAudio.linkedClipId === null && <span className="muted small">Para enlazarlo a un clip, bórralo y añádelo con ese clip seleccionado.</span>}
            <button type="button" className="ghost" onClick={() => { apply(c => deleteAudioClip(c, selAudio.id)); setSelection(null) }}>Eliminar audio</button>
          </div>
        </>}
      </section>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3>Montaje</h3>
        <label>Música de fondo
          <select value={comp.musicAssetId ?? ''} onChange={e => apply(c => ({ ...c, musicAssetId: e.target.value || null }))}><option value="">— Sin música</option>{assets.filter(a => musicTypes.includes(a.asset_type)).map(a => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select>
        </label>
        <label>Volumen de música ({Math.round(comp.musicVolume * 100)}%)<input type="range" min={0} max={1} step={0.05} value={comp.musicVolume} onChange={e => apply(c => ({ ...c, musicVolume: Number(e.target.value) }))} /></label>
        <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={comp.duckMusic} onChange={e => apply(c => ({ ...c, duckMusic: e.target.checked }))} /> Bajar música bajo la voz</label>
        <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={comp.subtitles} onChange={e => apply(c => ({ ...c, subtitles: e.target.checked }))} /> Subtítulos (texto de cada clip)</label>
        <label>Duración de los fundidos (ms)<input type="number" min={0} max={1500} step={50} value={comp.fadeMs} onChange={e => apply(c => ({ ...c, fadeMs: Math.min(Math.max(Number(e.target.value) || 0, 0), 1500) }))} /></label>
        <label>Hook inicial en pantalla<input value={comp.hookText ?? ''} maxLength={120} onChange={e => apply(c => ({ ...c, hookText: e.target.value || null }))} /></label>
      </section>
    </div>

    {selClip && comp.clips[0]?.id !== selClip.id && <label className="pill" style={{ marginBottom: 8 }}><input type="checkbox" checked={previewFromSelected} onChange={e => setPreviewFromSelected(e.target.checked)} /> Vista previa desde el clip seleccionado (sin render)</label>}
    {previewFromSelected && selClip && comp.clips[0]?.id !== selClip.id
      ? <RenderPanel key={`preview-${selClip.id}`} projectId={job.project_id} composition={fromClip(comp, selClip.id)} assets={assets} previewOnly />
      : <RenderPanel key="full" projectId={job.project_id} composition={comp} assets={assets} beforeRender={dirty ? save : undefined} />}
  </StudioShell>
}

function ClipInspector({ clip, isVideo, visuals, splitAt, setSplitAt, onChange, onTrim, onSplit, onDuplicate, onDelete, onMove }: {
  clip: Clip; isVideo: boolean; visuals: EditorAsset[]; splitAt: string; setSplitAt: (v: string) => void
  onChange: (p: Partial<Clip>) => void; onTrim: (deltaMs: number) => void; onSplit: (ms: number) => void; onDuplicate: () => void; onDelete: () => void; onMove: (dir: -1 | 1) => void
}) {
  const splitMs = Math.round(Number(splitAt) * 1000)
  const canSplit = splitMs >= MIN_CLIP_MS && clip.durationMs - splitMs >= MIN_CLIP_MS
  return <>
    <label>Imagen o vídeo
      <select value={clip.visualAssetId ?? ''} onChange={e => onChange({ visualAssetId: e.target.value || null, trimInMs: 0 })}><option value="">— Sin visual (negro)</option>{visuals.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select>
    </label>
    <div className="field-row">
      <label>Duración (s)<input type="number" min={MIN_CLIP_MS / 1000} max={MAX_CLIP_MS / 1000} step={0.1} value={secs(clip.durationMs)} onChange={e => onChange({ durationMs: Number(e.target.value) * 1000 })} /></label>
      {isVideo && <label>Inicio en el vídeo (s)<input type="number" min={0} step={0.1} value={secs(clip.trimInMs ?? 0)} onChange={e => onTrim(Number(e.target.value) * 1000 - (clip.trimInMs ?? 0))} /></label>}
      <label>Transición al siguiente<select value={clip.transition ?? 'fade'} onChange={e => onChange({ transition: e.target.value as Clip['transition'] })}><option value="fade">Fundido</option><option value="cut">Corte</option></select></label>
    </div>
    <div className="field-row">
      <label>Zoom ({(clip.zoom ?? 1).toFixed(2)}×)<input type="range" min={1} max={3} step={0.05} value={clip.zoom ?? 1} onChange={e => onChange({ zoom: Number(e.target.value) })} /></label>
      <label>Posición horizontal<input type="range" min={0} max={1} step={0.01} value={clip.focusX ?? 0.5} onChange={e => onChange({ focusX: Number(e.target.value) })} /></label>
      <label>Posición vertical<input type="range" min={0} max={1} step={0.01} value={clip.focusY ?? 0.5} onChange={e => onChange({ focusY: Number(e.target.value) })} /></label>
    </div>
    {!isVideo && <label>Movimiento<select value={clip.motion} onChange={e => onChange({ motion: e.target.value as Clip['motion'] })}><option value="kenburns">Zoom lento</option><option value="none">Fijo</option></select></label>}
    {isVideo && <div className="field-row">
      <label>Volumen del vídeo ({Math.round((clip.volume ?? 1) * 100)}%)<input type="range" min={0} max={2} step={0.05} value={clip.volume ?? 1} onChange={e => onChange({ volume: Number(e.target.value) })} /></label>
      <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={clip.muted === true} onChange={e => onChange({ muted: e.target.checked })} /> Silenciar</label>
    </div>}
    <label>Subtítulo de este clip<textarea className="viText" value={clip.narration ?? ''} onChange={e => onChange({ narration: e.target.value || null })} /></label>
    <div className="field-row">
      <label>Texto en pantalla<input value={clip.text?.content ?? ''} maxLength={200} onChange={e => onChange({ text: e.target.value ? { content: e.target.value, position: clip.text?.position ?? 'center', sizePct: clip.text?.sizePct ?? 6 } : null })} /></label>
      <label>Posición del texto<select value={clip.text?.position ?? 'center'} disabled={!clip.text} onChange={e => clip.text && onChange({ text: { ...clip.text, position: e.target.value as 'top' | 'center' | 'bottom' } })}><option value="top">Arriba</option><option value="center">Centro</option><option value="bottom">Abajo</option></select></label>
      <label>Tamaño<input type="range" min={2} max={15} step={0.5} value={clip.text?.sizePct ?? 6} disabled={!clip.text} onChange={e => clip.text && onChange({ text: { ...clip.text, sizePct: Number(e.target.value) } })} /></label>
    </div>
    <div className="field-row" style={{ alignItems: 'end' }}>
      <label>Dividir en (s desde el inicio del clip)<input type="number" min={1} step={0.1} value={splitAt} onChange={e => setSplitAt(e.target.value)} placeholder={`1 – ${secs(clip.durationMs - MIN_CLIP_MS)}`} /></label>
      <button type="button" className="ghost" disabled={!canSplit} onClick={() => onSplit(splitMs)}>Dividir</button>
    </div>
    <div className="pageActions">
      <button type="button" className="ghost" onClick={() => onMove(-1)}>← Mover</button>
      <button type="button" className="ghost" onClick={() => onMove(1)}>Mover →</button>
      <button type="button" className="ghost" onClick={onDuplicate}>Duplicar</button>
      <button type="button" className="ghost" onClick={onDelete}>Eliminar</button>
    </div>
  </>
}
