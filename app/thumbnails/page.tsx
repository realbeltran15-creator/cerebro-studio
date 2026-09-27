'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { ProjectRow } from '@/lib/types/database'

type Thumb = { id: string; created_at: string; provenance: Record<string, unknown> | null; url?: string }

const styles = [['documentary', 'Documental'], ['cinematic', 'Cinematográfico'], ['illustration', 'Ilustración'], ['minimal', 'Minimalista']] as const

export default function ThumbnailsPage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [concept, setConcept] = useState('')
  const [overlayText, setOverlayText] = useState('')
  const [style, setStyle] = useState('documentary')
  const [thumbs, setThumbs] = useState<Thumb[]>([])
  const [imageReady, setImageReady] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('project')
    void (async () => {
      const { data, error: e } = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
      if (e) { setError(e.message); return }
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows)
      setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
    })()
    void fetch('/api/providers/status', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ providers?: Array<{ capability: string; enabled: boolean }> }>)
      .then(j => setImageReady(Boolean(j.providers?.some(p => p.capability === 'image' && p.enabled))))
      .catch(() => setImageReady(false))
  }, [supabase])

  const load = useCallback(async (pid: string) => {
    const { data, error: e } = await supabase.from('assets').select('id,created_at,provenance')
      .eq('project_id', pid).eq('asset_type', 'thumbnail').order('created_at', { ascending: false }).limit(24)
    if (e) { setError(e.message); return }
    const rows = (data ?? []) as Thumb[]
    setThumbs(rows)
    // Private storage: previews need short-lived signed URLs.
    const withUrls = await Promise.all(rows.map(async t => {
      const r = await fetch(`/api/assets/${t.id}/signed-url`, { cache: 'no-store' })
      const json = await r.json().catch(() => ({})) as { url?: string }
      return { ...t, url: json.url }
    }))
    setThumbs(withUrls)
  }, [supabase])

  useEffect(() => {
    if (!projectId) return
    setConcept(''); setNotice(''); setError('')
    void load(projectId)
    // Prefill the concept from the latest script hook, then the project description.
    void (async () => {
      const project = projects.find(p => p.id === projectId)
      const { data } = await supabase.from('scripts').select('hook,title').eq('project_id', projectId).order('version', { ascending: false }).limit(1)
      const latest = (data ?? [])[0] as { hook: string | null; title: string } | undefined
      setConcept(c => c || latest?.hook?.trim() || project?.description?.trim() || project?.name || '')
    })()
  }, [projectId, projects, load, supabase])

  async function generate(event: FormEvent) {
    event.preventDefault()
    if (!projectId || !concept.trim() || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await fetch('/api/providers/thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, concept, overlayText, style }),
      })
      const json = await r.json() as { error?: string }
      if (!r.ok) throw new Error(json.error ?? 'No se pudo generar la miniatura.')
      setNotice('Variante generada y guardada en la Biblioteca del proyecto.')
      await load(projectId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar la miniatura.')
    } finally { setBusy(false) }
  }

  async function select(id: string) {
    setError('')
    // One selected thumbnail per project, stored in the asset's provenance.
    for (const t of thumbs) {
      const selected = t.id === id
      if (Boolean(t.provenance?.selected) === selected) continue
      const { error: e } = await supabase.from('assets').update({ provenance: { ...(t.provenance ?? {}), selected } }).eq('id', t.id)
      if (e) { setError(e.message); return }
    }
    setThumbs(ts => ts.map(t => ({ ...t, provenance: { ...(t.provenance ?? {}), selected: t.id === id } })))
    setNotice('Miniatura seleccionada para el proyecto.')
  }

  return <StudioShell title="Miniaturas" eyebrow="PRODUCCIÓN" actions={projectId ? <Link className="buttonLink ghost" href={`/projects/${projectId}`}>Volver al proyecto</Link> : null}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {imageReady === false && <p className="warnBox">No hay proveedor de imágenes configurado. Añade <code>OPENAI_API_KEY</code> (o el endpoint de respaldo) en el servidor para generar variantes.</p>}

    <section className="panel" style={{ marginBottom: 18 }}>
      <form onSubmit={generate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field-row">
          <label htmlFor="thumb-project">Proyecto
            <select id="thumb-project" value={projectId} onChange={e => setProjectId(e.target.value)}>
              {projects.length === 0 && <option value="">Sin proyectos</option>}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label htmlFor="thumb-style">Estilo
            <select id="thumb-style" value={style} onChange={e => setStyle(e.target.value)}>
              {styles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label htmlFor="thumb-text">Texto en la miniatura (opcional)
            <input id="thumb-text" value={overlayText} onChange={e => setOverlayText(e.target.value)} maxLength={40} placeholder="2–4 palabras" />
          </label>
        </div>
        <label htmlFor="thumb-concept">Concepto visual
          <textarea id="thumb-concept" rows={3} value={concept} onChange={e => setConcept(e.target.value)} maxLength={1500} placeholder="Qué debe verse: sujeto, situación y emoción. Se rellena con el hook del último guion." />
        </label>
        <p className="muted small">Cada variante es una generación de pago (1536×1024). No se muestran personas reales ni marcas; la selección no publica nada.</p>
        <div><button disabled={busy || !projectId || !concept.trim() || imageReady === false}><Icon name="image" size={16} />{busy ? 'Generando…' : 'Generar variante'}</button></div>
      </form>
    </section>

    <h3 className="sectionTitle">Variantes del proyecto ({thumbs.length})</h3>
    {thumbs.length === 0 ? <p className="emptyState">Todavía no hay miniaturas para este proyecto.</p> : <div className="grid">
      {thumbs.map(t => {
        const selected = Boolean(t.provenance?.selected)
        return <article key={t.id} style={selected ? { borderColor: 'var(--ok)' } : undefined}>
          {t.url ? <img src={t.url} alt={`Miniatura: ${String(t.provenance?.concept ?? '')}`} style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8 }} /> : <p className="muted small">Cargando vista previa…</p>}
          <p className="small" style={{ marginTop: 8 }}>{String(t.provenance?.concept ?? '').slice(0, 140)}</p>
          <p className="muted small">{t.provenance?.overlayText ? `Texto: «${String(t.provenance.overlayText)}» · ` : ''}{new Date(t.created_at).toLocaleString()}</p>
          {selected ? <span className="pill ok">Seleccionada</span> : <button type="button" className="ghost" onClick={() => void select(t.id)}>Seleccionar</button>}
        </article>
      })}
    </div>}
  </StudioShell>
}
