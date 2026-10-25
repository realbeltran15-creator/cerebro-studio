'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { compositionCues, compositionIssues, cuesToSrt, cuesToVtt, EXPORT_AUDIO_KBPS, EXPORT_FPS, exportPlan, LIBRARY_MAX_BYTES, totalDurationMs, type Composition, type ExportAudioKbps, type ExportFps, type ExportResolution, type ExportSettings } from '@/lib/editor/composition'
import { downloadText } from '@/lib/library'
import { saveDerivedVideo, saveRender, type EditorAsset } from '@/lib/editor/client'
import { assetUrlResolver, kindFromAssets } from '@/lib/editor/media-urls'
import { transcodeConfigFromEnv, transcodeToCompatibleMp4 } from '@/lib/editor/transcode'
import { nativeSupport, transcodeWithWebCodecs, type NativeSupport } from '@/lib/editor/webcodecs-transcode'
import { pickMimeType, recordingSupported, renderComposition } from '@/lib/editor/renderer'
import { exportStageOf, fastExport, fastExportSupported, FastExportUnsupported, type ExportStage } from '@/lib/editor/fast-export'
import { checkingSink, headOfComposition } from '@/lib/editor/export-selftest'
import { browserFreeBytes, createExportTemp, exportFootprint, fileNameFor, folderSaveSupported, pickSaveFile, removeExportTemp, spaceAdvice, startStorageProbe, tempStorageSupported, type DriveMode, type ExportWhere } from '@/lib/editor/export-destination'
import { pickDriveFolder, requestDriveToken } from '@/lib/ingest/drive'
import { uploadToDrive } from '@/lib/ingest/drive-upload'
import { openDriveSink } from '@/lib/ingest/drive-stream'
import { pickerConfigFromEnv } from '@/lib/flow-import'
import { startExportGuard, type ExportGuard } from '@/lib/editor/export-guard'
import { containerOf, instagramReadiness } from '@/lib/editor/container'
import { browserExportAdvice } from '@/lib/editor/export-limits'
import { Icon } from './studio-icon'

/** Seconds since it was created (how long an export took). */
function stopwatch() { const t0 = performance.now(); return () => (performance.now() - t0) / 1000 }

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

/**
 * Preview and browser render for a composition. Before rendering it asks the parent to persist
 * the composition, then records a snapshot in its own render_jobs row.
 */
