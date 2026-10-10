'use client'

import { useMemo, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { mediaDuration, uploadProjectMedia, validateUpload } from '@/lib/media-upload'
import { mp4Codecs } from '@/lib/editor/container'
import {
  DRIVE_FILE_SCOPE, FLOW_MAX_BYTES, FLOW_URL, driveDownloadUrl, flowLicense, flowProvenance, followUps, pickedProblem, pickerConfigFromEnv,
  type FlowSource, type PickedFile,
} from '@/lib/flow-import'
import { Icon } from './studio-icon'
import { manualEditorHref } from '@/lib/editor/from-assets'

type Row = { key: string; title: string; source: FlowSource; picked?: PickedFile; file?: File; status: 'ready' | 'importing' | 'done' | 'error'; error?: string; notes?: string[]; assetId?: string }

// Minimal typings for the two Google scripts (loaded on demand, only when the user presses the Drive button).
type PickerDoc = { id: string; name: string; mimeType: string; sizeBytes?: number }
type PickerResponse = { action: string; docs?: PickerDoc[] }
type Google = {
  accounts: { oauth2: { initTokenClient: (c: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void }) => { requestAccessToken: (o?: { prompt?: string }) => void } } }
  picker: {
    ViewId: { DOCS_VIDEOS: string }
    Feature: { MULTISELECT_ENABLED: string }
    Action: { PICKED: string }
    DocsView: new (id: string) => { setMimeTypes(m: string): unknown; setIncludeFolders(v: boolean): unknown; setSelectFolderEnabled(v: boolean): unknown }
    PickerBuilder: new () => {
      addView(v: unknown): unknown; setOAuthToken(t: string): unknown; setDeveloperKey(k: string): unknown; setAppId(a: string): unknown
      enableFeature(f: string): unknown; setCallback(cb: (r: PickerResponse) => void): unknown; build(): { setVisible(v: boolean): void }
    }
  }
}
declare global { interface Window { google?: Google; gapi?: { load(name: string, cb: () => void): void } } }

const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
  const s = document.createElement('script')
  s.src = src; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('No se pudo cargar un script de Google.'))
  document.head.appendChild(s)
})

/**
 * "Importar desde Google Flow". Flow has no public API to list your videos, so the selection is yours:
 * pick files from Google Drive (official Picker, access only to the files you tick) or drop the MP4s you downloaded from Flow.
 * Nothing is read or imported until you press «Importar»; after importing, the videos are in the Library, the Editor and the automatic editor.
 */
