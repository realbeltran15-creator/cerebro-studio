'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { classify, formatBytes } from '@/lib/ingest/files'
import { IngestError, ingestFile, type Destination } from '@/lib/ingest/upload'
import { downloadPicked, pickFromDrive, type DrivePick } from '@/lib/ingest/drive'
import { pickerConfigFromEnv } from '@/lib/flow-import'
import { manualEditorHref } from '@/lib/editor/from-assets'
import type { UploadKind } from '@/lib/media-upload'

type Project = { id: string; name: string }
type Status = 'waiting' | 'working' | 'done' | 'duplicate' | 'error' | 'cancelled'
type Row = {
  id: string; name: string; size: number; kind: UploadKind | null; source: 'device' | 'drive'
  file?: File; drive?: DrivePick; status: Status; stage?: string; sent: number; message?: string; assetId?: string; destination: Destination; allowDuplicate?: boolean
}
const DEST_KEY = 'cerebro-add-destination'
const KIND_LABEL: Record<UploadKind, string> = { video: 'Vídeo', image: 'Imagen', voice: 'Voz', music: 'Música', sfx: 'Efecto' }

/**
 * «Añadir materiales»: one panel for everything that comes in — this device (on iPhone: Fotos, Archivos, Notas de Voz… through Safari's
 * picker), Google Drive, and the iPhone share sheet through a Shortcut. Files keep their original bytes and go to the general Library
 * or to a project; they appear in the Library and in the Editor of any device with the same account.
 */
