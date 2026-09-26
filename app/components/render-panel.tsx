'use client'

import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { compositionIssues, formatSize, totalDurationMs, type Composition } from '@/lib/editor/composition'
import { downloadCompositionMedia, saveRender, type EditorAsset } from '@/lib/editor/client'
import { recordingSupported, renderComposition } from '@/lib/editor/renderer'
import { Icon } from './studio-icon'

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

/**
 * Preview and browser render for a composition. Before rendering it asks the parent to persist
 * the composition, then records a snapshot in its own render_jobs row.
 */
export function RenderPanel({ projectId, composition, assets, beforeRender, onRendered }: {
  projectId: string
  composition: Composition
  assets: EditorAsset[]
  beforeRender?: () => Promise<void>
  onRendered?: () => void
}) {
  const supabase = getSupabaseBrowserClient()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [mode, setMode] = useState<'idle' | 'loading' | 'preview' | 'render' | 'saving'>('idle')
  const [progress, setProgress] = useState({ elapsed: 0, total: 0 })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])

  const issues = compositionIssues(composition)
  const blocking = issues.some(i => i.blocking)
  const total = totalDurationMs(composition)
  const { width, height } = formatSize[composition.format]

  async function run(record: boolean) {
    if (mode !== 'idle') return
    setError(''); setStatus('')
    const controller = new AbortController()
    abortRef.current = controller
    let jobId: string | null = null
    try {
      if (record) await beforeRender?.()
      setMode('loading')
      const media = await downloadCompositionMedia(composition, assets, (d, t) => setStatus(`Descargando recursos ${d}/${t}…`))
      if (record) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('La sesión ha caducado.')
        const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: composition.format, status: 'rendering', composition }).select('id').single()
        if (e) throw new Error(e.message)
        jobId = (data as { id: string }).id
      }
      setMode(record ? 'render' : 'preview')
      setStatus(record ? 'Grabando en tiempo real. Mantén esta pestaña visible hasta que termine.' : 'Vista previa en reproducción.')
      const result = await renderComposition({
        composition, canvas: canvasRef.current!, media, record, signal: controller.signal,
        onProgress: (elapsed, t) => setProgress({ elapsed, total: t }),
      })
      if (controller.signal.aborted) {
        if (jobId) await supabase.from('render_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', jobId)
        setStatus('Cancelado.')
        return
      }
      if (record && result.blob && jobId) {
        const name = `${(composition.title || 'montaje').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}-${composition.format.replace(':', 'x')}.webm`
        setDownload({ url: URL.createObjectURL(result.blob), name })
        setMode('saving'); setStatus('Guardando el vídeo en la Biblioteca…')
        await saveRender(supabase, { projectId, jobId, composition, blob: result.blob, mimeType: result.mimeType ?? 'video/webm', durationMs: result.durationMs, assets })
        setStatus(`Vídeo guardado en la Biblioteca (${Math.round(result.blob.size / 1048576 * 10) / 10} MB).`)
        onRendered?.()
      } else if (!record) setStatus('Vista previa terminada.')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'El render falló.'
      setError(message)
      if (jobId) await supabase.from('render_jobs').update({ status: 'failed', error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', jobId)
    } finally {
      abortRef.current = null
      setMode('idle')
    }
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div className="cardHead" style={{ marginBottom: 0 }}>
      <h3>Vista previa y exportación</h3>
      <span className="pill">{composition.format} · {width}×{height} · {fmt(total)}</span>
    </div>
    <canvas ref={canvasRef} width={width} height={height} style={{ width: '100%', maxHeight: 420, objectFit: 'contain', background: '#000', borderRadius: 10 }} aria-label="Lienzo de vista previa" />
    {mode !== 'idle' && progress.total > 0 && <progress value={progress.elapsed} max={progress.total} style={{ width: '100%' }} aria-label="Progreso" />}
    {status && <p className="muted small" role="status">{status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {issues.length > 0 && <ul className="warnList">{issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
    {!recordingSupported() && <p className="warnBox">Este navegador no puede grabar vídeo desde canvas. Usa Chrome, Edge o Firefox de escritorio.</p>}
    <div className="pageActions">
      {mode === 'idle' ? <>
        <button type="button" className="ghost" disabled={blocking || composition.clips.length === 0} onClick={() => void run(false)}><Icon name="eye" size={16} />Vista previa</button>
        <button type="button" disabled={blocking || composition.clips.length === 0 || !recordingSupported()} onClick={() => void run(true)}><Icon name="video" size={16} />Renderizar y guardar</button>
      </> : <button type="button" className="ghost" onClick={() => abortRef.current?.abort()} disabled={mode === 'saving'}>Cancelar</button>}
      {download && <a className="buttonLink ghost" href={download.url} download={download.name}>Descargar WebM</a>}
    </div>
    <p className="muted small">El render se hace en tu navegador en tiempo real (un vídeo de 3 minutos tarda 3 minutos), sin coste externo. Salida WebM (VP9/VP8 + Opus); el bitrate se ajusta para no superar 50 MB. Los subtítulos se reparten por número de palabras: es una aproximación, no una alineación exacta.</p>
  </section>
}