export function FlowImport({ projectId, sceneId, onImported }: { projectId: string; sceneId?: string | null; onImported?: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const config = useMemo(() => pickerConfigFromEnv(), [])
  const token = useRef('')
  const [rows, setRows] = useState<Row[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fileKey, setFileKey] = useState(0)

  const addRows = (next: Row[]) => setRows(list => [...list, ...next.filter(n => !list.some(r => r.key === n.key))])
  const update = (key: string, patch: Partial<Row>) => setRows(list => list.map(r => r.key === key ? { ...r, ...patch } : r))

  function pickLocal(files: FileList | null) {
    setError(''); setNotice('')
    addRows(Array.from(files ?? []).map(file => {
      const bad = validateUpload('video', file)
      return { key: `local:${file.name}:${file.size}:${file.lastModified}`, title: file.name.replace(/\.[^.]+$/, ''), source: { kind: 'local' } as FlowSource, file, status: bad ? 'error' : 'ready', error: bad ?? undefined } as Row
    }))
    setFileKey(k => k + 1)
  }

  async function openDrive() {
    if (!config) return
    setError(''); setNotice('')
    try {
      await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')])
      await new Promise<void>(resolve => window.gapi!.load('picker', () => resolve()))
      const g = window.google!
      token.current = await new Promise<string>((resolve, reject) => {
        g.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope: DRIVE_FILE_SCOPE, callback: r => r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? 'Google no concedió el acceso.')) }).requestAccessToken({ prompt: '' })
      })
      const view = new g.picker.DocsView(g.picker.ViewId.DOCS_VIDEOS)
      view.setMimeTypes('video/mp4,video/webm,video/quicktime'); view.setIncludeFolders(true); view.setSelectFolderEnabled(false)
      const picker = new g.picker.PickerBuilder()
      picker.addView(view); picker.setOAuthToken(token.current); picker.setDeveloperKey(config.apiKey); picker.setAppId(config.appId)
      picker.enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
      picker.setCallback(r => {
        if (r.action !== g.picker.Action.PICKED) return
        addRows((r.docs ?? []).map(d => {
          const picked: PickedFile = { id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes }
          const bad = pickedProblem(picked)
          return { key: `drive:${d.id}`, title: d.name.replace(/\.[^.]+$/, ''), source: { kind: 'drive', fileId: d.id } as FlowSource, picked, status: bad ? 'error' : 'ready', error: bad ?? undefined } as Row
        }))
      })
      ;(picker.build() as { setVisible(v: boolean): void }).setVisible(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir Google Drive.') }
  }

  async function fetchDrive(row: Row) {
    const response = await fetch(driveDownloadUrl(row.picked!.id), { headers: { Authorization: `Bearer ${token.current}` }, cache: 'no-store' })
    if (!response.ok) throw new Error(response.status === 403 || response.status === 404 ? 'Drive no deja leer este archivo (¿lo elegiste en el selector?).' : `Drive respondió ${response.status}.`)
    const blob = await response.blob()
    if (blob.size > FLOW_MAX_BYTES) throw new Error(`Supera ${FLOW_MAX_BYTES / 1048576} MB.`)
    return new File([blob], row.picked!.name, { type: row.picked!.mimeType })
  }

  async function run() {
    if (!projectId || busy) return
    setBusy(true); setError(''); setNotice('')
    const license = flowLicense(confirmed)
    let done = 0
    for (const row of rows) {
      if (row.status === 'done' || row.status === 'error') continue
      update(row.key, { status: 'importing', error: undefined })
      try {
        const file = row.file ?? await fetchDrive(row)
        const bad = validateUpload('video', file)
        if (bad) throw new Error(bad)
        // Real codecs from the MP4 itself, so the follow-up steps (Instagram, conversion) are known from the start.
        const codec = file.type === 'video/mp4' ? mp4Codecs(new Uint8Array(await file.arrayBuffer())) : null
        const provenance = flowProvenance({ originalFilename: file.name, source: row.source, prompt, codec, mime: file.type })
        const saved = await uploadProjectMedia(supabase, {
          projectId, kind: 'video', file, title: row.title || file.name, license: license.status, licenseNotes: license.notes,
          sourceUrl: FLOW_URL, provider: 'google-flow-import', extra: { ...provenance, sceneId: sceneId ?? null, durationSeconds: await mediaDuration(file) },
        })
        update(row.key, { status: 'done', notes: followUps(provenance), assetId: saved.id }); done++
      } catch (e) { update(row.key, { status: 'error', error: e instanceof Error ? e.message : 'No se pudo importar.' }) }
    }
    setBusy(false)
    if (done) { setNotice(`${done} vídeo(s) importados con su procedencia.`); onImported?.() }
  }

  const ready = rows.filter(r => r.status === 'ready').length
  const importedIds = rows.filter(r => r.status === 'done' && r.assetId).map(r => r.assetId!)
  const imported = importedIds.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ margin: 0 }}>
        <b>Importar vídeos creados en Google Flow</b>
        <p className="muted small" style={{ margin: '6px 0' }}>
          Flow no ofrece una API pública para listar tus vídeos. Elige tú los archivos: desde Google Drive con el selector oficial (la app solo puede leer los que marques) o arrastrando los MP4 que descargaste de Flow.
          Hasta que pulses «Importar» no se lee ni se guarda nada.
        </p>
        <p className="muted small" style={{ margin: 0 }}><a href={FLOW_URL} target="_blank" rel="noopener noreferrer">Abrir Google Flow</a> · límite {FLOW_MAX_BYTES / 1048576} MB por vídeo.</p>
      </div>

      <div className="chips" style={{ alignItems: 'center' }}>
        <button type="button" className="ghost" onClick={() => void openDrive()} disabled={!config || busy} aria-describedby="flow-drive-note"><Icon name="search" size={14} /> Elegir de Google Drive</button>
        <label htmlFor="flow-files" className="inline">o archivos descargados
          <input key={fileKey} id="flow-files" type="file" accept="video/mp4,video/webm,video/quicktime" multiple onChange={e => pickLocal(e.target.files)} />
        </label>
      </div>
      <p id="flow-drive-note" className="muted small" style={{ marginTop: -6 }}>
        {config ? 'Google te pedirá permiso solo para los archivos que elijas (permiso «drive.file»).' : 'El selector de Drive necesita NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID, NEXT_PUBLIC_GOOGLE_PICKER_API_KEY y NEXT_PUBLIC_GOOGLE_PICKER_APP_ID (son identificadores públicos, no secretos). Mientras tanto puedes subir los archivos descargados.'}
      </p>

      <label htmlFor="flow-prompt">Prompt usado en Flow (opcional)
        <textarea id="flow-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={2000} rows={2} placeholder="Se guarda con el vídeo como procedencia." />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        Confirmo que creé estos vídeos con mi cuenta de Google Flow y puedo usarlos según sus condiciones
      </label>
      <p className={confirmed ? 'notice' : 'muted small'} role="status">
        {confirmed ? 'Se guardarán con tu declaración de origen; revisa las condiciones de Google antes de publicar.' : 'Sin confirmar se guardan como «Restringido»: la publicación queda bloqueada hasta que marques la licencia.'}
      </p>

      {rows.length > 0 && (
        <ul className="list" aria-label="Vídeos seleccionados">
          {rows.map(r => (
            <li key={r.key}>
              <b>{r.title}</b> <span className="pill">{r.source.kind === 'drive' ? 'Drive' : 'Archivo'}</span>{' '}
              {r.status === 'importing' && <span className="pill info">Importando…</span>}
              {r.status === 'done' && <span className="pill ok">Importado</span>}
              {r.status === 'error' && <span className="pill warn" role="alert">{r.error}</span>}
              {r.notes && <ul className="muted small">{r.notes.map(n => <li key={n}>{n}</li>)}</ul>}
            </li>
          ))}
        </ul>
      )}

      <div className="chips">
        <button type="button" onClick={() => void run()} disabled={busy || !projectId || ready === 0}>{busy ? 'Importando…' : `Importar ${ready || ''} seleccionado(s)`}</button>
        {rows.length > 0 && !busy && <button type="button" className="ghost" onClick={() => setRows([])}>Vaciar selección</button>}
        {imported && <>
          <a className="buttonLink" href={manualEditorHref(projectId, importedIds)}>Editar en el Editor manual</a>
          <a className="buttonLink ghost" href={`/editor/auto?project=${projectId}`} title="Quita silencios y corta por planos de un vídeo en bruto">Montaje automático de un vídeo</a>
        </>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </div>
  )
}
