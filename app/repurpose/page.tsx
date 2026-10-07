'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { RenderPanel } from '../components/render-panel'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { parseComposition, shortPlatforms, toShort, totalDurationMs, type Composition } from '@/lib/editor/composition'
import type { EditorAsset } from '@/lib/editor/client'
import { suggestHook, suggestPackaging, suggestSegment, type SegmentSuggestion } from '@/lib/editor/repurpose'
import type { ProjectRow } from '@/lib/types/database'

type Job = { id: string; status: string; created_at: string; updated_at: string; composition: Composition }

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`

export default function RepurposePage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [sources, setSources] = useState<Job[]>([])
  const [shorts, setShorts] = useState<Job[]>([])
  const [sourceId, setSourceId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hook, setHook] = useState('')
  const [suggestion, setSuggestion] = useState<(SegmentSuggestion & { label: string }) | null>(null)
  const [suggestMsg, setSuggestMsg] = useState('')
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [draft, setDraft] = useState<{ id: string | null; comp: Composition } | null>(null)
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
  }, [supabase])

  const load = useCallback(async (pid: string) => {
    const [{ data: jobs, error: e }, { data: assetRows }] = await Promise.all([
      supabase.from('render_jobs').select('id,status,created_at,updated_at,composition').eq('project_id', pid).in('status', ['draft', 'completed']).order('updated_at', { ascending: false }).limit(50),
      supabase.from('assets').select('id,asset_type,storage_path,license_status,source_provider,provenance,created_at').eq('project_id', pid).not('storage_path', 'is', null).limit(300),
    ])
    if (e) { setError(e.message); return }
    const parsed = ((jobs ?? []) as Array<Omit<Job, 'composition'> & { composition: unknown }>).flatMap(j => {
      const comp = parseComposition(j.composition)
      return comp ? [{ ...j, composition: comp }] : []
    })
    // Horizontal edits are sources; vertical derived compositions are this module's drafts.
    const srcs = parsed.filter(j => j.status === 'draft' && !j.composition.origin)
    setSources(srcs)
    setShorts(parsed.filter(j => j.composition.origin?.kind === 'repurpose'))
    setAssets((assetRows ?? []) as EditorAsset[])
    setSourceId(id => (srcs.some(s => s.id === id) ? id : srcs[0]?.id ?? ''))
  }, [supabase])

  useEffect(() => { if (projectId) { setDraft(null); void load(projectId) } }, [projectId, load])

  const source = sources.find(s => s.id === sourceId) ?? null

  // Default selection: opening clips up to ~60 s, the most common vertical length.
  useEffect(() => {
    if (!source) { setSelected(new Set()); return }
    let t = 0
    const pick = new Set<string>()
    for (const c of source.composition.clips) { if (t + c.durationMs > 60_000 && pick.size) break; pick.add(c.sceneId); t += c.durationMs }
    setSelected(pick)
    void (async () => {
      // Prefill the hook with the script's hook when the storyboard came from a script.
      const { data } = await supabase.from('storyboards').select('script_id').eq('id', source.composition.storyboardId).maybeSingle()
      const scriptId = (data as { script_id: string | null } | null)?.script_id
      if (!scriptId) { setHook(''); return }
      const { data: script } = await supabase.from('scripts').select('hook').eq('id', scriptId).maybeSingle()
      const h = (script as { hook: string | null } | null)?.hook?.trim() ?? ''
      setHook(h.split(/(?<=[.!?¿¡])\s/)[0]?.slice(0, 90) ?? '')
    })()
  }, [source, supabase])

  const selectedNarrations = useMemo(() => source ? source.composition.clips.filter(c => selected.has(c.sceneId)).map(c => c.narration) : [], [source, selected])
  const projectName = projects.find(p => p.id === projectId)?.name ?? ''
  const packaging = useMemo(() => selected.size ? suggestPackaging({ projectName, hook: hook.trim() || null, narrations: selectedNarrations }) : null, [selected.size, projectName, hook, selectedNarrations])
  const [copied, setCopied] = useState('')
  async function copy(label: string, text: string) { try { await navigator.clipboard.writeText(text); setCopied(label) } catch { setCopied('No se pudo copiar: selecciona el texto manualmente.') } }
  const selectedMs = useMemo(() => source ? source.composition.clips.filter(c => selected.has(c.sceneId)).reduce((t, c) => t + c.durationMs, 0) : 0, [source, selected])

  // Platform sweet spots for retention (not the hard limits): Shorts/TikTok about a minute, Reels up to its 90 s cap.
  const suggestTargets = [{ label: 'YouTube Shorts', maxMs: 60_000, targetMs: 45_000 }, { label: 'Instagram Reels', maxMs: 90_000, targetMs: 60_000 }, { label: 'TikTok', maxMs: 60_000, targetMs: 45_000 }]
  function suggest(t: typeof suggestTargets[number]) {
    if (!source) return
    const r = suggestSegment(source.composition.clips, { maxMs: t.maxMs, targetMs: t.targetMs })
    if (!r) { setSuggestion(null); setSuggestMsg(`Ninguna escena o grupo de escenas cabe en ${Math.round(t.maxMs / 1000)} s. Divide las escenas largas en el Editor.`); return }
    setSuggestMsg(''); setSuggestion({ ...r, label: t.label }); setSelected(new Set(r.sceneIds))
    if (!hook.trim()) { const h = suggestHook(source.composition.clips.filter(c => r.sceneIds.includes(c.sceneId)).map(c => c.narration)); if (h) setHook(h) }
  }

  function toggle(id: string) { setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }

  function build() {
    if (!source || selected.size === 0) return
    setError(''); setNotice('')
    setDraft({ id: null, comp: toShort(source.composition, source.id, source.composition.clips.filter(c => selected.has(c.sceneId)).map(c => c.sceneId), hook) })
  }

  function setFocus(sceneId: string, focusX: number) {
    setDraft(d => d ? { ...d, comp: { ...d.comp, clips: d.comp.clips.map(c => c.sceneId === sceneId ? { ...c, focusX } : c) } } : d)
  }

  async function saveDraft() {
    if (!draft) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('La sesión ha caducado.')
    if (draft.id) {
      const { error: e } = await supabase.from('render_jobs').update({ composition: draft.comp, updated_at: new Date().toISOString() }).eq('id', draft.id)
      if (e) throw new Error(e.message)
    } else {
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: '9:16', status: 'draft', composition: draft.comp }).select('id').single()
      if (e) throw new Error(e.message)
      setDraft(d => d ? { ...d, id: (data as { id: string }).id } : d)
    }
  }

  const draftMs = draft ? totalDurationMs(draft.comp) : 0

  return <StudioShell title="Shorts / Reels / TikTok" eyebrow="REUTILIZACIÓN" actions={projectId ? <Link className="buttonLink ghost" href={`/editor?project=${projectId}`}>Abrir editor</Link> : null}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="field-row">
        <label htmlFor="rp-project">Proyecto
          <select id="rp-project" value={projectId} onChange={e => setProjectId(e.target.value)}>
            {projects.length === 0 && <option value="">Sin proyectos</option>}
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label htmlFor="rp-source">Montaje de origen
          <select id="rp-source" value={sourceId} onChange={e => { setSourceId(e.target.value); setDraft(null) }}>
            {sources.length === 0 && <option value="">Sin montajes guardados</option>}
            {sources.map(s => <option key={s.id} value={s.id}>{s.composition.title || 'Montaje'} · {s.composition.clips.length} escenas · {fmt(totalDurationMs(s.composition))}</option>)}
          </select>
        </label>
      </div>
      {sources.length === 0 && projectId && <p className="muted small" style={{ marginTop: 8 }}>Guarda primero un montaje en el <Link className="open" href={`/editor?project=${projectId}`}>Editor</Link>; aquí se recorta y se adapta a vertical.</p>}
    </section>

    {source && !draft && <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
      <h3>1 · Elige las escenas</h3>
      <div className="pageActions" role="group" aria-label="Sugerir fragmento">
        {suggestTargets.map(t => <button key={t.label} type="button" className="ghost small" onClick={() => suggest(t)}>Sugerir para {t.label}</button>)}
      </div>
      {suggestMsg && <p className="warnBox small" role="status">{suggestMsg}</p>}
      {suggestion && <p className="notice small" role="status"><b>Sugerencia para {suggestion.label}</b> (escenas {suggestion.startIndex + 1}–{suggestion.endIndex + 1}, {fmt(suggestion.durationMs)}). <span className="pill">Calculado, no IA</span> {suggestion.reasons.join(' · ')}. Puedes ajustar la selección antes de preparar la versión.</p>}
      <div className="list">{source.composition.clips.map((c, i) => (
        <label key={c.sceneId} className="listItem" style={{ cursor: 'pointer' }}>
          <span><input type="checkbox" checked={selected.has(c.sceneId)} onChange={() => toggle(c.sceneId)} /> <b>Escena {i + 1}</b> · {(c.durationMs / 1000).toFixed(1)} s{!c.visualAssetId ? ' · sin visual' : ''}</span>
          <span className="muted small">{c.narration?.slice(0, 110) ?? 'Sin narración'}</span>
        </label>
      ))}</div>
      <div className="stats">
        <span className="pill info">Seleccionado: {fmt(selectedMs)}</span>
        {shortPlatforms.map(p => <span key={p.id} className={selectedMs <= p.maxMs ? 'pill ok' : 'pill warn'}>{p.label} ≤ {fmt(p.maxMs)}</span>)}
      </div>
      <label htmlFor="rp-hook">2 · Hook en pantalla (primeros 3 s)
        <input id="rp-hook" value={hook} onChange={e => setHook(e.target.value)} maxLength={90} placeholder="Frase corta que engancha; se rellena con el hook del guion" />
        <button type="button" className="ghost small" style={{ marginTop: 6 }} disabled={selected.size === 0} onClick={() => { const h = suggestHook(selectedNarrations); if (h) setHook(h) }}>Proponer hook desde la narración (calculado)</button>
      </label>
      {packaging && <div className="panel" style={{ background: 'var(--panel-2)' }}>
        <h4>Borrador de título y descripción <span className="pill">Calculado, no IA</span></h4>
        <p className="small"><b>Título:</b> {packaging.title}</p>
        <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{packaging.caption}</p>
        <div className="pageActions"><button type="button" className="ghost small" onClick={() => void copy('Título copiado.', packaging.title)}>Copiar título</button><button type="button" className="ghost small" onClick={() => void copy('Descripción copiada.', packaging.caption)}>Copiar descripción</button></div>
        {copied && <p className="muted small" role="status">{copied}</p>}
        <p className="muted small">Se arma con el texto de tu propio proyecto; revísalo antes de usarlo en YouTube, Instagram o TikTok.</p>
      </div>}
      <div><button type="button" disabled={selected.size === 0} onClick={build}>Preparar versión vertical 9:16</button></div>
    </section>}

    {draft && <>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
        <div className="cardHead" style={{ marginBottom: 0 }}>
          <h3>3 · Reencuadre</h3>
          <button type="button" className="ghost" onClick={() => setDraft(null)}>Volver a la selección</button>
        </div>
        <p className="muted small">Las imágenes horizontales se recortan a 9:16. Mueve el punto de interés de cada escena para elegir qué parte queda en el encuadre.</p>
        <div className="list">{draft.comp.clips.map((c, i) => (
          <div key={c.sceneId} className="listItem">
            <span><b>Escena {i + 1}</b> · {(c.durationMs / 1000).toFixed(1)} s</span>
            <label className="small" style={{ minWidth: 240 }}>Izquierda ← encuadre → derecha
              <input type="range" min={0} max={1} step={0.05} value={c.focusX ?? 0.5} onChange={e => setFocus(c.sceneId, Number(e.target.value))} />
            </label>
          </div>
        ))}</div>
        <div className="stats">
          {shortPlatforms.map(p => <span key={p.id} className={draftMs <= p.maxMs ? 'pill ok' : 'pill warn'}>{p.label}: {draftMs <= p.maxMs ? 'dentro del límite' : 'demasiado largo'}</span>)}
        </div>
      </section>
      <RenderPanel projectId={projectId} composition={draft.comp} assets={assets} beforeRender={saveDraft} onRendered={() => { setNotice('Short guardado en la Biblioteca. No se ha publicado nada: para publicarlo prepara el trabajo en YouTube y apruébalo.'); void load(projectId) }} />
    </>}

    {shorts.length > 0 && <>
      <h3 className="sectionTitle">Versiones verticales del proyecto</h3>
      <div className="list">{shorts.map(s => (
        <div key={s.id} className="listItem">
          <span><b>{s.composition.title}</b> · {s.composition.clips.length} escenas · {fmt(totalDurationMs(s.composition))}</span>
          <span className="pill">{s.status === 'completed' ? 'Renderizado' : 'Borrador'}</span>
          {s.status === 'draft' && <button type="button" className="ghost" onClick={() => { setDraft({ id: s.id, comp: s.composition }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Abrir</button>}
        </div>
      ))}</div>
      <p className="muted small">Los vídeos renderizados están en la <Link className="open" href="/library">Biblioteca</Link>. Publicar requiere OAuth y tu aprobación explícita.</p>
    </>}
  </StudioShell>
}
