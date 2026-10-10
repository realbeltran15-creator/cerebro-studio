'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { compositionIssues, formatSize, totalDurationMs, type Composition } from '@/lib/editor/composition'
import { downloadCompositionMedia, saveDerivedVideo, saveRender, type EditorAsset } from '@/lib/editor/client'
import { transcodeConfigFromEnv, transcodeToCompatibleMp4 } from '@/lib/editor/transcode'
import { recordingSupported, renderComposition } from '@/lib/editor/renderer'
import { containerOf, instagramReadiness } from '@/lib/editor/container'
import { Icon } from './studio-icon'

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

/**
 * Preview and browser render for a composition. Before rendering it asks the parent to persist
 * the composition, then records a snapshot in its own render_jobs row.
 */
export function RenderPanel({ projectId, composition, assets, beforeRender, onRendered, previewOnly, autoStart }: {
  projectId: string
  composition: Composition
  assets: EditorAsset[]
  beforeRender?: () => Promise<void>
  onRendered?: () => void
  /** Only preview (e.g. a partial composition); rendering is disabled. */
  previewOnly?: boolean
  /** Start the recorded render by itself once when the panel opens (the Shorts approval screen). Needs a visible tab. */
  autoStart?: boolean
}) {
  const supabase = getSupabaseBrowserClient()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  // Why the current run was aborted: recorded on the render job so a cancelled render is explained.
  const abortReason = useRef<'user' | 'unmount'>('user')
  const [mode, setMode] = useState<'idle' | 'loading' | 'preview' | 'render' | 'saving'>('idle')
  const [progress, setProgress] = useState({ elapsed: 0, total: 0 })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null)
  // The last saved render, kept so it can be converted to an Instagram-ready MP4 without rendering again.
  const [saved, setSaved] = useState<{ blob: Blob; assetId: string; mimeType: string } | null>(null)
  const [converting, setConverting] = useState<number | null>(null)
  const convertConfig = transcodeConfigFromEnv()

  useEffect(() => () => { abortReason.current = 'unmount'; abortRef.current?.abort() }, [])
  // Leaving or reloading the tab kills a real-time render: ask before losing it.
  useEffect(() => {
    if (mode !== 'render' && mode !== 'saving') return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [mode])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])

  const autoStarted = useRef(false)
  const issues = compositionIssues(composition)
  const blocking = issues.some(i => i.blocking)
  const total = totalDurationMs(composition)
  const { width, height } = formatSize[composition.format]
  useEffect(() => {
    if (!autoStart || previewOnly || autoStarted.current || blocking || composition.clips.length === 0 || !recordingSupported()) return
    autoStarted.current = true
    void run(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  async function run(record: boolean) {
    // Synchronous guard: state updates are async, so repeated clicks during the save would pass a mode check.
    if (busyRef.current) return
    busyRef.current = true
    setMode('loading'); setError(''); setStatus(record ? 'Guardando el montaje…' : '')
    const controller = new AbortController()
    abortRef.current = controller
    abortReason.current = 'user'
    let jobId: string | null = null
    try {
      if (record) await beforeRender?.()
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
        const reason = (abortReason.current as string) === 'unmount' ? 'Cancelado: se salió del editor antes de terminar el render.' : 'Cancelado por el usuario.'
        if (jobId) await supabase.from('render_jobs').update({ status: 'cancelled', error: reason, updated_at: new Date().toISOString() }).eq('id', jobId)
        setStatus(`${reason} No se ha guardado ningún vídeo.`)
        return
      }
      if (record && result.blob && jobId) {
        const name = `${(composition.title || 'montaje').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}-${composition.format.replace(':', 'x')}.${containerOf(result.mimeType)}`
        setDownload({ url: URL.createObjectURL(result.blob), name })
        setMode('saving'); setStatus('Guardando el vídeo en la nube…')
        const savedAsset = await saveRender(supabase, { projectId, jobId, composition, blob: result.blob, mimeType: result.mimeType ?? 'video/webm', durationMs: result.durationMs, assets, onUploadProgress: f => setStatus(`Subiendo a la nube… ${Math.round(f * 100)} %`) })
        setSaved({ blob: result.blob, assetId: savedAsset.id, mimeType: result.mimeType ?? 'video/webm' })
        const ig = instagramReadiness(result.mimeType)
        setStatus(`Vídeo guardado en la Biblioteca (${Math.round(result.blob.size / 1048576 * 10) / 10} MB).${ig.ok ? '' : ` Aviso: ${ig.reason}`}`)
        onRendered?.()
      } else if (!record) setStatus('Vista previa terminada.')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'El render falló.'
      setError(message)
      if (jobId) await supabase.from('render_jobs').update({ status: 'failed', error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', jobId)
    } finally {
      abortRef.current = null
      busyRef.current = false
      setMode('idle')
    }
  }

  async function convert() {
    if (!saved || !convertConfig || converting !== null) return
    setError(''); setConverting(0); setStatus('Convirtiendo a MP4 compatible (H.264 + AAC). Puede tardar; no cierres la pestaña…')
    try {
      const out = await transcodeToCompatibleMp4(saved.blob, { config: convertConfig, onProgress: setConverting })
      setStatus('Guardando el MP4 convertido en la Biblioteca…')
      await saveDerivedVideo(supabase, { projectId, sourceAssetId: saved.assetId, blob: out.blob, mimeType: out.mimeType, codecs: out.codecs, tool: 'ffmpeg.wasm' })
      setDownload(d => { if (d) URL.revokeObjectURL(d.url); return { url: URL.createObjectURL(out.blob), name: `${(composition.title || 'montaje').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}-h264.mp4` } })
      setSaved(null)
      setStatus('MP4 compatible con Instagram guardado en la Biblioteca (H.264 + AAC). El original se conserva.')
      onRendered?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo convertir el vídeo.'); setStatus('') } finally { setConverting(null) }
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
        <button type="button" className="ghost" disabled={blocking || composition.clips.length === 0} onClick={() => void run(false)}><Icon name="eye" size={16} />Vista previa (no guarda)</button>
        {!previewOnly && <button type="button" disabled={blocking || composition.clips.length === 0 || !recordingSupported()} onClick={() => void run(true)}><Icon name="video" size={16} />Renderizar y guardar</button>}
      </> : <button type="button" className="ghost" onClick={() => { if (mode !== 'render' || window.confirm('¿Cancelar el render? No se guardará el vídeo.')) abortRef.current?.abort() }} disabled={mode === 'saving'}>{mode === 'render' ? 'Cancelar render' : 'Detener vista previa'}</button>}
      {download && <a className="buttonLink ghost" href={download.url} download={download.name}>Descargar {/\.mp4$/i.test(download.name) ? 'MP4' : 'WebM'}</a>}
    </div>
    {saved && mode === 'idle' && !instagramReadiness(saved.mimeType).ok && <div className="warnBox small" role="status">
      <p>{instagramReadiness(saved.mimeType).reason}</p>
      {convertConfig
        ? <div className="pageActions"><button type="button" className="ghost small" disabled={converting !== null} onClick={() => void convert()}>{converting !== null ? `Convirtiendo… ${Math.round(converting * 100)} %` : 'Convertir a MP4 compatible (H.264 + AAC)'}</button></div>
        : <p className="muted small">La conversión en el navegador no está activada en este despliegue; renderiza con Chrome, Edge o Safari para obtener un MP4 compatible.</p>}
    </div>}
    {download && mode === 'idle' && !error && <p className="notice" role="status">Guardado en la Biblioteca. Siguiente: <Link className="open" href={`/repurpose?project=${projectId}`}>versión vertical</Link> · <Link className="open" href={`/youtube?project=${projectId}`}>preparar YouTube</Link> · <Link className="open" href={`/social?project=${projectId}`}>preparar Instagram / TikTok</Link>. Preparar no publica.</p>}
    <p className="muted small">«Vista previa» solo reproduce el montaje; «Renderizar y guardar» graba el vídeo y lo guarda en la Biblioteca. El render se hace en tu navegador en tiempo real (un vídeo de 3 minutos tarda 3 minutos): mantén la pestaña abierta y visible hasta que termine. Sin coste externo. Salida WebM (VP9/VP8 + Opus); el bitrate se ajusta para no superar 50 MB. Los subtítulos se reparten por número de palabras: es una aproximación, no una alineación exacta.</p>
  </section>
}
