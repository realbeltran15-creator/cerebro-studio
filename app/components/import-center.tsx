'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { classify, formatBytes } from '@/lib/ingest/files'
import { IngestError, ingestFile } from '@/lib/ingest/upload'
import { downloadPicked, pickFromDrive, type DriveFilter, type DrivePick } from '@/lib/ingest/drive'
import { pickerConfigFromEnv } from '@/lib/flow-import'
import { mediaDuration, type UploadKind } from '@/lib/media-upload'
import { audioDurationMs } from '@/lib/editor/client'
import { sourceStatuses, type SourceStatus } from '@/lib/ingest/sources'

export type ImportedItem = { assetId: string; kind: UploadKind; durationMs: number | null; duplicate: boolean; name: string }
type Status = 'waiting' | 'working' | 'done' | 'duplicate' | 'error' | 'cancelled'
type Row = {
  id: string; name: string; size: number; kind: UploadKind | null; source: 'device' | 'drive'
  file?: File; drive?: DrivePick; token?: string; status: Status; stage?: string; sent: number; message?: string; assetId?: string; durationMs?: number | null
}

const STATE_LABEL: Record<SourceStatus['state'], string> = { available: 'disponible', needs_connection: 'requiere conexión', needs_config: 'requiere configuración', unsupported: 'no compatible', planned: 'aún no disponible' }

/**
 * Importar materiales (Materiales → cualquier pestaña): this device (picker, drag and drop) and Google Drive through the official Picker.
 * Every file goes through `ingestFile`: type/size check → fingerprint → duplicate check → resumable upload of the ORIGINAL bytes → asset row.
 * Drive files are matched by their Drive id first, so a file imported before is reused without transferring it again.
 * Honest note: a Drive file travels Drive → this browser → Cerebro Studio storage (it is not written to disk and nothing is downloaded by hand).
 */