export default function AddMaterialsPage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [destination, setDestination] = useState<Destination>('library')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [driveToken, setDriveToken] = useState('')
  const [maxBytes, setMaxBytes] = useState(50 * 1024 * 1024)
  const running = useRef(false)
  const rowsRef = useRef<Row[]>([])
  useEffect(() => { rowsRef.current = rows }, [rows])
  const aborts = useRef(new Map<string, AbortController>())
  const driveConfig = useMemo(() => pickerConfigFromEnv(), [])

  useEffect(() => {
    void supabase.from('projects').select('id,name').order('updated_at', { ascending: false }).then(({ data }: { data: unknown[] | null }) => {
      const list = (data ?? []) as Project[]
      setProjects(list)
      const wanted = new URLSearchParams(window.location.search).get('project')
      let saved: string | null = null
      try { saved = localStorage.getItem(DEST_KEY) } catch { /* private mode */ }
      const pick = [wanted, saved].find(x => x === 'library' || list.some(p => p.id === x))
      if (pick) setDestination(pick)
    })
  }, [supabase])
  const chooseDestination = (d: Destination) => { setDestination(d); try { localStorage.setItem(DEST_KEY, d) } catch { /* ignore */ } }
  const update = (id: string, p: Partial<Row>) => setRows(list => list.map(r => (r.id === id ? { ...r, ...p } : r)))

  function addDeviceFiles(files: File[]) {
    setError('')
    setRows(list => [...list, ...files.map((f): Row => {
      const c = classify(f.name, f.type)
      const tooBig = f.size > maxBytes
      return { id: crypto.randomUUID(), name: f.name, size: f.size, kind: c.ok ? c.kind : null, source: 'device', file: f, destination, sent: 0,
        status: !c.ok || tooBig ? 'error' : 'waiting', message: !c.ok ? c.reason : tooBig ? `Pesa ${formatBytes(f.size)}; el almacenamiento actual admite ${formatBytes(maxBytes)} por archivo. Recórtalo en el iPhone (Fotos › Editar) o divídelo.` : c.note }
    })])
  }

  async function addFromDrive() {
    if (!driveConfig) return
    setError('')
    try {
      const { token, files } = await pickFromDrive(driveConfig)
      setDriveToken(token)
      setRows(list => [...list, ...files.map((d): Row => {
        const c = classify(d.name, d.mimeType)
        return { id: crypto.randomUUID(), name: d.name, size: d.sizeBytes ?? 0, kind: c.ok ? c.kind : null, source: 'drive', drive: d, destination, sent: 0, status: c.ok ? 'waiting' : 'error', message: c.ok ? undefined : c.reason }
      })])
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir Google Drive.') }
  }

  // One file at a time: friendlier to phone connections and to the storage quota; the next starts when the previous ends.
  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        await new Promise(r => setTimeout(r, 0))
        const next = rowsRef.current.find(r => r.status === 'waiting')
        if (!next) break
        const ac = new AbortController()
        aborts.current.set(next.id, ac)
        update(next.id, { status: 'working', stage: 'Preparando…', message: undefined })
        try {
          const file = next.file ?? (next.drive ? await downloadPicked(next.drive, driveToken, maxBytes, ac.signal) : null)
          if (!file) throw new IngestError('Archivo no disponible.')
          if (!next.file) update(next.id, { file, size: file.size })
          const r = await ingestFile(supabase, file, {
            destination: next.destination, source: next.source, kind: next.kind ?? undefined, allowDuplicate: next.allowDuplicate, signal: ac.signal,
            onStage: stage => update(next.id, { stage }), onProgress: sent => update(next.id, { sent }),
            extra: next.drive ? { driveFileId: next.drive.id } : undefined,
          })
          update(next.id, r.status === 'duplicate'
            ? { status: 'duplicate', assetId: r.assetId, message: 'Ya está en tu Biblioteca: no se ha subido otra vez.' }
            : { status: 'done', assetId: r.assetId, sent: file.size, message: r.resumedFrom ? `Continuó desde ${formatBytes(r.resumedFrom)}.` : undefined })
        } catch (e) {
          const cancelled = (e as Error).name === 'AbortError'
          update(next.id, { status: cancelled ? 'cancelled' : 'error', message: cancelled ? 'Cancelado.' : (e as Error).message })
        } finally { aborts.current.delete(next.id) }
      }
    } finally { running.current = false }
  }, [supabase, driveToken, maxBytes])

  useEffect(() => { if (rows.some(r => r.status === 'waiting')) void pump() }, [rows, pump])
  // The real per-file limit of the active storage (Supabase Free: 50 MB).
  useEffect(() => {
    void fetch('/api/storage/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'library', folder: 'uploads', ext: 'mp4', contentType: 'video/mp4', size: 0 }) })
      .then(r => r.json()).then((j: { maxBytes?: number; driver?: string }) => { if (j.maxBytes) setMaxBytes(j.maxBytes); else if (j.driver === 'r2') setMaxBytes(Number.MAX_SAFE_INTEGER) }).catch(() => undefined)
  }, [])

  const destName = (d: Destination) => (d === 'library' ? 'Biblioteca general' : projects.find(p => p.id === d)?.name ?? 'Proyecto')
  const active = rows.filter(r => r.status === 'working' || r.status === 'waiting').length
  const finished = rows.filter(r => r.status === 'done' && r.assetId)
  const byProject = finished.filter(r => r.destination !== 'library')

  return <StudioShell title="Añadir materiales" eyebrow="BIBLIOTECA">
    {error && <p className="error" role="alert">{error}</p>}
    <section className="panel addPanel" aria-label="Dónde se guardan">
      <label className="addDest">¿Dónde los guardo?
        <select aria-label="Destino" value={destination} onChange={e => chooseDestination(e.target.value)}>
          <option value="library">Biblioteca general (sin proyecto)</option>
          {projects.map(p => <option key={p.id} value={p.id}>Proyecto: {p.name}</option>)}
        </select>
      </label>
      <p className="muted small">Se suben los archivos originales, sin comprimir ni convertir. Aparecen en la Biblioteca y en el Editor de cualquier dispositivo con tu cuenta. Máximo por archivo con el almacenamiento actual: <b>{maxBytes >= Number.MAX_SAFE_INTEGER ? 'sin límite práctico' : formatBytes(maxBytes)}</b>.</p>
    </section>

    <section className="addSources" aria-label="Fuentes">
      <label className="addSource" htmlFor="add-device">
        <span className="addIcon" aria-hidden="true">📱</span>
        <b>Fotos, Archivos o este equipo</b>
        <span className="muted small">En el iPhone abre la Fototeca, la cámara o la app Archivos (Notas de Voz: guárdala antes en Archivos). Puedes elegir varios.</span>
        <input id="add-device" type="file" multiple accept="video/*,image/*,audio/*,.m4a,.mov,.mp4,.mp3,.wav,.aac" onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; addDeviceFiles(f) }} />
      </label>
      <button type="button" className="addSource" onClick={() => void addFromDrive()} disabled={!driveConfig} aria-describedby="drive-note">
        <span className="addIcon" aria-hidden="true">🗂️</span>
        <b>Google Drive</b>
        <span id="drive-note" className="muted small">{driveConfig ? 'Eliges los archivos en el selector oficial de Google; solo esos quedan accesibles.' : 'No configurado en este entorno: faltan los tres identificadores públicos del selector de Google (NEXT_PUBLIC_GOOGLE_PICKER_*).'}</span>
      </button>
      <a className="addSource" href="#compartir-iphone">
        <span className="addIcon" aria-hidden="true">↗️</span>
        <b>Compartir desde el iPhone</b>
        <span className="muted small">Con un Atajo de iOS: aparece en el menú Compartir de Fotos, Archivos y Notas de Voz.</span>
      </a>
    </section>

    {rows.length > 0 && <section className="panel" aria-label="Subidas">
      <div className="cardHead"><h3>Subidas</h3><span className="muted small">{active ? `${active} pendiente${active === 1 ? '' : 's'}` : 'Todo terminado'}</span></div>
      <ul className="plainList addQueue">{rows.map(r => {
        const pct = r.size ? Math.round(r.sent / r.size * 100) : 0
        return <li key={r.id} className={`addRow ${r.status}`} aria-label={`Subida ${r.name}`}>
          <div className="addRowHead">
            <b className="addName">{r.name}</b>
            <span className="muted small">{r.size ? formatBytes(r.size) : ''} · {destName(r.destination)}</span>
          </div>
          {r.kind && (r.kind === 'voice' || r.kind === 'music' || r.kind === 'sfx') && r.status === 'waiting' && <label className="small">Usar como <select aria-label={`Tipo de ${r.name}`} value={r.kind} onChange={e => update(r.id, { kind: e.target.value as UploadKind })}><option value="voice">Voz</option><option value="music">Música</option><option value="sfx">Efecto</option></select></label>}
          {r.status === 'working' && <><progress value={r.sent} max={r.size || 1} aria-label={`Progreso de ${r.name}`} /><span className="small">{r.stage} {pct > 0 ? `${pct} %` : ''}</span></>}
          {r.message && <span className={`small ${r.status === 'error' ? 'errorText' : 'muted'}`}>{r.message}</span>}
          <div className="pageActions">
            {r.kind && <span className="pill small">{KIND_LABEL[r.kind]}</span>}
            {r.status === 'done' && <span className="pill ok small">Subido</span>}
            {r.status === 'working' && <button type="button" className="ghost small" onClick={() => aborts.current.get(r.id)?.abort()}>Cancelar</button>}
            {r.status === 'waiting' && <button type="button" className="ghost small" onClick={() => update(r.id, { status: 'cancelled', message: 'Cancelado.' })}>Quitar</button>}
            {(r.status === 'error' || r.status === 'cancelled') && r.kind && (r.file || r.drive) && <button type="button" className="ghost small" onClick={() => update(r.id, { status: 'waiting', message: undefined })}>Reintentar</button>}
            {r.status === 'duplicate' && <button type="button" className="ghost small" onClick={() => update(r.id, { status: 'waiting', allowDuplicate: true, message: undefined })}>Subir igualmente</button>}
          </div>
        </li>
      })}</ul>
      {finished.length > 0 && <div className="pageActions" style={{ marginTop: 10 }}>
        <Link className="buttonLink" href="/library">Ver en la Biblioteca</Link>
        {byProject.length > 0 && <Link className="buttonLink ghost" href={manualEditorHref(byProject[0].destination, byProject.filter(r => r.destination === byProject[0].destination).map(r => r.assetId!))}>Abrir en el Editor</Link>}
      </div>}
    </section>}

    <ShortcutSetup projects={projects} />
  </StudioShell>
}

