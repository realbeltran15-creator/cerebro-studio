'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Composition } from '@/lib/editor/composition'
import { grantLocalAccess, localAccessNeeded, localFolderSupported, pickLocalFolder, registerPickedFiles, type LocalFile } from '@/lib/editor/local-media'
import { buildLofiMontage, LOFI_DEFAULTS } from '@/lib/editor/lofi-montage'

const fmt = (ms: number) => { const s = Math.round(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}` }

/**
 * Materials from the owner's own disk (e.g. the external drive D:) without uploading them, and «Música en fila y vídeo en bucle»:
 * all the songs of a folder one after another with soft crossfades, and the clips on the timeline repeated until the music ends.
 */
export function LocalLofiPanel({ comp, files, onFiles, apply, onError, onNotice }: {
  comp: Composition
  files: LocalFile[]
  onFiles: (all: LocalFile[]) => void
  apply: (next: (c: Composition) => Composition) => void
  onError: (m: string) => void
  onNotice: (m: string) => void
}) {
  const [busy, setBusy] = useState('')
  const [needAccess, setNeedAccess] = useState(false)
  const [hint, setHint] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const folders = useMemo(() => [...new Set(files.filter(f => f.kind === 'music').map(f => f.folder))], [files])
  const [folder, setFolder] = useState('')
  const [xfSec, setXfSec] = useState(LOFI_DEFAULTS.crossfadeMs / 1000)
  const [trSec, setTrSec] = useState(LOFI_DEFAULTS.transitionMs / 1000)
  const [wholeClips, setWholeClips] = useState(true)
  useEffect(() => { if (!folder && folders.length) setFolder(folders[folders.length - 1]) }, [folders, folder])
  useEffect(() => { void localAccessNeeded().then(setNeedAccess).catch(() => undefined) }, [files])
  const songs = files.filter(f => f.kind === 'music' && f.folder === folder)
  const musicMs = songs.reduce((s, f) => s + (f.durationMs ?? 0), 0)

  async function pick() {
    onError(''); setBusy('Leyendo la carpeta…')
    try {
      const r = await pickLocalFolder((d, t) => setBusy(`Leyendo la carpeta… ${d}/${t}`))
      const others = files.filter(f => !r.files.some(x => x.id === f.id))
      onFiles([...others, ...r.files])
      if (r.files.some(f => f.kind === 'music')) setFolder(r.folder)
      setNeedAccess(false)
      onNotice(`Carpeta «${r.folder}»: ${r.files.length} archivos añadidos a Materiales sin subirlos a la nube. Se leen desde tu disco.`)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setHint(true)
      else { setHint(true); onError(e instanceof Error ? e.message : 'No se pudo leer la carpeta.') }
    } finally { setBusy('') }
  }

  // Plain file input with a folder: works in browsers where the folder dialog above does not (files valid while the page is open).
  async function picked(list: FileList | null) {
    if (!list?.length) return
    onError(''); setBusy('Leyendo la carpeta…')
    try {
      const r = await registerPickedFiles([...list], (d, t) => setBusy(`Leyendo la carpeta… ${d}/${t}`))
      const others = files.filter(f => !r.files.some(x => x.id === f.id))
      onFiles([...others, ...r.files])
      if (r.files.some(f => f.kind === 'music')) setFolder(r.folder)
      onNotice(`Carpeta «${r.folder}»: ${r.files.length} archivos añadidos a Materiales sin subirlos a la nube. Se leen desde tu disco mientras esta página esté abierta.`)
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo leer la carpeta.') } finally { setBusy(''); if (inputRef.current) inputRef.current.value = '' }
  }

  function build() {
    onError('')
    try {
      // Clips from the disk: their real length is known from the folder (the editor may not know it).
      const known = { ...comp, clips: comp.clips.map(k => { const f = files.find(x => x.id === k.visualAssetId); return f?.durationMs && !k.sourceDurationMs ? { ...k, sourceDurationMs: f.durationMs } : k }) }
      const r = buildLofiMontage(known, { songs: songs.map(f => ({ assetId: f.id, durationMs: f.durationMs ?? 0 })), crossfadeMs: xfSec * 1000, transitionMs: trSec * 1000, wholeClips })
      apply(() => r.composition)
      onNotice(`Listo: ${songs.length} canciones en fila con fundidos de ${xfSec} s y el vídeo repetido en ${r.clips} clips con transición de ${trSec} s. Duración total ${fmt(r.totalMs)}.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`)
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo preparar el montaje.') }
  }

  const fsa = localFolderSupported()
  return <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Materiales de mi disco">
    <b className="small">Materiales de mi disco (sin subir)</b>
    <span className="muted small">Elige una carpeta, por ejemplo de tu disco externo. Sus canciones, vídeos e imágenes aparecen en Materiales y se leen desde el disco: no ocupan espacio en la nube.</span>
    {fsa && <button type="button" className="ghost" disabled={!!busy} onClick={() => void pick()}>Usar una carpeta de mi disco…</button>}
    <input ref={inputRef} type="file" multiple hidden onChange={e => void picked(e.target.files)} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
    <button type="button" className="ghost" disabled={!!busy} onClick={() => inputRef.current?.click()}>Elegir la carpeta (otra forma)…</button>
    {hint && <span className="muted small">Si no se abrió ninguna ventana para elegir la carpeta, usa «Elegir la carpeta (otra forma)».</span>}
    {needAccess && <button type="button" className="ghost" onClick={() => void grantLocalAccess().then(ok => { setNeedAccess(!ok); if (!ok) onError('Sin permiso no se pueden leer los archivos del disco.') })}>Dar acceso a mis carpetas del disco</button>}
    {busy && <span className="muted small" role="status">{busy}</span>}
    {folders.length > 0 && <>
      <b className="small">Música en fila y vídeo en bucle</b>
      <span className="muted small">Pone todas las canciones de la carpeta una detrás de otra con un fundido suave entre ellas, y repite los clips que tienes ahora en la línea de tiempo (con tus cortes) hasta que acabe la música. Sustituye la música que hubiera.</span>
      <label>Carpeta de música<select value={folder} onChange={e => setFolder(e.target.value)}>{folders.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
      <span className="muted small">{songs.length} canciones · {fmt(musicMs)}</span>
      <div className="field-row">
        <label>Fundido entre canciones (s)<input type="number" min={0} max={15} step={0.5} value={xfSec} onChange={e => setXfSec(Math.max(0, Math.min(15, Number(e.target.value) || 0)))} /></label>
        <label>Transición entre clips (s)<input type="number" min={0} max={3} step={0.05} value={trSec} onChange={e => setTrSec(Math.max(0, Math.min(3, Number(e.target.value) || 0)))} /></label>
      </div>
      <label className="pill small"><input type="checkbox" checked={wholeClips} onChange={e => setWholeClips(e.target.checked)} /> Bucle perfecto: cada clip entero, del primer al último fotograma (el corte une el final del vídeo con su inicio)</label>
      <button type="button" disabled={!songs.length || !comp.clips.length} onClick={build}>Montar vídeo completo con esta música</button>
    </>}
  </section>
}
