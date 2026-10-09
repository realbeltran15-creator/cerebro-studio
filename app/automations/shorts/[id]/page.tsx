'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StudioShell } from '../../../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { REASONS, STATUS_LABEL } from '@/lib/shorts/labels'
import { pickMime, renderShort, type RenderedVideo } from '@/lib/shorts/render-client'
import type { Facts, GateResult, Manifest, Script } from '@/lib/shorts/types'
import css from '../shorts.module.css'

type ShortFull = {
  id: string; status: string; topic: string | null; title: string | null; description: string | null; category: string | null
  discard_reason: string | null; discard_detail: Record<string, any>; topic_selection: Record<string, any>
  facts: Partial<Facts>; script: Partial<Script>; manifest: Manifest | Record<string, never>; quality: { gates?: GateResult[]; all_pass?: boolean }
  video_id: string | null; error: string | null
}
type Retention = { observed: Record<string, any>; calculated: Record<string, any> }

const RENDERABLE = ['ready_for_approval', 'approved', 'upload_failed']

function Hook({ hook, datum }: { hook: string; datum: string }) {
  const at = datum ? hook.toLowerCase().indexOf(datum.toLowerCase()) : -1
  if (at < 0) return <span>{hook}</span>
  return <span>{hook.slice(0, at)}<mark>{hook.slice(at, at + datum.length)}</mark>{hook.slice(at + datum.length)}</span>
}

