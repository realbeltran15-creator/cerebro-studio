'use client'

import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Composition } from '@/lib/editor/composition'
import { startAnalysis, type AnalysisHandle } from '@/lib/editor/analysis-client'
import { measureReference, referenceToStyle, type ReferenceMetrics } from '@/lib/editor/reference'
import { applyStyle, type EditStyle, type VisualKind } from '@/lib/editor/style'
import { loadStyles, saveStyles } from '@/lib/editor/styles-store'

const FPS = 8
const MAX_BYTES = 4 * 1024 * 1024 * 1024
const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`

/**
 * Reference videos. The file is read on THIS device (it is never uploaded or stored); what remains is a handful of numbers about its rhythm.
 * The numbers become an editing style that is saved and applied like any other, so a similar pace can be reproduced without copying the video.
 */
export function EditorReferencePanel({ comp, kindOf, beatsMs, apply, onNotice, onStylesChanged }: {
  comp: Composition; kindOf: (id: string | null) => VisualKind; beatsMs: number[]
  apply: (fn: (c: Composition) => Composition) => void; onNotice: (msg: string) => void; onStylesChanged: () => void
}) {
  const supabase = getSupabaseBrowserClient()
  const [label, setLabel] = useState('')
  const [progress, setProgress] = useState<{ f: number; stage: string } | null>(null)
  const [metrics, setMetrics] = useState<ReferenceMetrics | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const handle = useRef<AnalysisHandle | null>(null)
  useEffect(() => () => handle.current?.cancel(), [])

  async function analyse(file: File | undefined) {
    if (!file) return
    setError(''); setMetrics(null); setSaved('')
    if (!file.type.startsWith('video/')) { setError('Elige un archivo de vídeo.'); return }
    if (file.size > MAX_BYTES) { setError('El vídeo supera 4 GB: elige uno más corto.'); return }
    setProgress({ f: 0, stage: 'Leyendo el audio' })
    const h = startAnalysis({ kind: 'blob', blob: file }, { rms: { windowMs: 50 }, beats: true, frames: { fps: FPS } }, (f, stage) => setProgress({ f: stage === 'audio' ? f / 2 : 0.5 + f / 2, stage: stage === 'audio' ? 'Midiendo el audio' : 'Buscando los cortes' }))
    handle.current = h
    try {
      const r = await h.promise
      if (!r.hasVideo || !r.diffs?.length) { setError('No se pudo leer el vídeo en este navegador (formato o códec no compatible). Prueba con un MP4 H.264, WebM o MOV.'); return }
      setMetrics(measureReference({ label: label || file.name.replace(/\.[^.]+$/, ''), durationMs: r.durationMs, diffs: r.diffs, fps: FPS, rms: r.rms, rmsWindowMs: r.rmsWindowMs, beats: r.beats, width: r.width ?? undefined, height: r.height ?? undefined, hasAudio: r.hasAudio }))
    } catch (e) { if ((e as Error)?.name !== 'AbortError') setError(e instanceof Error ? e.message : 'No se pudo analizar el vídeo.') } finally { setProgress(null); handle.current = null }
  }

  async function saveStyle() {
    if (!metrics) return
    try {
      const style: EditStyle = referenceToStyle({ ...metrics, label: label.trim() || metrics.label })
      const current = await loadStyles(supabase)
      await saveStyles(supabase, [style, ...current.filter(s => s.name !== style.name)])
      setSaved(style.name); onStylesChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el estilo.') }
  }
  function applyNow() {
    if (!metrics) return
    const r = applyStyle(comp, referenceToStyle(metrics), kindOf, { beatsMs })
    apply(() => r.composition)
    onNotice(`Ritmo de la referencia aplicado (puedes deshacerlo): ${r.changes.join(' ')}`)
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }} aria-label="Vídeo de referencia">
    <div className="cardHead" style={{ marginBottom: 0 }}><h3>Vídeo de referencia</h3><span className="pill">Privado · en tu navegador</span></div>
    <p className="muted small">Elige un vídeo cuyo ritmo te guste. Se analiza aquí, sin subirlo, y solo se conservan números: cuánto duran los planos, cuántos cortes hay por minuto, si los cortes siguen la música. No se guarda ninguna imagen, audio ni el nombre del archivo.</p>
    <div className="field-row" style={{ alignItems: 'end' }}>
      <label>Nombre (opcional)<input value={label} maxLength={60} onChange={e => setLabel(e.target.value)} placeholder="Ritmo rápido tipo vlog" /></label>
      <label>Vídeo<input type="file" accept="video/*" disabled={!!progress} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void analyse(f) }} /></label>
    </div>
    {progress && <div role="status" aria-live="polite">
      <progress value={progress.f} max={1} style={{ width: '100%' }} aria-label="Progreso del análisis" /> <span className="small">{progress.stage} · {Math.round(progress.f * 100)} %</span>{' '}
      <button type="button" className="ghost" onClick={() => handle.current?.cancel()}>Cancelar</button>
      <p className="muted small">Se analiza en segundo plano: puedes seguir editando.</p>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {metrics && <div className="panel" style={{ background: 'transparent' }} aria-label="Resultado de la referencia">
      <div className="stats" style={{ marginBottom: 8 }}>
        <span className="pill info">{metrics.shots.cutsPerMinute} cortes/min</span><span className="pill">Plano típico {secs(metrics.shots.medianMs)}</span><span className="pill">{secs(metrics.shots.p10Ms)} – {secs(metrics.shots.p90Ms)}</span>
        {metrics.audio.bpm && (metrics.audio.bpmConfidence ?? 0) >= 0.2 && <span className="pill">~{Math.round(metrics.audio.bpm)} BPM</span>}
        {metrics.audio.cutsOnBeatShare !== null && <span className="pill">{Math.round(metrics.audio.cutsOnBeatShare * 100)} % de cortes en pulso</span>}
      </div>
      <RhythmStrip m={metrics} />
      <ul className="small" style={{ margin: '8px 0 6px 18px' }}>{referenceToStyle(metrics).observations.map(o => <li key={o}>{o}</li>)}</ul>
      <ul className="muted small" style={{ margin: '0 0 8px 18px' }}>{metrics.notes.map(n => <li key={n}>{n}</li>)}</ul>
      <div className="pageActions">
        <button type="button" onClick={() => void saveStyle()} disabled={!!saved}>{saved ? 'Guardado como estilo' : 'Guardar como estilo'}</button>
        <button type="button" className="ghost" disabled={comp.clips.length === 0} onClick={applyNow}>Aplicar este ritmo a mi montaje</button>
        <button type="button" className="ghost" onClick={() => { setMetrics(null); setSaved('') }}>Descartar</button>
      </div>
      {saved && <p className="notice small" role="status">Estilo «{saved}» guardado en tu cuenta; aparece en «Aprende de mí» junto a los demás.</p>}
    </div>}
  </section>
}

/** The reference's cut rhythm as a strip: each shot is a block, so fast and slow stretches are visible at a glance. */
function RhythmStrip({ m }: { m: ReferenceMetrics }) {
  const W = 720, bounds = [0, ...m.cutsMs, m.durationMs]
  return <svg role="img" aria-label={`Ritmo de cortes de la referencia: ${m.shots.count} planos`} width="100%" viewBox={`0 0 ${W} 28`} style={{ maxWidth: 820 }}>
    {bounds.slice(1).map((b, i) => <rect key={i} x={bounds[i] / m.durationMs * W} y={2} width={Math.max((b - bounds[i]) / m.durationMs * W - 1, 1)} height={24} fill={i % 2 ? '#2f62c4' : '#7c4fe0'} />)}
  </svg>
}
