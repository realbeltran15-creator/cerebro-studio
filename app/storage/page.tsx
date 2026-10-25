'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { exportPlan, parseComposition } from '@/lib/editor/composition'
import { formatBytes } from '@/lib/ingest/files'
import { listExportTemps, removeExportTemp } from '@/lib/editor/export-destination'
import { metadataBytes, summarize, type StoredAsset } from '@/lib/storage/report'

type Usage = { driver: 'r2' | 'supabase'; usedBytes: number; quotaBytes: number; maxFileBytes: number | null }
type Draft = { id: string; project_id: string; updated_at: string; composition: unknown }
type Browser = { usage: number | null; quota: number | null; details: Record<string, number> }

/**
 * Almacenamiento: what takes space, where, and what can be freed safely. Read-only by design: this page never deletes a person's media.
 * The only thing it can remove are the TEMPORARY export files this browser keeps while uploading a video to Drive.
 */
export default function StoragePage() {
  const supabase = getSupabaseBrowserClient()
  const [assets, setAssets] = useState<StoredAsset[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [browser, setBrowser] = useState<Browser | null>(null)
  const [temps, setTemps] = useState<Array<{ name: string; bytes: number }>>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const [a, p, d, u] = await Promise.all([
      supabase.from('assets').select('id,project_id,asset_type,source_provider,created_at,provenance').limit(20000),
      supabase.from('projects').select('id,name'),
      supabase.from('render_jobs').select('id,project_id,updated_at,composition').order('updated_at', { ascending: false }).limit(300),
      fetch('/api/storage/usage').then(r => r.json()).catch(() => null) as Promise<Usage | null>,
    ])
    if (a.error) { setError(a.error.message); return }
    setAssets(((a.data ?? []) as Array<{ id: string; project_id: string | null; asset_type: string; source_provider: string | null; created_at: string; provenance: Record<string, unknown> | null }>).map(r => ({
      id: r.id, project_id: r.project_id, asset_type: r.asset_type, source_provider: r.source_provider, created_at: r.created_at,
      bytes: Number(r.provenance?.bytes) || 0, fingerprint: typeof r.provenance?.contentFingerprint === 'string' ? r.provenance.contentFingerprint : null,
      driveFileId: typeof r.provenance?.driveFileId === 'string' ? r.provenance.driveFileId : null, title: String(r.provenance?.title ?? r.provenance?.originalFilename ?? r.id).slice(0, 80),
    })))
    setNames(Object.fromEntries(((p.data ?? []) as Array<{ id: string; name: string }>).map(x => [x.id, x.name])))
    setDrafts((d.data ?? []) as Draft[])
    setUsage(u && 'usedBytes' in u ? u : null)
    try {
      const e = await navigator.storage.estimate() as StorageEstimate & { usageDetails?: Record<string, number> }
      setBrowser({ usage: e.usage ?? null, quota: e.quota ?? null, details: e.usageDetails ?? {} })
    } catch { setBrowser(null) }
    setTemps(await listExportTemps().catch(() => []))
  }, [supabase])
  useEffect(() => { void load() }, [load])

  const s = summarize(assets, names)
  const meta = metadataBytes(drafts.map(d => d.composition))
  const estimates = drafts.map(d => { const c = parseComposition(d.composition); return c && c.clips.length ? { id: d.id, title: c.title || 'Montaje', project: names[d.project_id] ?? 'Proyecto', bytes: exportPlan(c).estimatedBytes } : null }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.bytes - a.bytes).slice(0, 8)
  const pct = usage && usage.quotaBytes ? Math.min(100, Math.round(usage.usedBytes / usage.quotaBytes * 100)) : null

  return <StudioShell title="Almacenamiento" eyebrow="ESPACIO" actions={<button type="button" className="ghost small" onClick={() => void load()}>Actualizar</button>}>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="panel" aria-labelledby="st-cloud">
      <h3 id="st-cloud">Nube de Cerebro Studio ({usage?.driver === 'r2' ? 'Cloudflare R2' : 'Supabase Storage'})</h3>
      {usage ? <p>Usado: <b>{formatBytes(usage.usedBytes)}</b> de {formatBytes(usage.quotaBytes)}{pct !== null ? ` (${pct} %)` : ''}. {usage.maxFileBytes ? `Máximo por archivo: ${formatBytes(usage.maxFileBytes)}.` : 'Sin límite práctico por archivo.'}</p> : <p className="muted">No se pudo consultar la cuota.</p>}
      {pct !== null && <progress max={100} value={pct} aria-label="Cuota usada" />}
      <p className="muted small">Suma de los tamaños que cada archivo registró al subirse; no lista el almacenamiento directamente. Los servicios conectados (Google Drive, etc.) no exponen aquí su espacio: la cuenta de Google no se consulta con el permiso mínimo que usamos.</p>
    </section>

    <section className="panel" aria-labelledby="st-assets">
      <h3 id="st-assets">Materiales originales ({s.files} archivos · {formatBytes(s.totalBytes)})</h3>
      <table className="small"><thead><tr><th>Tipo</th><th>Archivos</th><th>Espacio</th></tr></thead><tbody>
        {Object.entries(s.byKind).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v.files}</td><td>{formatBytes(v.bytes)}</td></tr>)}
      </tbody></table>
      <h4>Por proyecto</h4>
      <ul className="small">{s.byProject.map(p => <li key={p.name}>{p.name}: {p.files} archivos · {formatBytes(p.bytes)}</li>)}</ul>
      {s.unknownSize > 0 && <p className="warnBox small">{s.unknownSize} archivo(s) (normalmente imágenes y voces generadas con IA) no registraron su tamaño al guardarse, así que aquí cuentan como 0: el espacio real de la nube es algo mayor que la suma.</p>}
      <p className="muted small">Las exportaciones guardadas en la Biblioteca se cuentan aparte (tipo «exportación»). Repetir un clip muchas veces no copia el archivo: todas las repeticiones apuntan al mismo original.</p>
    </section>

    <section className="panel" aria-labelledby="st-meta">
      <h3 id="st-meta">Proyectos y montajes (metadatos)</h3>
      <p>{drafts.length} montajes recientes ocupan <b>{formatBytes(meta)}</b> de datos de montaje (clips, ajustes). Es texto: no incluye vídeo ni audio.</p>
      {estimates.length > 0 && <><h4>Tamaño estimado al exportar</h4><ul className="small">{estimates.map(e => <li key={e.id}>{e.title} ({e.project}): ~{formatBytes(e.bytes)} <a href={`/editor/manual?job=${e.id}`}>Abrir</a></li>)}</ul><p className="muted small">Estimación por la calidad y duración del montaje; el archivo real puede variar.</p></>}
    </section>

    <section className="panel" aria-labelledby="st-dup">
      <h3 id="st-dup">Archivos duplicados</h3>
      {s.duplicates.length === 0 ? <p className="emptyState">No hay duplicados detectados (se comparan por contenido y por archivo de Drive).</p> : <>
        <p>{s.duplicates.length} grupos; se podrían liberar hasta <b>{formatBytes(s.duplicateExtraBytes)}</b>. No se borra nada automáticamente.</p>
        <ul className="small">{s.duplicates.slice(0, 15).map(d => <li key={d.key}>{d.titles.join(' · ')}: {d.count} copias de {formatBytes(d.bytesEach)}</li>)}</ul>
        <p className="muted small">Antes de borrar una copia, comprueba en la <Link href="/library">Biblioteca</Link> que ningún montaje o publicación la usa (el borrado se bloquea si una publicación la usa).</p></>}
    </section>

    <section className="panel" aria-labelledby="st-browser">
      <h3 id="st-browser">En este navegador (caché y temporales)</h3>
      {browser?.usage != null ? <p>Este sitio usa <b>{formatBytes(browser.usage)}</b> en este navegador{browser.quota ? ` (el navegador permite hasta ~${formatBytes(browser.quota)})` : ''}.</p> : <p className="muted">Este navegador no informa del espacio usado.</p>}
      {Object.keys(browser?.details ?? {}).length > 0 && <ul className="small">{Object.entries(browser!.details).filter(([, v]) => v > 0).map(([k, v]) => <li key={k}>{k}: {formatBytes(v)}</li>)}</ul>}
      <h4>Temporales de exportación</h4>
      {temps.length === 0 ? <p className="muted small">No hay ninguno. Solo existen mientras se sube un vídeo a Google Drive; se borran solos al terminar.</p> : <ul className="small">{temps.map(t => <li key={t.name}>{t.name} · {formatBytes(t.bytes)} <button type="button" className="ghost small" onClick={() => void removeExportTemp(t.name).then(load)}>Borrar este temporal</button></li>)}</ul>}
      <p className="muted small">Borrar un temporal no toca tus materiales ni tus proyectos; solo descarta una exportación que no llegó a subirse.</p>
    </section>
  </StudioShell>
}