export default function ShortApprovalPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = getSupabaseBrowserClient()
  const [short, setShort] = useState<ShortFull | null>(null)
  const [retention, setRetention] = useState<Retention | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [video, setVideo] = useState<RenderedVideo | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [renderError, setRenderError] = useState('')
  const [seenSources, setSeenSources] = useState(false)
  const [seenHook, setSeenHook] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [note, setNote] = useState('')
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const rendering = useRef(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('shorts').select('*').eq('id', id).maybeSingle()
    if (error) { setMessage(error.message); return null }
    setShort(data as ShortFull)
    if (data?.video_id) {
      const { data: snap } = await supabase.from('metric_snapshots').select('observed,calculated').eq('platform', 'youtube').eq('external_content_id', data.video_id).eq('observed->>kind', 'shorts_retention_7d').limit(1).maybeSingle()
      setRetention((snap as Retention) ?? null)
    }
    return data as ShortFull | null
  }, [id, supabase])
  useEffect(() => { void load() }, [load])

  // El render MP4 empieza solo al abrir la pantalla (en este navegador, sin servidor de render).
  useEffect(() => {
    if (!short || rendering.current || video || !RENDERABLE.includes(short.status) || !('scenes' in short.manifest)) return
    rendering.current = true
    const m = short.manifest as Manifest
    void (async () => {
      try {
        setProgress(0)
        const paths = [...m.scenes.map(s => s.image_path), m.voice_path]
        const { data: signed, error } = await supabase.storage.from('shorts-assets').createSignedUrls(paths, 600)
        if (error || !signed) throw new Error(error?.message ?? 'No se pudieron firmar los assets')
        const urlOf = (p: string) => signed.find((s: { path: string | null }) => s.path === p)?.signedUrl as string
        const images = await Promise.all(m.scenes.map(s => new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => res(img); img.onerror = () => rej(new Error('No cargó una imagen')); img.src = urlOf(s.image_path)
        })))
        const voice = await (await fetch(urlOf(m.voice_path))).arrayBuffer()
        const out = await renderShort(m, images, voice, setProgress)
        setVideo(out); setVideoUrl(URL.createObjectURL(out.blob)); setProgress(null)
      } catch (e) { setRenderError(e instanceof Error ? e.message : 'Error de render'); setProgress(null); rendering.current = false }
    })()
  }, [short, video, supabase])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision); setMessage('')
    const res = await fetch(`/api/shorts/${id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, note, confirmations: { sources: seenSources, hook: seenHook } }) })
    const json = await res.json()
    if (!res.ok) setMessage([json.error, ...(json.blockers ?? [])].join(' · '))
    await load(); setBusy('')
  }

  async function uploadPrivate() {
    if (!video) return
    setBusy('upload'); setMessage(''); setUploadPct(0)
    let opened = false
    try {
      const s = await fetch(`/api/shorts/${id}/upload-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ size: video.blob.size, type: video.mime }) })
      const sj = await s.json()
      if (!s.ok) throw new Error(sj.error ?? 'No se pudo abrir la subida')
      opened = true
      const videoId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', sj.uploadUrl)
        xhr.setRequestHeader('Content-Type', video.mime)
        xhr.upload.onprogress = e => e.lengthComputable && setUploadPct(Math.round((e.loaded / e.total) * 100))
        xhr.onload = () => {
          try { const j = JSON.parse(xhr.responseText); if (xhr.status < 300 && j.id) resolve(j.id); else reject(new Error(j?.error?.message ?? `YouTube respondió ${xhr.status}`)) } catch { reject(new Error(`Respuesta no válida de YouTube (${xhr.status})`)) }
        }
        xhr.onerror = () => reject(new Error('Fallo de red durante la subida'))
        xhr.send(video.blob)
      })
      const done = await fetch(`/api/shorts/${id}/uploaded`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId }) })
      const dj = await done.json()
      if (!done.ok) throw new Error(dj.error ?? 'No se pudo confirmar la subida')
      setMessage('Subido como PRIVADO con contenido sintético declarado.')
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Error de subida'
      setMessage(text)
      // Si la sesión no llegó a abrirse, el servidor ya dejó el Short en «subida fallida».
      if (opened) await fetch(`/api/shorts/${id}/uploaded`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ failed: text }) }).catch(() => undefined)
    }
    setUploadPct(null); await load(); setBusy('')
  }

  if (!short) return <StudioShell title="Short"><p className="connectionStatus">{message || 'Cargando…'}</p></StudioShell>
  const [label, tone] = STATUS_LABEL[short.status] ?? [short.status, '']
  const gates = short.quality?.gates ?? []
  const sel = short.topic_selection as any
  const canApprove = short.status === 'ready_for_approval' && !!video && seenSources && seenHook && gates.length > 0 && gates.every(g => g.pass) && (short.facts.sources?.length ?? 0) >= 2

  return <StudioShell title={short.title ?? 'Short'}>
    <Link className="backLink" href="/automations/shorts">← Fábrica de Shorts</Link>
    <p><span className={`${css.badge} ${css[tone] ?? ''}`}>{label}</span></p>

    {short.status === 'discarded' && <div className={css.panel}><h2>Hoy no se creó este Short</h2>
      <p>{REASONS[short.discard_reason ?? ''] ?? short.discard_reason}</p><pre className="muted">{JSON.stringify(short.discard_detail, null, 2)}</pre></div>}

    {'scenes' in short.manifest && <div className={css.layout}>
      <div>
        <div className={css.phone}>
          {videoUrl ? <video src={videoUrl} controls playsInline /> : <p className={css.muted} style={{ padding: 20, textAlign: 'center' }}>
            {renderError || (progress != null ? `Renderizando en tu navegador… ${Math.round(progress * 100)}%` : 'Preparando render…')}</p>}
        </div>
        {progress != null && <><div className={css.progress}><div style={{ width: `${progress * 100}%` }} /></div>
          <p className={css.muted}>Render en tu navegador. Si no admite el modo rápido (WebCodecs), se graba en tiempo real (~{Math.round((short.manifest as Manifest).duration)} s) y la pestaña debe seguir visible.</p></>}
        {video && <p className={css.muted}>Render listo: {video.ext.toUpperCase()} · {(video.blob.size / 1e6).toFixed(1)} MB · {video.method === 'webcodecs' ? 'modo rápido' : 'tiempo real'} · {video.codecs}{video.ext === 'webm' ? ' — este navegador no graba MP4; YouTube acepta WebM, pero usa Chrome/Edge/Safari recientes para MP4.' : ''}</p>}
        {renderError && <button onClick={() => { setRenderError(''); rendering.current = false; setShort({ ...short }) }}>Reintentar render</button>}
        {!pickMime() && <p className="error">Este navegador no puede grabar vídeo.</p>}
      </div>

      <div>
        <div className={css.panel}><h2>Hook y dato principal (primeros 2 s)</h2>
          <div className={css.hook}><Hook hook={short.script.hook ?? ''} datum={short.script.key_datum ?? ''} /></div>
          <div style={{ marginTop: 12 }}>{gates.map(g => <div key={g.name} className={css.gate}><span>{g.pass ? '✅' : '❌'}</span><span><b>{g.name}</b> — {g.detail}</span></div>)}</div>
          <p className={css.muted}>La duración del hook se mide con la voz real generada. Los cortes de escena se anclan a las pausas reales de la voz cuando las hay; dentro de cada escena los subtítulos se reparten por caracteres (inferido, no medido palabra a palabra).</p>
        </div>

        <div className={css.panel}><h2>Fuentes ({short.facts.sources?.length ?? 0})</h2>
          <p><b>Dato:</b> {short.facts.claim}</p>
          {(short.facts.sources ?? []).map(s => <div key={s.url} className={css.source}>
            <div><b>{s.domain}</b> — <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title ?? s.url}</a></div>
            <blockquote>«{s.quote}»</blockquote></div>)}
          <p className={css.muted}>Cada cita se comprobó por código como texto literal de la página descargada; el modelo no puede inventar una fuente.</p>
        </div>

        <div className={css.panel}><h2>Por qué este tema</h2>
          <div className={css.cols}>
            <div><h3>OBSERVADO (YouTube / Radar)</h3>
              <p className={css.muted}>Mediana de vídeos similares: <b>{Math.round(sel?.score?.interest?.similarMedian ?? 0).toLocaleString('es-ES')}</b> vistas<br />
                Mediana del nicho: <b>{Math.round(sel?.score?.interest?.nicheMedian ?? 0).toLocaleString('es-ES')}</b><br />
                Muestras: {sel?.score?.interest?.samples ?? 0} · Tendencia: {sel?.score?.trend?.value ?? 'sin datos'}<br />
                {sel?.score?.history?.basis === 'observed' ? `Retención histórica de «${sel.score.history.category}»: ${sel.score.history.meanRetention.toFixed(1)} % (${sel.score.history.samples} Shorts)` : 'Sin histórico de retención suficiente aún'}</p></div>
            <div><h3>INFERIDO (Cerebro / IA)</h3>
              <p className={css.muted}>Encaje con el canal: <b>{sel?.score?.fit?.rawScore ?? '—'}</b>/10<br />Puntuación total: <b>{sel?.score?.total ?? '—'}</b>/100<br />Categoría: {short.category}</p></div>
          </div>
        </div>

        {short.status === 'ready_for_approval' && <div className={css.panel}><h2>Tu decisión</h2>
          <label className={css.check}><input type="checkbox" checked={seenSources} onChange={e => setSeenSources(e.target.checked)} /> He revisado las fuentes y el dato es correcto.</label>
          <label className={css.check}><input type="checkbox" checked={seenHook} onChange={e => setSeenHook(e.target.checked)} disabled={!video} /> He visto el vídeo: el hook y el dato principal aparecen en los primeros 2 segundos.</label>
          <div className={css.row}>
            <button disabled={!canApprove || !!busy} onClick={() => decide('approve')}>{busy === 'approve' ? 'Aprobando…' : 'Aprobar'}</button>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Motivo del rechazo (opcional)" style={{ flex: 1, minWidth: 160, background: '#0f1425', color: '#edf0ff', border: '1px solid #303854', borderRadius: 9, padding: 11 }} />
            <button className={css.danger} disabled={!!busy} onClick={() => decide('reject')}>Rechazar</button>
          </div>
          {!video && <p className={css.muted}>Podrás aprobar cuando termine el render.</p>}
        </div>}

        {['approved', 'upload_failed'].includes(short.status) && <div className={css.panel}><h2>Subir a YouTube</h2>
          <p className={css.muted}>Se sube como <b>privado</b> y con el contenido sintético declarado. Hacerlo público lo decides tú después, en YouTube Studio.</p>
          {short.error && <p className="error">{short.error}</p>}
          <button disabled={!video || !!busy} onClick={uploadPrivate}>{busy === 'upload' ? `Subiendo… ${uploadPct ?? 0}%` : 'Subir como privado'}</button>
          {!video && <p className={css.muted}>Esperando al render para tener el archivo.</p>}
        </div>}

        {short.status === 'uploaded_private' && short.video_id && <div className={css.panel}><h2>En YouTube (privado)</h2>
          <p><a href={`https://studio.youtube.com/video/${short.video_id}/edit`} target="_blank" rel="noopener noreferrer" style={{ color: '#9c89ff' }}>Abrir en YouTube Studio</a></p>
          {retention ? <div className={css.cols}>
            <div><h3>OBSERVADO · RETENCIÓN MEDIA A 7 DÍAS</h3><p className={css.muted}><b>{Number(retention.observed.averageViewPercentage).toFixed(1)} %</b> · {retention.observed.views} vistas<br />Ventana {retention.observed.window?.start} → {retention.observed.window?.end}</p></div>
            <div><h3>INFERIDO</h3><p className={css.muted}>{retention.calculated.low_sample ? 'Muestra baja: no se usa para priorizar temas.' : `Relativa a la media del canal: ${retention.calculated.relative_to_channel_mean ?? 'sin base aún'}`}</p></div></div>
            : <p className={css.muted}>La retención a 7 días se guarda sola cuando el vídeo lleva 7 días público (más 2 de margen de Analytics). Mientras siga privado no hay audiencia que medir.</p>}
        </div>}

        {message && <p className="connectionStatus">{message}</p>}
      </div>
    </div>}
  </StudioShell>
}