/** iPhone share sheet through Apple Shortcuts: personal code, destination and the exact steps. */
function ShortcutSetup({ projects }: { projects: Project[] }) {
  const [status, setStatus] = useState<{ active: boolean; createdAt: string | null; destination: string; lastUsedAt: string | null; uploads: number; serverReady: boolean } | null>(null)
  const [token, setToken] = useState('')
  const [dest, setDest] = useState('library')
  const [msg, setMsg] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const load = useCallback(() => fetch('/api/ios/token', { cache: 'no-store' }).then(r => r.json()).then((j: NonNullable<typeof status>) => { setStatus(j); setDest(j.destination ?? 'library') }).catch(() => setStatus(null)), [])
  useEffect(() => { void load() }, [load])
  async function create() {
    setMsg('')
    const r = await fetch('/api/ios/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: dest }) })
    const j = await r.json().catch(() => ({})) as { token?: string; error?: string }
    if (!r.ok || !j.token) { setMsg(j.error ?? 'No se pudo crear el código.'); return }
    setToken(j.token); void load()
  }
  async function changeDest(d: string) {
    setDest(d)
    if (status?.active) { const r = await fetch('/api/ios/token', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: d }) }); setMsg(r.ok ? 'Destino del atajo actualizado.' : 'No se pudo cambiar el destino.') }
  }
  async function revoke() { await fetch('/api/ios/token', { method: 'DELETE' }); setToken(''); setConfirmRevoke(false); setMsg('Código revocado: el atajo deja de funcionar.'); void load() }
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => setMsg('Copiado.'), () => setMsg('No se pudo copiar; mantenlo pulsado y copia.')) }

  return <section id="compartir-iphone" className="panel" aria-label="Compartir desde el iPhone" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
    <h3>Compartir desde el iPhone (menú Compartir)</h3>
    <p className="small">Safari en iPhone no permite que una web aparezca en el menú Compartir (Apple no admite «Web Share Target»). La forma sin app ni coste es un <b>Atajo de iOS</b> llamado «Cerebro Studio»: aparece en Compartir de Fotos, Archivos y Notas de Voz y sube el archivo original directamente a tu almacenamiento privado.</p>
    {status && !status.serverReady && <p className="warning small" role="alert">En este entorno falta la clave de servidor de Supabase, así que el atajo responderá «no activado». La subida desde Safari (arriba) sí funciona.</p>}
    <p className="warning small">Esta Preview está protegida con Vercel Authentication: Safari puede entrar (iniciando sesión en Vercel), pero un Atajo no. Para usar el atajo contra la Preview hay que crear en Vercel un «Protection Bypass for Automation» (Settings › Deployment Protection) y añadirlo como cabecera en el atajo; la Preview sigue privada. En Producción no hace falta.</p>
    <label>Destino del atajo<select aria-label="Destino del atajo" value={dest} onChange={e => void changeDest(e.target.value)}><option value="library">Biblioteca general</option>{projects.map(p => <option key={p.id} value={p.id}>Proyecto: {p.name}</option>)}</select></label>
    {status?.active ? <p className="small">Código activo desde {new Date(status.createdAt!).toLocaleString()} · {status.uploads} archivos recibidos{status.lastUsedAt ? ` · último ${new Date(status.lastUsedAt).toLocaleString()}` : ''}.</p> : <p className="muted small">Todavía no tienes código para el atajo.</p>}
    <div className="pageActions">
      <button type="button" onClick={() => void create()}>{status?.active ? 'Generar un código nuevo (anula el anterior)' : 'Generar código del atajo'}</button>
      {status?.active && (confirmRevoke ? <><button type="button" className="ghost" onClick={() => void revoke()}>Confirmar: revocar</button><button type="button" className="ghost" onClick={() => setConfirmRevoke(false)}>Cancelar</button></> : <button type="button" className="ghost" onClick={() => setConfirmRevoke(true)}>Revocar</button>)}
    </div>
    {token && <div className="styleBox" role="group" aria-label="Código del atajo">
      <b className="small">Tu código (solo se muestra ahora; guárdalo en el atajo):</b>
      <code className="tokenBox">{token}</code>
      <button type="button" className="small" onClick={() => copy(token)}>Copiar código</button>
    </div>}
    {msg && <p className="notice small" role="status">{msg}</p>}
    <details open={Boolean(token)}>
      <summary><b>Crear el atajo en el iPhone (una vez, unos 3 minutos)</b></summary>
      <ol className="small addSteps">
        <li>Abre la app <b>Atajos</b> › pestaña <b>Atajos</b> › <b>+</b>. Nómbralo <b>Cerebro Studio</b>.</li>
        <li>Toca <b>ⓘ</b> (Detalles) › activa <b>Mostrar en hoja para compartir</b>. En «Recibir» deja <b>Imágenes, Multimedia y Archivos</b>.</li>
        <li>Añade <b>Repetir con cada</b> elemento de la <b>Entrada del atajo</b>. Dentro del bucle:</li>
        <li><b>Obtener contenido de URL</b> → URL <code>{origin}/api/ios/start</code> · Método <b>POST</b> · Cabeceras: <code>Authorization</code> = <code>Bearer TU_CÓDIGO</code> · Cuerpo <b>JSON</b>: <code>name</code> = <i>Elemento de repetición › Nombre</i> (con su extensión: usa «Nombre» y añade «.» + «Extensión de archivo»), <code>size</code> = <i>Elemento de repetición › Tamaño del archivo</i>.</li>
        <li><b>Obtener valor del diccionario</b> «putUrl» del resultado; otro para «contentType» y otro para «path».</li>
        <li><b>Obtener contenido de URL</b> → URL = <i>putUrl</i> · Método <b>PUT</b> · Cabecera <code>Content-Type</code> = <i>contentType</i> · Cuerpo <b>Archivo</b> = <i>Elemento de repetición</i>.</li>
        <li><b>Obtener contenido de URL</b> → URL <code>{origin}/api/ios/finish</code> · <b>POST</b> · Cabecera <code>Authorization</code> = <code>Bearer TU_CÓDIGO</code> · Cuerpo <b>JSON</b>: <code>path</code> = <i>path</i>, <code>name</code> = el mismo nombre del paso 4.</li>
        <li>Fuera del bucle: <b>Mostrar notificación</b> con el resultado (dice «Guardado en Cerebro Studio…» o el motivo del error).</li>
      </ol>
      <p className="muted small">Si usas la Preview privada, añade en los pasos 4 y 7 la cabecera <code>x-vercel-protection-bypass</code> con el valor que te dé Vercel. Archivos de más de {formatBytes(50 * 1024 * 1024)} se rechazan con un aviso (límite del almacenamiento gratuito).</p>
    </details>
  </section>
}
