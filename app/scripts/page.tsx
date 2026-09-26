'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  basisHelp, basisLabels, defaultStructure, estimateSeconds, formatDuration, isMissingScriptsTable, makeSection,
  normalizeSections, scriptStatusLabels, scriptToScenes, scriptWarnings, wordCount,
} from '@/lib/scripts'
import type { OpportunityRow, ProjectRow, ScriptBasis, ScriptRow, ScriptSection } from '@/lib/types/database'
import type { ScriptAssistMode, ScriptAssistProposal } from '@/lib/providers/openai-text'

type Draft = Pick<ScriptRow, 'title' | 'status' | 'idea' | 'brief' | 'hook' | 'cta' | 'review_notes'> & { sections: ScriptSection[] }

function toDraft(s: ScriptRow): Draft {
  return { title: s.title, status: s.status, idea: s.idea, brief: s.brief, hook: s.hook, cta: s.cta, review_notes: s.review_notes, sections: normalizeSections(s.sections) }
}

function researchBrief(project: ProjectRow, opps: OpportunityRow[]) {
  const lines: string[] = []
  if (project.description?.trim()) lines.push(`Objetivo: ${project.description.trim()}`)
  if (opps.length) {
    lines.push('', 'Investigación vinculada:')
    for (const o of opps) {
      lines.push(`• ${o.title} (${o.source_platform}${o.query ? ` · búsqueda: ${o.query}` : ''})`)
      if (Array.isArray(o.evidence)) for (const ev of o.evidence) {
        if (ev && typeof ev === 'object' && !Array.isArray(ev) && typeof ev.note === 'string' && ev.note.trim()) lines.push(`  Observación: ${ev.note.trim()}`)
      }
      if (o.source_id && /^https?:\/\//.test(o.source_id)) lines.push(`  Fuente: ${o.source_id}`)
    }
  }
  return lines.join('\n').trim()
}

export default function ScriptsPage() {
  const supabase = getSupabaseBrowserClient()
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [scripts, setScripts] = useState<ScriptRow[]>([])
  const [opps, setOpps] = useState<OpportunityRow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [migrationPending, setMigrationPending] = useState(false)
  const [requestedScript, setRequestedScript] = useState('')
  const [assistReady, setAssistReady] = useState<boolean | null>(null)
  const [assistBusy, setAssistBusy] = useState<ScriptAssistMode | null>(null)
  const [proposal, setProposal] = useState<(ScriptAssistProposal & { mode: ScriptAssistMode; model: string }) | null>(null)

  const project = projects.find(p => p.id === projectId) ?? null
  const selected = scripts.find(s => s.id === selectedId) ?? null

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setRequestedScript(params.get('script') ?? '')
    void (async () => {
      const { data, error: e } = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
      if (e) { setError(e.message); return }
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows)
      const wanted = params.get('project')
      setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
    })()
  }, [supabase])

  const loadProject = useCallback(async (pid: string, preferScript?: string) => {
    if (!pid) return
    setError('')
    const [s, o] = await Promise.all([
      supabase.from('scripts').select('*').eq('project_id', pid).order('version', { ascending: false }),
      supabase.from('opportunities').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
    ])
    setOpps((o.data ?? []) as OpportunityRow[])
    if (s.error) {
      if (isMissingScriptsTable(s.error)) setMigrationPending(true)
      else setError(s.error.message)
      setScripts([]); setSelectedId(''); setDraft(null); return
    }
    setMigrationPending(false)
    const rows = (s.data ?? []) as ScriptRow[]
    setScripts(rows)
    const pick = rows.find(r => r.id === preferScript) ?? rows[0]
    setSelectedId(pick?.id ?? '')
    setDraft(pick ? toDraft(pick) : null)
    setDirty(false)
  }, [supabase])

  useEffect(() => { if (projectId) void loadProject(projectId, requestedScript) }, [projectId, requestedScript, loadProject])

  useEffect(() => {
    void fetch('/api/providers/status', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ providers?: Array<{ id: string; enabled: boolean }> }>)
      .then(j => setAssistReady(Boolean(j.providers?.some(p => p.id === 'openai-text' && p.enabled))))
      .catch(() => setAssistReady(false))
  }, [])

  async function assist(mode: ScriptAssistMode) {
    if (!selected || !draft || assistBusy) return
    setAssistBusy(mode); setError(''); setNotice(''); setProposal(null)
    try {
      const response = await fetch('/api/scripts/assist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, scriptId: selected.id, mode, draft }),
      })
      const json = await response.json() as { proposal?: ScriptAssistProposal; model?: string; error?: string }
      if (!response.ok || !json.proposal) throw new Error(json.error ?? 'No se pudo generar la propuesta.')
      setProposal({ ...json.proposal, mode, model: json.model ?? '' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar la propuesta.')
    } finally { setAssistBusy(null) }
  }

  function applyProposal() {
    if (!proposal || !draft) return
    update({
      hook: proposal.hooks[0] ?? draft.hook,
      cta: proposal.cta || draft.cta,
      sections: proposal.sections.length ? proposal.sections.map(s => ({ ...makeSection(s.heading, s.basis), text: s.text, sources: s.sources })) : draft.sections,
    })
    setProposal(null)
    setNotice('Propuesta aplicada al borrador. Revísala y guarda; «Descartar» la deshace.')
  }

  function update(patch: Partial<Draft>) { setDraft(d => d ? { ...d, ...patch } : d); setDirty(true); setNotice('') }
  function updateSection(id: string, patch: Partial<ScriptSection>) {
    setDraft(d => d ? { ...d, sections: d.sections.map(s => s.id === id ? { ...s, ...patch } : s) } : d); setDirty(true); setNotice('')
  }
  function moveSection(index: number, delta: number) {
    setDraft(d => {
      if (!d) return d
      const next = [...d.sections]; const target = index + delta
      if (target < 0 || target >= next.length) return d
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...d, sections: next }
    }); setDirty(true)
  }

  function choose(id: string) {
    if (dirty) { setError('Tienes cambios sin guardar. Guárdalos o descártalos antes de cambiar de versión.'); return }
    const s = scripts.find(x => x.id === id)
    if (s) { setSelectedId(id); setDraft(toDraft(s)); setError(''); setNotice('') }
  }

  function changeProject(pid: string) {
    if (dirty) { setError('Tienes cambios sin guardar. Guárdalos o descártalos antes de cambiar de proyecto.'); return }
    setRequestedScript(''); setProjectId(pid)
    window.history.replaceState(null, '', `/scripts?project=${pid}`)
  }

  async function createFirst() {
    if (!project) return
    setBusy(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(false); setError('Inicia sesión para crear guiones.'); return }
    const { data, error: e } = await supabase.from('scripts').insert({
      owner_id: user.id, project_id: project.id, version: 1, title: project.name, status: 'draft',
      idea: project.description, brief: researchBrief(project, opps) || null, source_opportunity_id: opps[0]?.id ?? null,
      sections: defaultStructure.map(s => makeSection(s.heading, s.basis)),
    }).select('id').single()
    setBusy(false)
    if (e) { if (isMissingScriptsTable(e)) setMigrationPending(true); else setError(e.message); return }
    await loadProject(project.id, data.id)
    setNotice('Guion creado con la ficha y la investigación del proyecto.')
  }

  async function save() {
    if (!selected || !draft) return
    if (!draft.title.trim()) { setError('El guion necesita un título.'); return }
    setBusy(true); setError('')
    const { error: e } = await supabase.from('scripts').update({
      title: draft.title.trim(), status: draft.status, idea: draft.idea?.trim() || null, brief: draft.brief?.trim() || null,
      hook: draft.hook?.trim() || null, cta: draft.cta?.trim() || null, review_notes: draft.review_notes?.trim() || null,
      sections: draft.sections, updated_at: new Date().toISOString(),
    }).eq('id', selected.id)
    setBusy(false)
    if (e) { setError(e.message); return }
    setDirty(false); setNotice('Guardado.')
    await loadProject(projectId, selected.id)
  }

  function discard() { if (selected) { setDraft(toDraft(selected)); setDirty(false); setError(''); setNotice('Cambios descartados.') } }

  async function newVersion() {
    if (!selected || !draft) return
    if (dirty) { setError('Guarda los cambios antes de crear una versión nueva.'); return }
    setBusy(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(false); return }
    const version = Math.max(...scripts.map(s => s.version)) + 1
    const { data, error: e } = await supabase.from('scripts').insert({
      owner_id: user.id, project_id: projectId, parent_id: selected.id, version, title: draft.title, status: 'draft',
      idea: draft.idea, brief: draft.brief, hook: draft.hook, cta: draft.cta, review_notes: null,
      source_opportunity_id: selected.source_opportunity_id, sections: draft.sections,
    }).select('id').single()
    setBusy(false)
    if (e) { setError(e.message); return }
    await loadProject(projectId, data.id)
    setNotice(`Versión ${version} creada a partir de la ${selected.version}.`)
  }

  async function toStoryboard() {
    if (!selected || !draft) return
    if (dirty) { setError('Guarda el guion antes de convertirlo en storyboard.'); return }
    const planned = scriptToScenes({ id: selected.id, version: selected.version, hook: draft.hook, cta: draft.cta, sections: draft.sections })
    if (planned.length === 0) { setError('El guion no tiene texto para convertir en escenas.'); return }
    setBusy(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(false); return }
    const { data: board, error: be } = await supabase.from('storyboards')
      .insert({ owner_id: user.id, project_id: projectId, script_id: selected.id, title: `${draft.title} · guion v${selected.version}`, aspect_ratio: '16:9' })
      .select('id').single()
    if (be) { setBusy(false); setError(be.message); return }
    const { error: se } = await supabase.from('scenes').insert(planned.map(p => ({ ...p, owner_id: user.id, storyboard_id: board.id })))
    if (se) {
      await supabase.from('storyboards').delete().eq('id', board.id)
      setBusy(false); setError(`No se pudieron crear las escenas: ${se.message}`); return
    }
    setBusy(false)
    router.push(`/create?project=${projectId}&storyboard=${board.id}`)
  }

  const warnings = useMemo(() => draft ? scriptWarnings(draft) : [], [draft])
  const totals = useMemo(() => {
    if (!draft) return { words: 0, seconds: 0 }
    const texts = [draft.hook, ...draft.sections.map(s => s.text), draft.cta]
    return { words: texts.reduce((t, x) => t + wordCount(x), 0), seconds: texts.reduce((t, x) => t + estimateSeconds(x), 0) }
  }, [draft])

  return (
    <StudioShell title="Guiones" eyebrow="PRODUCCIÓN" actions={project ? <Link className="buttonLink ghost" href={`/projects/${project.id}`}>Volver al proyecto</Link> : null}>
      {migrationPending && <p className="warnBox">Falta aplicar la migración <code>supabase/migrations/20260926120000_scripts_module.sql</code> en Supabase. Hasta entonces no se pueden guardar guiones.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="scriptLayout">
        <aside className="scriptSide">
          <section className="panel">
            <label htmlFor="script-project">Proyecto
              <select id="script-project" value={projectId} onChange={e => changeProject(e.target.value)}>
                {projects.length === 0 && <option value="">Sin proyectos</option>}
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {projects.length === 0 && <p className="muted small" style={{ marginTop: 8 }}><Link className="open" href="/projects?new=1">Crea un proyecto</Link> para empezar.</p>}
          </section>
          {scripts.length > 0 && (
            <section className="panel">
              <h3 style={{ marginBottom: 10 }}>Versiones</h3>
              <div className="versionList">
                {scripts.map(s => (
                  <button type="button" key={s.id} className={s.id === selectedId ? 'versionItem active' : 'versionItem'} onClick={() => choose(s.id)}>
                    v{s.version} · {scriptStatusLabels[s.status]}
                    <span>{new Date(s.updated_at).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="panel">
            <h3 style={{ marginBottom: 8 }}>Base de cada sección</h3>
            <div className="legend">{(Object.keys(basisLabels) as ScriptBasis[]).map(b => <span key={b} className="pill" title={basisHelp[b]}>{basisLabels[b]}</span>)}</div>
            <p className="muted small" style={{ marginTop: 10 }}>Los hechos y testimonios necesitan fuente. La reconstrucción no inventa emociones, diálogos ni detalles.</p>
          </section>
          <section className="panel">
            <span className={assistReady ? 'stateBadge state-functional' : 'stateBadge state-integration_ready'}>Asistencia IA</span>
            {assistReady === false && <p className="muted small" style={{ marginTop: 8 }}>Necesita <code>OPENAI_TEXT_API_KEY</code> u <code>OPENAI_API_KEY</code> en el servidor.</p>}
            {assistReady && <>
              <p className="muted small" style={{ margin: '8px 0 10px' }}>Propone texto a partir de la idea, el brief y la investigación del proyecto. Cada petición tiene coste. Nada se guarda hasta que lo apliques y pulses Guardar.</p>
              <div className="versionList">
                <button type="button" className="ghost" disabled={!draft || Boolean(assistBusy)} onClick={() => void assist('hook')}>{assistBusy === 'hook' ? 'Generando…' : 'Proponer hooks'}</button>
                <button type="button" className="ghost" disabled={!draft || Boolean(assistBusy)} onClick={() => void assist('draft')}>{assistBusy === 'draft' ? 'Generando…' : 'Proponer estructura completa'}</button>
              </div>
            </>}
          </section>
        </aside>

        <div className="editor">
          {project && !migrationPending && scripts.length === 0 && (
            <section className="panel">
              <h2>Empieza el guion de «{project.name}»</h2>
              <p className="muted" style={{ margin: '8px 0 14px' }}>
                Se rellenará con la idea del proyecto{opps.length ? ` y ${opps.length} oportunidad(es) investigada(s)` : ''}, con una estructura inicial editable: normalidad previa, punto de no retorno, fases críticas, desenlace y recompensa final.
              </p>
              <button type="button" onClick={createFirst} disabled={busy}><Icon name="plus" size={16} />{busy ? 'Creando…' : 'Crear guion v1'}</button>
            </section>
          )}

          {draft && selected && <>
            <div className="editorBar panel">
              <div className="stats">
                <span className="pill">{totals.words} palabras</span>
                <span className="pill info" title="Estimación a 150 palabras por minuto. No es una medición.">≈ {formatDuration(totals.seconds)} (estimación)</span>
                <span className={warnings.length ? 'pill warn' : 'pill ok'}>{warnings.length ? `${warnings.length} aviso(s)` : 'Sin avisos'}</span>
                {dirty && <span className="pill warn">Cambios sin guardar</span>}
              </div>
              <div className="pageActions">
                {dirty && <button type="button" className="ghost" onClick={discard}>Descartar</button>}
                <button type="button" className="ghost" onClick={newVersion} disabled={busy}><Icon name="copy" size={16} />Nueva versión</button>
                <button type="button" className="ghost" onClick={toStoryboard} disabled={busy}><Icon name="board" size={16} />Convertir en storyboard</button>
                <button type="button" onClick={save} disabled={busy || !dirty}>{busy ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>

            {proposal && (
              <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--accent)' }} aria-label="Propuesta de la IA">
                <div className="cardHead" style={{ marginBottom: 0 }}>
                  <h3>Propuesta IA {proposal.model && <span className="pill">{proposal.model}</span>}</h3>
                  <div className="pageActions">
                    <button type="button" className="ghost" onClick={() => setProposal(null)}>Descartar propuesta</button>
                    {proposal.mode === 'draft' && <button type="button" onClick={applyProposal}>Aplicar al borrador</button>}
                  </div>
                </div>
                <p className="muted small">Generado por IA: revisa cada dato. Las fuentes solo pueden venir de la investigación del proyecto; los marcadores [PENDIENTE] indican lo que falta investigar.</p>
                {proposal.hooks.map((h, i) => (
                  <div key={i} className="listItem">
                    <span>{h}</span>
                    {proposal.mode === 'hook' && <button type="button" className="ghost" onClick={() => { update({ hook: h }); setNotice('Hook aplicado al borrador.') }}>Usar</button>}
                  </div>
                ))}
                {proposal.sections.map((s, i) => (
                  <div key={i} className={`panel section basis-${s.basis}`}>
                    <b>{s.heading}</b> <span className="pill">{basisLabels[s.basis]}</span>
                    <p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{s.text}</p>
                    {s.sources.length > 0 && <p className="muted small">Fuentes: {s.sources.join(' · ')}</p>}
                  </div>
                ))}
                {proposal.cta && <p><b>Cierre:</b> {proposal.cta}</p>}
                {proposal.notes.length > 0 && <ul className="warnList">{proposal.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              </section>
            )}

            <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field-row">
                <label htmlFor="script-title">Título de trabajo<input id="script-title" value={draft.title} onChange={e => update({ title: e.target.value })} maxLength={200} /></label>
                <label htmlFor="script-status">Estado
                  <select id="script-status" value={draft.status} onChange={e => update({ status: e.target.value as Draft['status'] })}>
                    {Object.entries(scriptStatusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <label htmlFor="script-idea">Idea<textarea id="script-idea" value={draft.idea ?? ''} onChange={e => update({ idea: e.target.value })} placeholder="La historia en una o dos frases y por qué merece un vídeo." /></label>
              <label htmlFor="script-brief">Brief e investigación<textarea id="script-brief" rows={6} value={draft.brief ?? ''} onChange={e => update({ brief: e.target.value })} placeholder="Público, ángulo original, fuentes principales, qué debe sentir o aprender el espectador." /></label>
              <label htmlFor="script-hook">Hook (primeros segundos)<textarea id="script-hook" value={draft.hook ?? ''} onChange={e => update({ hook: e.target.value })} placeholder="La primera frase pone al espectador dentro de la situación." /></label>
            </section>

            <h3 className="sectionTitle">Estructura y narración</h3>
            {draft.sections.map((s, i) => (
              <section key={s.id} className={`panel section basis-${s.basis}`}>
                <div className="sectionHead">
                  <label htmlFor={`h-${s.id}`}>Sección {i + 1}<input id={`h-${s.id}`} value={s.heading} onChange={e => updateSection(s.id, { heading: e.target.value })} /></label>
                  <label htmlFor={`b-${s.id}`}>Base
                    <select id={`b-${s.id}`} value={s.basis} onChange={e => updateSection(s.id, { basis: e.target.value as ScriptBasis })}>
                      {(Object.keys(basisLabels) as ScriptBasis[]).map(b => <option key={b} value={b}>{basisLabels[b]}</option>)}
                    </select>
                  </label>
                  <div className="sectionTools">
                    <button type="button" className="iconButton" aria-label="Subir sección" onClick={() => moveSection(i, -1)} disabled={i === 0}><Icon name="up" size={16} /></button>
                    <button type="button" className="iconButton" aria-label="Bajar sección" onClick={() => moveSection(i, 1)} disabled={i === draft.sections.length - 1}><Icon name="down" size={16} /></button>
                    <button type="button" className="iconButton" aria-label="Eliminar sección" onClick={() => update({ sections: draft.sections.filter(x => x.id !== s.id) })}><Icon name="trash" size={16} /></button>
                  </div>
                </div>
                <label htmlFor={`t-${s.id}`}>Narración<textarea id={`t-${s.id}`} rows={5} value={s.text} onChange={e => updateSection(s.id, { text: e.target.value })} placeholder={basisHelp[s.basis]} /></label>
                <div className="sectionMeta">
                  <label htmlFor={`src-${s.id}`}>Fuentes (una por línea)
                    <textarea id={`src-${s.id}`} rows={2} value={s.sources.join('\n')} onChange={e => updateSection(s.id, { sources: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} placeholder="URL, libro, entrevista…" />
                  </label>
                  {s.basis === 'testimony'
                    ? <label htmlFor={`sp-${s.id}`}>Quién habla<input id={`sp-${s.id}`} value={s.speaker ?? ''} onChange={e => updateSection(s.id, { speaker: e.target.value })} placeholder="Nombre del protagonista" /></label>
                    : <p className="muted small" style={{ alignSelf: 'end' }}>{wordCount(s.text)} palabras · ≈ {estimateSeconds(s.text)} s (estimación)</p>}
                </div>
              </section>
            ))}
            <div className="pageActions">
              <button type="button" className="ghost" onClick={() => update({ sections: [...draft.sections, makeSection()] })}><Icon name="plus" size={16} />Añadir sección</button>
              <button type="button" className="ghost" onClick={() => update({ sections: [...draft.sections, makeSection('Testimonio', 'testimony')] })}><Icon name="mic" size={16} />Añadir testimonio</button>
            </div>

            <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label htmlFor="script-cta">Cierre y CTA<textarea id="script-cta" value={draft.cta ?? ''} onChange={e => update({ cta: e.target.value })} placeholder="Idea o paradoja que deja al espectador pensando y conecta con el siguiente vídeo." /></label>
              <label htmlFor="script-review">Notas de revisión<textarea id="script-review" value={draft.review_notes ?? ''} onChange={e => update({ review_notes: e.target.value })} placeholder="Qué comprobar o mejorar antes de aprobar." /></label>
            </section>

            {warnings.length > 0 && (
              <section className="warnBox">
                <b>Revisión antes de aprobar</b>
                <ul className="warnList">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
              </section>
            )}
          </>}
        </div>
      </div>
    </StudioShell>
  )
}