export function RenderPanel({ projectId, composition: given, assets, beforeRender, onRendered, previewOnly, autoStart, onExportSettings, exportOnly }: {
  projectId: string
  composition: Composition
  assets: EditorAsset[]
  beforeRender?: () => Promise<void>
  onRendered?: () => void
  /** Only preview (e.g. a partial composition); rendering is disabled. */
  previewOnly?: boolean
  /** Start the recorded render by itself once when the panel opens (the Shorts approval screen). Needs a visible tab. */
  autoStart?: boolean
  /** Export settings changed in this panel (the manual editor stores them with the montage). */
  onExportSettings?: (e: ExportSettings) => void
  /** The editor has its own player: show only the export controls (the canvas appears while rendering). */
  exportOnly?: boolean
}) {
  // Export settings chosen here apply to this render (and are passed up to be saved with the montage when the parent wants them).
  const [exp, setExp] = useState<ExportSettings>(given.exportSettings ?? { quality: 'normal' })
  const givenExp = JSON.stringify(given.exportSettings ?? null)
  useEffect(() => { if (given.exportSettings) setExp(given.exportSettings) }, [givenExp]) // eslint-disable-line react-hooks/exhaustive-deps
  const composition: Composition = { ...given, exportSettings: exp }
  const plan = exportPlan(composition)
  const setExport = (p: Partial<ExportSettings>) => { const next = { ...exp, ...p }; setExp(next); onExportSettings?.(next) }
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
  // What the export guard noticed (tab hidden, progress stopped…), shown under the status.
  const [notice, setNotice] = useState('')
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null)
  // The last saved render, kept so it can be converted to an Instagram-ready MP4 without rendering again.
  const [saved, setSaved] = useState<{ blob: Blob; assetId: string; mimeType: string } | null>(null)
  const [converting, setConverting] = useState<number | null>(null)
  // Where the finished video goes. «folder» and «drive» are exports to a computer folder/drive or to Google Drive; both plan like a download (no Library size cap).
  const [where, setWhere] = useState<ExportWhere>(plan.destination === 'library' ? 'library' : 'download')
  const driveCfg = pickerConfigFromEnv()
  const [free, setFree] = useState<{ browser: number | null; library: number | null; maxFile: number | null }>({ browser: null, library: null, maxFile: null })
  // Drive: «direct» sends the video while it renders (no local file); «temp» renders to a temporary file first (retryable).
  const [driveMode, setDriveMode] = useState<DriveMode>('direct')
  // Destination chosen BEFORE rendering (the system dialogs need a click, so they have their own button).
  const [dest, setDest] = useState<{ kind: 'folder'; handle: FileSystemFileHandle } | { kind: 'drive'; token: string; folderId: string; folderName: string } | null>(null)
  useEffect(() => setDest(null), [where])
  const [transfer, setTransfer] = useState<number | null>(null)
  const [measured, setMeasured] = useState<string>('')
  const [selfTest, setSelfTest] = useState<{ busy: boolean; text: string }>({ busy: false, text: '' })
  const [pendingDrive, setPendingDrive] = useState<{ temp: string; name: string; mime: string; folderId: string; folderName: string } | null>(null)
  const [driveBusy, setDriveBusy] = useState(false)
  // Container the file will have, known BEFORE the render so the «save as» dialog can propose the right extension (it needs a click, so it cannot wait).
  const [ext, setExt] = useState<'mp4' | 'webm'>('mp4')
  useEffect(() => {
    let off = false
    void (async () => {
      const e: 'mp4' | 'webm' = (exp.mode ?? 'fast') === 'fast' ? ((await fastExportSupported(plan.width, plan.height).catch(() => null))?.container ?? 'webm') : (/mp4/.test(pickMimeType() ?? '') ? 'mp4' : 'webm')
      if (!off) setExt(e)
    })()
    return () => { off = true }
  }, [exp.mode, plan.width, plan.height]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let off = false
    void (async () => {
      const browser = await browserFreeBytes()
      const u = await fetch('/api/storage/usage').then(r => r.json()).catch(() => null) as { usedBytes?: number; quotaBytes?: number; maxFileBytes?: number | null } | null
      if (!off) setFree({ browser, library: u?.quotaBytes != null && u.usedBytes != null ? u.quotaBytes - u.usedBytes : null, maxFile: u?.maxFileBytes ?? null })
    })()
    return () => { off = true }
  }, [mode])
  const directDrive = where === 'drive' && driveMode === 'direct' && ext === 'mp4' && (exp.mode ?? 'fast') === 'fast'
  const advice = spaceAdvice({ where, driveMode: directDrive ? 'direct' : 'temp', estimatedBytes: plan.estimatedBytes, browserFreeBytes: free.browser, libraryFreeBytes: free.library, libraryMaxFileBytes: free.maxFile, folderSupported: folderSaveSupported(), tempSupported: tempStorageSupported() })
  const footprint = exportFootprint({ where, driveMode: directDrive ? 'direct' : 'temp', estimatedBytes: plan.estimatedBytes })
  const convertConfig = transcodeConfigFromEnv()
  // Free, GPL-free conversion with the browser's own encoders (WebCodecs). ffmpeg.wasm is only a fallback when its core URL is configured.
  const [native, setNative] = useState<NativeSupport | null>(null)
  useEffect(() => { let off = false; void nativeSupport().then(n => { if (!off) setNative(n) }); return () => { off = true } }, [])
  const nativeOk = !!native?.video && native.audio !== 'none'
  const canConvert = nativeOk || !!convertConfig

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
  const { width, height } = plan
  useEffect(() => {
    if (!autoStart || previewOnly || autoStarted.current || blocking || composition.clips.length === 0 || !recordingSupported()) return
    autoStarted.current = true
    void run(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  /** Opens the system dialog (folder/disk) or Google's folder picker, and keeps the answer so it is shown BEFORE rendering. */
  async function chooseDestination() {
    setError('')
    try {
      if (where === 'folder') { const handle = await pickSaveFile(fileNameFor(composition.title, composition.format, plan.height, ext), ext); setDest({ kind: 'folder', handle }); setStatus('') }
      else if (where === 'drive' && driveCfg) {
        const t = await pickDriveFolder(driveCfg)
        if (!t) { setStatus('No elegiste una carpeta de Drive.'); return }
        setDest({ kind: 'drive', token: t.token, folderId: t.folderId, folderName: t.folderName }); setStatus('')
      }
    } catch (e) { if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'No se pudo abrir el selector.') }
  }

  /** A few seconds of THIS montage with THIS format and writing mode, written to nowhere: finds in seconds what would fail an hour in. Nothing is saved or sent. */
  async function runSelfTest() {
    if (selfTest.busy || busyRef.current) return
    const id = Math.random().toString(36).slice(2, 8)
    setSelfTest({ busy: true, text: 'Probando 20 s del montaje (no se guarda nada)…' })
    const t0 = performance.now()
    let stageNow: ExportStage = 'preparar'
    try {
      const head = headOfComposition(composition, 20_000)
      const sinkProbe = checkingSink()
      const fragmented = where === 'drive' && driveMode === 'direct' && ext === 'mp4'
      const r = await fastExport({ composition: head, canvas: canvasRef.current!, resolveUrl: assetUrlResolver(), kindOf: kindFromAssets(assets), sink: sinkProbe.stream as never, fragmented, fps: plan.fps, onStage: st => { stageNow = st } })
      const st = sinkProbe.stats()
      const secs = Math.round((performance.now() - t0) / 100) / 10
      const ok = st.bytes > 0 && (!fragmented || st.sequential)
      console.info(`[export ${id}] prueba de 20 s`, { ok, ...r.encoded, bytes: st.bytes, writes: st.writes, sequential: st.sequential, secs })
      setSelfTest({ busy: false, text: ok
        ? `Prueba superada en ${secs} s: ${r.encoded.width}×${r.encoded.height} · ${r.encoded.fps} fps · ${r.encoded.videoCodec === 'avc' ? 'H.264' : r.encoded.videoCodec.toUpperCase()} + ${r.encoded.audioCodec.toUpperCase()} · ${r.encoded.container.toUpperCase()}${r.encoded.fragmented ? ' fragmentado' : ''} · ${Math.round(st.bytes / 1048576 * 10) / 10} MB escritos en ${st.writes} bloque(s)${fragmented ? ', todos en orden (se puede enviar a Drive mientras se renderiza)' : ''}. (id ${id})`
        : `La prueba terminó pero el archivo no es válido para este destino: ${st.bytes === 0 ? 'no se escribió ningún byte' : 'se escribió fuera de orden (posición ' + st.firstBadAt + '), no se puede enviar a Drive mientras se renderiza'}. (id ${id})` })
    } catch (e) {
      const stage = exportStageOf(e) ?? stageNow
      console.error(`[export ${id}] la prueba de 20 s falló en la fase «${stage}»`, e)
      setSelfTest({ busy: false, text: `La prueba de 20 s falló en la fase «${stage}»: ${e instanceof Error ? e.message : String(e)} (id ${id}). Esto es lo que habría fallado en la exportación completa.` })
    }
  }

  async function run(record: boolean) {
    // Synchronous guard: state updates are async, so repeated clicks during the save would pass a mode check.
    if (busyRef.current) return
    busyRef.current = true
    setMode('loading'); setError(''); setStatus(record ? 'Guardando el montaje…' : '')
    // The destination was chosen BEFORE (its own button); nothing is rendered without one.
    let fileHandle: FileSystemFileHandle | null = null
    let driveTarget: { token: string; folderId: string; folderName: string } | null = null
    const exportName = fileNameFor(composition.title, composition.format, plan.height, ext)
    const stopEarly = (msg: string) => { busyRef.current = false; setMode('idle'); setStatus(msg) }
    if (record && where === 'folder') { if (dest?.kind !== 'folder') return stopEarly('Elige primero dónde guardar el vídeo.'); fileHandle = dest.handle }
    else if (record && where === 'drive') { if (dest?.kind !== 'drive') return stopEarly('Elige primero la carpeta de Drive.'); driveTarget = dest }
    setTransfer(null); setMeasured('')
    let driveSink: Awaited<ReturnType<typeof openDriveSink>> | null = null
    let driveFailure: unknown = null // a Drive error (permission, quota, network) is final: re-rendering in real time would only fail again
    const probe = record ? startStorageProbe() : null
    let probeDone = false
    let up0Bytes = 0
    /** What this export really used, from the browser's own counters (it cannot read the physical disk). */
    const reportMeasured = async (bytes: number) => {
      if (!probe || probeDone) return
      probeDone = true
      const m = await probe.stop(); const st = driveSink?.stats(); const mbf = (n: number) => Math.round(n / 104857.6) / 10
      setMeasured(`Medido en esta exportación: vídeo ${mbf(bytes)} MB · almacenamiento temporal del navegador (pico) ${mbf(m.peakAboveStartBytes)} MB · quedaron ${mbf(Math.max(0, m.endAboveStartBytes))} MB al terminar${st ? ` · memoria de envío (pico) ${mbf(st.peakBufferedBytes)} MB en ${st.blocks + 1} bloques${st.retries ? `, ${st.retries} reintento(s)` : ''}` : ''}. Un navegador no puede leer el disco físico: esto es lo que él mismo almacena.`)
    }
    let tmp: Awaited<ReturnType<typeof createExportTemp>> | null = null
    let streamTo: FileSystemWritableFileStream | null = null
    const controller = new AbortController()
    abortRef.current = controller
    abortReason.current = 'user'
    let jobId: string | null = null
    let guard: ExportGuard | null = null
    const exportId = Math.random().toString(36).slice(2, 8)
    let lastStage: ExportStage = 'preparar'
    setNotice('')
    try {
      if (record) await beforeRender?.()
      // Media is streamed from signed URLs while it records (nothing is downloaded up front, so long montages fit in memory).
      const missing = [...new Set([...composition.clips.flatMap(k => [k.visualAssetId, k.voiceAssetId]), composition.musicAssetId, ...(composition.audioClips ?? []).map(a => a.assetId), ...(composition.overlays ?? []).map(o => o.assetId)].filter((x): x is string => Boolean(x)))].filter(id => !assets.some(a => a.id === id))
      if (missing.length) throw new Error(`El montaje usa ${missing.length} archivo(s) que ya no están en la Biblioteca. Vuelve a vincularlos en el editor antes de exportar.`)
      setStatus('Preparando los archivos…')
      if (record) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('La sesión ha caducado.')
        const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: composition.format, status: 'rendering', composition }).select('id').single()
        if (e) throw new Error(e.message)
        jobId = (data as { id: string }).id
      }
      if (record) guard = startExportGuard(ev => {
        if (ev.type === 'hidden') setNotice('La pestaña está oculta: la exportación sigue, pero el navegador puede frenarla. Vuelve a esta pestaña para que vaya a toda velocidad.')
        else if (ev.type === 'visible') setNotice(ev.hiddenMs > 3000 ? `La pestaña estuvo oculta ${Math.round(ev.hiddenMs / 1000)} s; la exportación continúa desde donde iba.` : '')
        else if (ev.type === 'stalled') setNotice(ev.hidden ? `Sin avance desde hace ${Math.round(ev.sinceMs / 1000)} s porque la pestaña está oculta: el navegador la ha pausado. Al volver a la pestaña continúa sola; no se pierde nada.` : `Sin avance desde hace ${Math.round(ev.sinceMs / 1000)} s. Si no se mueve en un rato, cancela y vuelve a exportar (en «Ajustes de exportación» puedes probar el modo en tiempo real).`)
        else setNotice('')
      })
      setMode(record ? 'render' : 'preview')
      setStatus(record ? 'Grabando en tiempo real. Mantén esta pestaña visible hasta que termine.' : 'Vista previa en reproducción.')
      const realtime = () => renderComposition({
        composition, canvas: canvasRef.current!, resolveUrl: assetUrlResolver(), kindOf: kindFromAssets(assets), record, signal: controller.signal,
        onProgress: (elapsed, t) => { guard?.progress(); setProgress({ elapsed, total: t }) },
      })
      let result: Awaited<ReturnType<typeof renderComposition>>
      let renderer: 'browser-fast' | 'browser-mediarecorder' = 'browser-mediarecorder'
      const clock = stopwatch()
      if (record && (exp.mode ?? 'fast') === 'fast') {
        try {
          setStatus('Exportación rápida: se dibuja fotograma a fotograma (no hace falta esperar al tiempo real). Mantén esta pestaña a la vista: en segundo plano el navegador la frena.')
          if (fileHandle) streamTo = await fileHandle.createWritable()
          else if (driveTarget && directDrive) {
            // The upload session is opened first, so a bad folder or an expired permission fails now, not after hours of rendering.
            driveSink = await openDriveSink({ name: exportName, mimeType: 'video/mp4', token: driveTarget.token, folderId: driveTarget.folderId, signal: controller.signal, onProgress: sent => { guard?.progress(); setTransfer(sent) } })
            streamTo = driveSink.writable as never
            driveSink.result.catch(e => { driveFailure = e })
          } else if (driveTarget) { tmp = await createExportTemp(crypto.randomUUID().slice(0, 8), ext); streamTo = tmp.writable }
          result = await fastExport({ composition, canvas: canvasRef.current!, resolveUrl: assetUrlResolver(), kindOf: kindFromAssets(assets), sink: streamTo as never, fragmented: !!driveSink, signal: controller.signal, onStage: (st, d) => { lastStage = st; if (st !== 'vídeo' && st !== 'audio') console.info(`[export ${exportId}] ${st}${d ? ' ' + d : ''}`) }, onProgress: (elapsed, t) => { guard?.progress(); setProgress({ elapsed, total: t }) } })
          renderer = 'browser-fast'
          const secs = clock()
          setStatus(`Exportación rápida terminada en ${Math.round(secs)} s (${Math.max(0.1, Math.round(result.durationMs / 1000 / Math.max(0.1, secs) * 10) / 10)}× el tiempo real).`)
        } catch (e) {
          if (controller.signal.aborted || (e as Error)?.name === 'AbortError') throw e
          // The error that stopped the exporter is the cause; a Drive-side error is reported when it is the one that stopped it.
          if (driveFailure) throw new Error(`${e instanceof Error && e.message ? e.message : driveFailure instanceof Error ? driveFailure.message : 'Drive no aceptó el vídeo.'} No queda ningún archivo en tu equipo ni a medias en Drive. Vuelve a exportar, o elige «con temporal local» para poder reintentar solo la subida.`)
          // Anything the fast path cannot do here (a codec, a file it cannot read by ranges…) falls back to the real-time recording.
          setStatus(`${e instanceof FastExportUnsupported ? e.message : `La exportación rápida no pudo terminar (${e instanceof Error ? e.message : 'error'}).`} Se exporta en tiempo real: mantén la pestaña visible.`)
          setProgress({ elapsed: 0, total: 0 })
          try { if (streamTo && !streamTo.locked) await streamTo.abort() } catch { /* already aborted by the exporter */ }
          streamTo = null
          driveSink = null; setTransfer(null)
          if (tmp) { await removeExportTemp(tmp.name); tmp = null }
          result = await realtime()
        }
      } else result = await realtime()
      if (controller.signal.aborted) {
        const reason = (abortReason.current as string) === 'unmount' ? 'Cancelado: se salió del editor antes de terminar el render.' : 'Cancelado por el usuario.'
        if (jobId) await supabase.from('render_jobs').update({ status: 'cancelled', error: reason, updated_at: new Date().toISOString() }).eq('id', jobId)
        setStatus(`${reason} No se ha guardado ningún vídeo.`)
        return
      }
      if (record && jobId && fileHandle) {
        if (result.blob) { const w = await fileHandle.createWritable(); await w.write(result.blob); await w.close() }
        const size = (await fileHandle.getFile()).size
        await supabase.from('render_jobs').update({ status: 'completed', error: null, updated_at: new Date().toISOString() }).eq('id', jobId)
        await reportMeasured(size)
        setStatus(`Vídeo guardado en «${fileHandle.name}» (${Math.round(size / 1048576 * 10) / 10} MB), en la ubicación que elegiste. ${streamed(result) ? 'Se escribió mientras se renderizaba: no se montó entero en memoria.' : 'Esta vez se montó en memoria antes de escribirlo (modo en tiempo real).'}`)
        onRendered?.()
      } else if (record && jobId && driveTarget) {
        await supabase.from('render_jobs').update({ status: 'completed', error: null, updated_at: new Date().toISOString() }).eq('id', jobId)
        const mime = ext === 'mp4' ? 'video/mp4' : 'video/webm'
        if (driveSink) {
          setMode('saving'); setStatus('Cerrando el archivo en Drive…')
          const up = await driveSink.result
          setStatus(`Guardado en Google Drive: «${up.name}» en la carpeta «${driveTarget.folderName}» (${Math.round(up.size / 1048576 * 10) / 10} MB). Se envió mientras se renderizaba: no se creó ningún archivo en este equipo.`)
          setTransfer(up.size); up0Bytes = up.size
        } else {
          const tempName = tmp?.name ?? ''
          let file: Blob
          if (tmp) file = await tmp.handle.getFile()
          else if (result.blob) { file = result.blob } else throw new Error('No hay vídeo que subir.')
          const target = { temp: tempName, name: exportName, mime, folderId: driveTarget.folderId, folderName: driveTarget.folderName }
          await sendToDrive(file, target, driveTarget.token, controller.signal, () => guard?.progress()); up0Bytes = file.size
        }
        onRendered?.()
        await reportMeasured(up0Bytes)
      } else if (record && result.blob && jobId && plan.destination === 'download') {
        // Download only: the file stays on this computer (no 50 MB limit); the render job records it without uploading anything.
        const name = `${(composition.title || 'montaje').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}-${composition.format.replace(':', 'x')}-${plan.height}p.${containerOf(result.mimeType)}`
        const url = URL.createObjectURL(result.blob)
        setDownload({ url, name })
        await supabase.from('render_jobs').update({ status: 'completed', error: null, updated_at: new Date().toISOString() }).eq('id', jobId)
        const a = document.createElement('a'); a.href = url; a.download = name; a.click()
        setStatus(`Vídeo listo (${Math.round(result.blob.size / 1048576 * 10) / 10} MB): se ha descargado a tu equipo y no se ha subido a la Biblioteca.`)
        onRendered?.()
      } else if (record && result.blob && jobId) {
        const name = `${(composition.title || 'montaje').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}-${composition.format.replace(':', 'x')}.${containerOf(result.mimeType)}`
        setDownload({ url: URL.createObjectURL(result.blob), name })
        setMode('saving'); setStatus('Guardando el vídeo en la nube…')
        const savedAsset = await saveRender(supabase, { projectId, jobId, composition, blob: result.blob, mimeType: result.mimeType ?? 'video/webm', durationMs: result.durationMs, assets, renderer, onUploadProgress: f => { guard?.progress(); setStatus(`Subiendo a la nube… ${Math.round(f * 100)} %`) } })
        setSaved({ blob: result.blob, assetId: savedAsset.id, mimeType: result.mimeType ?? 'video/webm' })
        const ig = instagramReadiness(result.mimeType)
        setStatus(`Vídeo guardado en la Biblioteca (${Math.round(result.blob.size / 1048576 * 10) / 10} MB).${ig.ok ? '' : ` Aviso: ${ig.reason}`}`)
        onRendered?.()
      } else if (!record) setStatus('Vista previa terminada.')
    } catch (e) {
      // Discard what was being written: a cancelled or failed export leaves no half-written video and no temporary.
      try { if (streamTo && !streamTo.locked) await streamTo.abort() } catch { /* already aborted */ }
      if (tmp && !pendingDriveRef.current) await removeExportTemp(tmp.name).catch(() => undefined)
      const stage = exportStageOf(e) ?? lastStage
      console.error(`[export ${exportId}] falló en la fase «${stage}»`, e)
      const message = `${e instanceof Error ? e.message : 'El render falló.'} [fase: ${stage} · id ${exportId}]`
      setError(message)
      if (jobId) await supabase.from('render_jobs').update({ status: 'failed', error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', jobId)
    } finally {
      void probe?.stop().catch(() => undefined)
      guard?.stop()
      setNotice('')
      abortRef.current = null
      busyRef.current = false
      setMode('idle')
    }
  }

  const pendingDriveRef = useRef(false)
  useEffect(() => { pendingDriveRef.current = !!pendingDrive }, [pendingDrive])
  const streamed = (r: { blob: Blob | null }) => r.blob === null

  /** Uploads the rendered file to the chosen Drive folder. On failure the temporary file is kept so the upload can be retried without rendering again. */
  async function sendToDrive(file: Blob, t: { temp: string; name: string; mime: string; folderId: string; folderName: string }, token: string, signal?: AbortSignal, tick?: () => void) {
    setMode('saving'); setDriveBusy(true); setPendingDrive(null); pendingDriveRef.current = false
    try {
      const r = await uploadToDrive(file, { name: t.name, mimeType: t.mime, token, folderId: t.folderId, signal, onProgress: (sent, total) => { tick?.(); setStatus(`Subiendo a Google Drive… ${Math.round(sent / total * 100)} % (${Math.round(sent / 1048576)} de ${Math.round(total / 1048576)} MB)`) } })
      if (t.temp) await removeExportTemp(t.temp)
      setStatus(`Subido a Google Drive: «${r.name}» en la carpeta «${t.folderName}» (${Math.round(r.size / 1048576 * 10) / 10} MB). ${t.temp ? 'El archivo temporal de este equipo se ha borrado.' : ''}`)
    } catch (e) {
      if (t.temp) { pendingDriveRef.current = true; setPendingDrive(t) }
      throw new Error(`${e instanceof Error ? e.message : 'No se pudo subir a Drive.'} ${t.temp ? 'El vídeo ya está renderizado y guardado como temporal: pulsa «Reintentar subida a Drive».' : ''}`)
    } finally { setDriveBusy(false) }
  }

  async function retryDrive() {
    if (!pendingDrive || !driveCfg || driveBusy) return
    setError('')
    try {
      const token = await requestDriveToken(driveCfg)
      const root = await navigator.storage.getDirectory()
      const file = await (await root.getFileHandle(pendingDrive.temp)).getFile()
      await sendToDrive(file, pendingDrive, token)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo subir a Drive.') } finally { setMode('idle') }
  }

  async function convert() {
    if (!saved || !canConvert || converting !== null) return
    setError(''); setConverting(0); setStatus('Convirtiendo a MP4 compatible (H.264 + AAC). Puede tardar; no cierres la pestaña…')
    try {
      let out: Awaited<ReturnType<typeof transcodeToCompatibleMp4>> & { tool: string }
      try {
        if (!nativeOk) throw new Error('native unavailable')
        out = await transcodeWithWebCodecs(saved.blob, { onProgress: setConverting })
      } catch (e) {
        if (!convertConfig) throw e
        setConverting(0)
        out = { ...(await transcodeToCompatibleMp4(saved.blob, { config: convertConfig, onProgress: setConverting })), tool: 'ffmpeg.wasm' }
      }
      setStatus('Guardando el MP4 convertido en la Biblioteca…')
      await saveDerivedVideo(supabase, { projectId, sourceAssetId: saved.assetId, blob: out.blob, mimeType: out.mimeType, codecs: out.codecs, tool: out.tool })
      setDownload(d => { if (d) URL.revokeObjectURL(d.url); return { url: URL.createObjectURL(out.blob), name: `${(composition.title || 'montaje').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}-h264.mp4` } })
      setSaved(null)
      setStatus('MP4 compatible con Instagram guardado en la Biblioteca (H.264 + AAC). El original se conserva.')
      onRendered?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo convertir el vídeo.'); setStatus('') } finally { setConverting(null) }
  }

  /** Offline package: the montage + signed links to its materials, rendered on this computer with FFmpeg (no browser, no tab to keep open). */
  async function preparePackage() {
    if (busyRef.current) return
    busyRef.current = true
    setMode('loading'); setError(''); setStatus('Guardando el montaje…')
    try {
      await beforeRender?.()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: composition.format, status: 'queued', composition }).select('id').single()
      if (e) throw new Error(e.message)
      setStatus('Preparando los enlaces a tus materiales…')
      const r = await fetch('/api/render/ticket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: (data as { id: string }).id }) })
      const j = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'No se pudo preparar el paquete.')
      downloadText('paquete-render.json', JSON.stringify(j), 'application/json')
      setStatus('Paquete descargado (válido 4 h). En tu PC: node scripts/render.mjs ticket paquete-render.json --out video.mp4 — luego súbelo a la Biblioteca. Para no usar el disco interno, apunta a un disco externo: --out E:\\video.mp4 --work E:\\temporal (el motor guarda ahí los materiales descargados, los segmentos y el vídeo final).')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar el paquete.'); setStatus('')
    } finally {
      busyRef.current = false; setMode('idle')
    }
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div className="cardHead" style={{ marginBottom: 0 }}>
      <h3>Vista previa y exportación</h3>
      <span className="pill">{composition.format} · {width}×{height} · {fmt(total)}</span>
    </div>
    {!previewOnly && <div className="field-row exportControls" role="group" aria-label="Exportación" style={{ alignItems: 'end' }}>
      <label>Resolución<select aria-label="Resolución" value={exp.resolution ?? ''} onChange={e => setExport({ resolution: (e.target.value || undefined) as ExportResolution | undefined })}><option value="">Estándar</option><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p (2K)</option><option value="2160">2160p (4K)</option></select></label>
      <label>Calidad<select aria-label="Calidad" value={exp.videoKbps ? 'custom' : exp.quality} onChange={e => e.target.value === 'custom' ? setExport({ videoKbps: Math.round(plan.wantedBps / 1000) }) : setExport({ quality: e.target.value === 'high' ? 'high' : 'normal', videoKbps: null })}><option value="normal">Normal</option><option value="high">Alta</option><option value="custom">Personalizada</option></select></label>
      {exp.videoKbps ? <label>Vídeo (kbit/s)<input aria-label="Bitrate de vídeo" type="number" min={200} max={40000} step={100} value={exp.videoKbps} onChange={e => setExport({ videoKbps: Math.min(40000, Math.max(200, Number(e.target.value) || 200)) })} style={{ width: 100 }} /></label> : null}
      <label>Modo<select aria-label="Modo de exportación" value={exp.mode ?? 'fast'} onChange={e => setExport({ mode: e.target.value === 'realtime' ? 'realtime' : undefined })}><option value="fast">Rápida (fotograma a fotograma)</option><option value="realtime">En tiempo real (grabación)</option></select></label>
      <label>Imágenes por segundo<select aria-label="Imágenes por segundo" value={exp.fps ?? 30} onChange={e => setExport({ fps: Number(e.target.value) === 30 ? undefined : Number(e.target.value) as ExportFps })}>{EXPORT_FPS.map(f => <option key={f} value={f}>{f} fps</option>)}</select></label>
      <label>Audio<select aria-label="Calidad de audio" value={exp.audioKbps ?? 128} onChange={e => setExport({ audioKbps: Number(e.target.value) === 128 ? undefined : Number(e.target.value) as ExportAudioKbps })}>{EXPORT_AUDIO_KBPS.map(k => <option key={k} value={k}>{k} kbit/s</option>)}</select></label>
      <label>Destino<select aria-label="Destino" value={where} onChange={e => { const w = e.target.value as ExportWhere; setWhere(w); setExport({ destination: w === 'library' ? 'library' : 'download' }) }}>
        <option value="download">Descargar a mi equipo (carpeta Descargas)</option>
        <option value="folder" disabled={!folderSaveSupported()}>Guardar en una carpeta o disco externo…{folderSaveSupported() ? '' : ' (no disponible en este navegador)'}</option>
        <option value="drive" disabled={!driveCfg}>Google Drive{driveCfg ? '' : ' (requiere configuración)'}</option>
        <option value="library">Biblioteca de Cerebro Studio{free.maxFile ? ` (máx. ${Math.round(free.maxFile / 1048576)} MB)` : ''}</option>
        <option value="onedrive" disabled>OneDrive (aún no disponible)</option>
        <option value="dropbox" disabled>Dropbox (aún no disponible)</option>
      </select></label>
      {where === 'drive' && <label>Envío a Drive<select aria-label="Modo de envío a Drive" value={driveMode} onChange={e => setDriveMode(e.target.value === 'temp' ? 'temp' : 'direct')}>
        <option value="direct" disabled={ext !== 'mp4' || (exp.mode ?? 'fast') !== 'fast'}>Directo mientras se renderiza (sin copia en este equipo)</option>
        <option value="temp">Con temporal local (se puede reintentar la subida)</option>
      </select></label>}
      <span className="small muted" aria-label="Estimación">{width}×{height} · {plan.fps} fps · {(plan.videoBps / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 })} Mbit/s · ~{Math.max(0.1, Math.round(plan.estimatedBytes / 1048576 * 10) / 10)} MB</span>
    </div>}
    {!previewOnly && (exp.mode ?? 'fast') === 'realtime' && plan.fps !== 30 && <p className="warnBox small">En tiempo real las imágenes por segundo las marca la pantalla (normalmente 60), no este ajuste: usa el modo rápido para fijarlas.</p>}
    {!previewOnly && (exp.resolution === '1440' || exp.resolution === '2160') && (exp.mode ?? 'fast') === 'realtime' && <p className="warnBox small">En tiempo real, 2K y 4K pueden ir a saltos en equipos modestos: usa el modo rápido.</p>}
    {!previewOnly && (where === 'folder' || where === 'drive') && <div className="field-row" style={{ alignItems: 'center' }} aria-label="Destino elegido">
      <button type="button" className="ghost small" disabled={mode !== 'idle'} onClick={() => void chooseDestination()}>{dest ? 'Cambiar destino…' : where === 'folder' ? 'Elegir carpeta o disco…' : 'Elegir carpeta de Drive…'}</button>
      <span className="small" role="status">{dest?.kind === 'folder' ? `Destino: archivo «${dest.handle.name}» en la ubicación que elegiste (el navegador no revela la ruta ni la letra de la unidad).` : dest?.kind === 'drive' ? `Destino: carpeta de Drive «${dest.folderName}» (${dest.folderName ? 'elegida en el selector oficial de Google' : ''}).` : 'Todavía no has elegido destino: no se renderizará nada hasta entonces.'}</span>
    </div>}
    {!previewOnly && <p className="muted small" aria-label="Previsión de recursos">Previsión (estimada, no medida): vídeo ~{Math.max(0.1, Math.round(footprint.finalBytes / 104857.6) / 10)} MB · espacio temporal en el disco interno de este equipo {footprint.diskTempBytes ? `~${Math.round(footprint.diskTempBytes / 104857.6) / 10} MB` : '0 MB'} · memoria extra {footprint.ramBytes >= 1024 ** 3 ? `~${Math.round(footprint.ramBytes / 1024 ** 3 * 10) / 10} GB` : `~${Math.round(footprint.ramBytes / 1048576)} MB`}. {footprint.note}</p>}
    {!previewOnly && <p className={advice.level === 'ok' ? 'muted small' : 'warnBox small'} role={advice.level === 'block' ? 'alert' : 'status'} aria-label="Aviso de espacio">{advice.message}</p>}
    {!previewOnly && false && browserExportAdvice(plan.estimatedBytes).level === 'heavy' && <p className="warnBox small" role="status" aria-label="Aviso de memoria">{browserExportAdvice(plan.estimatedBytes).message}</p>}
    {!previewOnly && plan.destination === 'library' && !plan.fitsLibrary && <p className="warnBox small" role="alert">Este montaje no cabe en la Biblioteca ({Math.round(LIBRARY_MAX_BYTES / 1048576)} MB) ni con la calidad mínima. Elige «Descargar a mi equipo».</p>}
    {!previewOnly && plan.reduced && plan.fitsLibrary && <p className="warnBox small">Para caber en {Math.round(LIBRARY_MAX_BYTES / 1048576)} MB la calidad baja a {(plan.videoBps / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 2 })} Mbit/s (pedías {(plan.wantedBps / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 })}). Elige «Descargar a mi equipo» para conservarla.</p>}
    <canvas ref={canvasRef} width={width} height={height} style={{ width: '100%', maxHeight: exportOnly && mode === 'idle' ? 0 : 420, objectFit: 'contain', background: '#000', borderRadius: 10 }} aria-label="Lienzo de vista previa" />
    {mode !== 'idle' && progress.total > 0 && <label className="small muted" style={{ display: 'block' }}>Renderizado {Math.round(progress.elapsed / Math.max(1, progress.total) * 100)} %<progress value={progress.elapsed} max={progress.total} style={{ width: '100%' }} aria-label="Progreso" /></label>}
    {transfer !== null && <label className="small muted" style={{ display: 'block' }}>Enviado a Drive: {Math.round(transfer / 104857.6) / 10} MB {mode === 'idle' ? '(completo)' : `(~${Math.min(99, Math.round(transfer / Math.max(1, plan.estimatedBytes) * 100))} % del total estimado)`}<progress value={mode === 'idle' ? 1 : Math.min(0.99, transfer / Math.max(1, plan.estimatedBytes))} max={1} style={{ width: '100%' }} aria-label="Progreso de transferencia" /></label>}
    {status && <p className="muted small" role="status">{status}</p>}
    {measured && <p className="small" role="status" aria-label="Medición de esta exportación">{measured}</p>}
    {notice && <p className="small" role="status" aria-label="Aviso de la exportación" style={{ color: '#ffd23f' }}>{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {issues.length > 0 && <ul className="warnList">{issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
    {!recordingSupported() && <p className="warnBox">Este navegador no puede grabar vídeo desde canvas. Usa Chrome, Edge o Firefox de escritorio.</p>}
    <div className="pageActions">
      {mode === 'idle' ? <>
        {!exportOnly && <button type="button" className="ghost" disabled={blocking || composition.clips.length === 0} onClick={() => void run(false)}><Icon name="eye" size={16} />Vista previa (no guarda)</button>}
        {!previewOnly && <button type="button" className="ghost" disabled={blocking || composition.clips.length === 0} title="Para vídeos largos: se renderiza en tu PC con FFmpeg, sin navegador abierto y sin coste" onClick={() => void preparePackage()}><Icon name="video" size={16} />Paquete para renderizar en mi PC</button>}
        {!previewOnly && <button type="button" className="ghost" disabled={selfTest.busy || composition.clips.length === 0 || !recordingSupported()} title="Renderiza solo los primeros 20 s con este formato y modo de escritura, sin guardar ni enviar nada, para descubrir problemas en segundos" onClick={() => void runSelfTest()}>Probar 20 s (no guarda nada)</button>}
        {!previewOnly && <button type="button" disabled={blocking || composition.clips.length === 0 || !recordingSupported() || advice.level === 'block' || (plan.destination === 'library' && !plan.fitsLibrary) || ((where === 'folder' || where === 'drive') && !dest)} title={(where === 'folder' || where === 'drive') && !dest ? 'Elige primero el destino' : undefined} onClick={() => void run(true)}><Icon name="video" size={16} />{where === 'download' ? 'Renderizar y descargar' : where === 'folder' ? 'Renderizar y guardar en el destino' : where === 'drive' ? (directDrive ? 'Renderizar y enviar a Drive' : 'Renderizar y subir a Drive') : 'Renderizar y guardar'}</button>}
      </> : <button type="button" className="ghost" onClick={() => { if (mode !== 'render' || window.confirm('¿Cancelar el render? No se guardará el vídeo.')) abortRef.current?.abort() }} disabled={mode === 'saving'}>{mode === 'render' ? 'Cancelar render' : 'Detener vista previa'}</button>}
      {selfTest.text && <p className={`small ${/falló|no es válido/.test(selfTest.text) ? 'warnBox' : 'notice'}`} role="status" aria-label="Resultado de la prueba de 20 segundos">{selfTest.text}</p>}
      {pendingDrive && mode === 'idle' && <><button type="button" onClick={() => void retryDrive()} disabled={driveBusy}>Reintentar subida a Drive</button><button type="button" className="ghost" onClick={() => void (async () => { await removeExportTemp(pendingDrive.temp); setPendingDrive(null); setStatus('Temporal borrado. El vídeo no se subió.') })()}>Descartar el temporal</button></>}
      {download && <a className="buttonLink ghost" href={download.url} download={download.name}>Descargar {/\.mp4$/i.test(download.name) ? 'MP4' : 'WebM'}</a>}
      {compositionCues(composition).length > 0 && <>
        <button type="button" className="ghost small" onClick={() => downloadText('subtitulos.srt', cuesToSrt(compositionCues(composition)), 'application/x-subrip')}>Subtítulos .srt</button>
        <button type="button" className="ghost small" onClick={() => downloadText('subtitulos.vtt', cuesToVtt(compositionCues(composition)), 'text/vtt')}>.vtt</button>
      </>}
    </div>
    {saved && mode === 'idle' && !instagramReadiness(saved.mimeType).ok && <div className="warnBox small" role="status">
      <p>{instagramReadiness(saved.mimeType).reason}</p>
      {canConvert
        ? <div className="pageActions"><button type="button" className="ghost small" disabled={converting !== null} onClick={() => void convert()}>{converting !== null ? `Convirtiendo… ${Math.round(converting * 100)} %` : 'Convertir a MP4 compatible (H.264 + AAC)'}</button></div>
        : <p className="muted small">{native === null ? 'Comprobando si este navegador puede convertir el vídeo…' : 'Este navegador no puede codificar H.264; renderiza con Chrome, Edge o Safari para obtener un MP4 compatible.'}</p>}
    </div>}
    {download && mode === 'idle' && !error && plan.destination !== 'download' && <p className="notice" role="status">Guardado en la Biblioteca. Siguiente: <Link className="open" href={`/repurpose?project=${projectId}`}>versión vertical</Link> · <Link className="open" href={`/youtube?project=${projectId}`}>preparar YouTube</Link> · <Link className="open" href={`/social?project=${projectId}`}>preparar Instagram / TikTok</Link>. Preparar no publica.</p>}
    <p className="muted small">{exportOnly ? 'La exportación usa el mismo motor que el reproductor: sale exactamente lo que ves.' : '«Vista previa» solo reproduce el montaje; «Renderizar y guardar» graba el vídeo y lo guarda en la Biblioteca.'} El render se hace en tu navegador en tiempo real (un vídeo de 3 minutos tarda 3 minutos): mantén la pestaña abierta y visible hasta que termine; si un archivo tarda en cargar, la grabación se detiene y continúa sin saltos. Sin coste externo. Salida MP4 (H.264 + AAC) en Chrome, Edge y Safari; WebM en Firefox. Para la Biblioteca el bitrate se ajusta para no superar 50 MB. Los subtítulos se reparten por número de palabras: es una aproximación, no una alineación exacta.</p>
  </section>
}