export function ImportCenter({ supabase, projectId, section, audioKind, maxBytes, onImported, onError }: {
  supabase: SupabaseClient; projectId: string; section: 'visual' | 'audio'; audioKind: 'music' | 'sfx' | 'voice'
  maxBytes: number; onImported: (items: ImportedItem[]) => void; onError?: (m: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const rowsRef = useRef<Row[]>([])
  useEffect(() => { rowsRef.current = rows }, [rows])
  const running = useRef(false)
  const onImportedRef = useRef(onImported)
  useEffect(() => { onImportedRef.current = onImported })
  const aborts = useRef(new Map<string, AbortController>())
  const batch = useRef<ImportedItem[]>([])
  const driveConfig = useMemo(() => pickerConfigFromEnv(), [])
  const sources = useMemo(() => sourceStatuses({ driveConfigured: !!driveConfig }), [driveConfig])
  const filter: DriveFilter = section === 'audio' ? 'audio' : 'video'
  const update = (id: string, p: Partial<Row>) => setRows(list => list.map(r => (r.id === id ? { ...r, ...p } : r)))

  const kindFor = useCallback((name: string, mime: string): { kind: UploadKind | null; problem?: string } => {
    const c = classify(name, mime)
    if (!c.ok) return { kind: null, problem: c.reason }
    return { kind: c.kind === 'music' || c.kind === 'voice' ? audioKind : c.kind }
  }, [audioKind])

  function addDevice(files: File[]) {
    onError?.('')
    setRows(list => [...list, ...files.map((f): Row => {
      const { kind, problem } = kindFor(f.name, f.type)
      const tooBig = f.size > maxBytes
      return { id: crypto.randomUUID(), name: f.name, size: f.size, kind, source: 'device', file: f, sent: 0,
        status: !kind || tooBig ? 'error' : 'waiting', message: problem ?? (tooBig ? `Pesa ${formatBytes(f.size)}; el almacenamiento actual admite ${formatBytes(maxBytes)} por archivo.` : undefined) }
    })])
  }

  async function addDrive() {
    if (!driveConfig) return
    onError?.('')
    try {
      const { token, files } = await pickFromDrive(driveConfig, filter)
      setRows(list => [...list, ...files.map((d): Row => {
        const { kind, problem } = kindFor(d.name, d.mimeType)
        const tooBig = typeof d.sizeBytes === 'number' && d.sizeBytes > maxBytes
        return { id: crypto.randomUUID(), name: d.name, size: d.sizeBytes ?? 0, kind, source: 'drive', drive: d, token, sent: 0,
          status: !kind || tooBig ? 'error' : 'waiting', message: problem ?? (tooBig ? `Pesa ${formatBytes(d.sizeBytes!)}; el almacenamiento actual admite ${formatBytes(maxBytes)} por archivo.` : undefined) }
      })])
    } catch (e) { onError?.(e instanceof Error ? e.message : 'No se pudo abrir Google Drive.') }
  }

  /** A Drive file imported earlier (same Drive id and size) is reused: nothing is downloaded. */
  async function alreadyImported(d: DrivePick): Promise<{ id: string; project_id: string | null; provenance: Record<string, unknown> | null } | null> {
    const { data } = await supabase.from('assets').select('id,project_id,provenance').eq('provenance->>driveFileId', d.id).order('created_at', { ascending: false }).limit(5)
    const list = (data ?? []) as Array<{ id: string; project_id: string | null; provenance: Record<string, unknown> | null }>
    const fits = list.filter(a => typeof d.sizeBytes !== 'number' || a.provenance?.bytes === d.sizeBytes)
    return fits.find(a => a.project_id === projectId) ?? fits.find(a => a.project_id === null) ?? null
  }

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
          if (next.drive) {
            update(next.id, { stage: 'Comprobando si ya está en tu Biblioteca…' })
            const dup = await alreadyImported(next.drive)
            if (dup) {
              const ms = typeof dup.provenance?.durationSeconds === 'number' ? Math.round(dup.provenance.durationSeconds * 1000) : next.kind === 'image' ? null : await audioDurationMs(dup.id).catch(() => null)
              update(next.id, { status: 'duplicate', assetId: dup.id, durationMs: ms, message: 'Ya estaba importado: se reutiliza sin descargarlo otra vez.' })
              batch.current.push({ assetId: dup.id, kind: next.kind!, durationMs: ms, duplicate: true, name: next.name })
              continue
            }
          }
          update(next.id, { stage: next.drive ? 'Copiando desde Google Drive…' : 'Preparando…' })
          const file = next.file ?? (next.drive && next.token ? await downloadPicked(next.drive, next.token, maxBytes, ac.signal) : null)
          if (!file) throw new IngestError('Archivo no disponible: vuelve a elegirlo.')
          if (!next.file) update(next.id, { size: file.size })
          const r = await ingestFile(supabase, file, {
            destination: projectId, source: next.source, kind: next.kind ?? undefined, signal: ac.signal,
            onStage: stage => update(next.id, { stage }), onProgress: sent => update(next.id, { sent }),
            extra: next.drive ? { driveFileId: next.drive.id } : undefined,
          })
          const ms = next.kind === 'image' ? null : await mediaDuration(file).then(s => (s ? Math.round(s * 1000) : null)).catch(() => null)
          update(next.id, r.status === 'duplicate'
            ? { status: 'duplicate', assetId: r.assetId, durationMs: ms, message: 'Ya está en tu Biblioteca: no se ha subido otra vez.' }
            : { status: 'done', assetId: r.assetId, durationMs: ms, sent: file.size, message: r.resumedFrom ? `Continuó desde ${formatBytes(r.resumedFrom)}.` : undefined })
          batch.current.push({ assetId: r.assetId, kind: next.kind!, durationMs: ms, duplicate: r.status === 'duplicate', name: next.name })
        } catch (e) {
          const cancelled = (e as Error).name === 'AbortError'
          update(next.id, { status: cancelled ? 'cancelled' : 'error', message: cancelled ? 'Cancelado.' : (e as Error).message })
        } finally { aborts.current.delete(next.id) }
      }
    } finally {
      running.current = false
      if (batch.current.length) { const items = batch.current; batch.current = []; onImportedRef.current(items) }
    }
  }, [supabase, projectId, maxBytes]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (rows.some(r => r.status === 'waiting')) void pump() }, [rows, pump])

  const active = rows.some(r => r.status === 'waiting' || r.status === 'working')
  const accept = section === 'audio' ? 'audio/*' : 'video/*,image/*'

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Importar materiales"
    onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
    onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); addDevice(Array.from(e.dataTransfer.files)) } }}>
    <b>Importar materiales</b>
    <div className="pageActions">
      <label className="buttonLink ghost small" htmlFor="ic-files" style={{ cursor: 'pointer' }}>Desde mi dispositivo
        <input id="ic-files" type="file" multiple accept={accept} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; addDevice(f) }} />
      </label>
      <button type="button" className="ghost small" disabled={!driveConfig} onClick={() => void addDrive()} aria-describedby="ic-drive-note">Desde Google Drive</button>
    </div>
    <span id="ic-drive-note" className="muted small">
      {driveConfig ? 'Se abre el selector oficial de Google (carpetas, búsqueda por nombre y varias selecciones). Solo los archivos que elijas quedan accesibles.' : 'Google Drive: requiere configuración en este entorno (faltan los identificadores públicos del selector).'}
    </span>
    {rows.length > 0 && <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }} aria-label="Cola de importación">
      {rows.map(r => <li key={r.id} className="small" style={{ border: '1px solid var(--line, #333)', borderRadius: 6, padding: 6 }}>
        <div><b>{r.name}</b> <span className="muted">· {r.kind ?? 'no admitido'}{r.size ? ` · ${formatBytes(r.size)}` : ''}{r.durationMs ? ` · ${Math.floor(r.durationMs / 60000)}:${String(Math.floor((r.durationMs % 60000) / 1000)).padStart(2, '0')}` : ''} · {r.source === 'drive' ? 'Google Drive' : 'Mi dispositivo'}</span></div>
        {r.status === 'working' && <div role="status">{r.stage ?? 'Importando…'}{r.sent > 0 && r.size > 0 && <progress style={{ marginLeft: 6 }} max={r.size} value={r.sent} aria-label={`Progreso de ${r.name}`} />}</div>}
        {r.status === 'waiting' && <div className="muted">En cola…</div>}
        {r.status === 'done' && <div role="status">Importado y listo para usar.</div>}
        {r.message && r.status !== 'working' && <div className={r.status === 'error' ? 'error' : 'muted'} role={r.status === 'error' ? 'alert' : undefined}>{r.status === 'duplicate' ? `${r.message}` : r.message}</div>}
        <div className="pageActions">
          {(r.status === 'working' || r.status === 'waiting') && <button type="button" className="ghost small" onClick={() => { aborts.current.get(r.id)?.abort(); if (r.status === 'waiting') update(r.id, { status: 'cancelled', message: 'Cancelado.' }) }}>Cancelar</button>}
          {(r.status === 'error' || r.status === 'cancelled') && r.kind && (r.file || r.drive) && <button type="button" className="ghost small" onClick={() => update(r.id, { status: 'waiting', message: undefined, sent: 0 })}>Reintentar</button>}
          {r.status !== 'working' && r.status !== 'waiting' && <button type="button" className="ghost small" onClick={() => setRows(l => l.filter(x => x.id !== r.id))}>Quitar</button>}
        </div>
      </li>)}
    </ul>}
    {active && <span className="muted small" role="status">Los archivos se importan de uno en uno; si falla uno, el resto y tu proyecto no se ven afectados.</span>}
    <details><summary className="small">Estado de las fuentes</summary>
      <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 16 }}>
        {sources.map(s => <li key={s.id}><b>{s.group} · {s.name}</b>: {STATE_LABEL[s.state]}{s.note ? ` — ${s.note}` : ''}</li>)}
      </ul>
    </details>
  </section>
}
