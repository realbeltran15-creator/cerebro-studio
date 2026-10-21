'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  EMPTY_STORE, loadStore, projectWorkflow, recordTransitions, saveStore, setApproval, setCostLimit, STEPS, stepStateLabels,
  type ProjectWorkflow, type WfData, type WfProject, type WorkflowStore,
} from '@/lib/workflow'

/**
 * Flujos de producción: where each project is in the cycle idea → publicación, derived from its real rows.
 * Only two steps take an explicit owner approval (materials and montage review); the rest change when the work is done in its module.
 */
const stateClass: Record<string, string> = { done: 'ok', needs_approval: 'warn', blocked: 'bad', failed: 'bad', in_progress: 'info', pending: '' }
const stepName = (id: string) => STEPS.find(s => s.id === id)?.label ?? id

export default function WorkflowsPage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<WfProject[]>([])
  const [data, setData] = useState<WfData | null>(null)
  const [store, setStore] = useState<WorkflowStore>(EMPTY_STORE)
  const [storeReady, setStoreReady] = useState(false)
  const [open, setOpen] = useState('')
  const [filter, setFilter] = useState<'all' | 'attention' | 'done'>('all')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [p, s, b, a, r, j] = await Promise.all([
      supabase.from('projects').select('id,name,description,updated_at').order('updated_at', { ascending: false }).limit(200),
      supabase.from('scripts').select('project_id,status,source_opportunity_id,idea').limit(2000),
      supabase.from('storyboards').select('id,project_id').limit(1000),
      supabase.from('assets').select('id,project_id,asset_type,license_status,provenance').not('project_id', 'is', null).limit(5000),
      supabase.from('render_jobs').select('project_id,status,error').limit(2000),
      supabase.from('publication_jobs').select('project_id,platform,status').limit(2000),
    ])
    const err = [p, s, b, a, r, j].find(x => x.error)?.error
    if (err) { setError(err.message); return }
    const boards = (b.data ?? []) as WfData['storyboards']
    const sc = boards.length ? await supabase.from('scenes').select('storyboard_id').in('storyboard_id', boards.map(x => x.id)).limit(10000) : { data: [], error: null }
    setProjects((p.data ?? []) as WfProject[])
    setData({ scripts: (s.data ?? []) as WfData['scripts'], storyboards: boards, scenes: (sc.data ?? []) as WfData['scenes'], assets: (a.data ?? []) as WfData['assets'], renders: (r.data ?? []) as WfData['renders'], publications: (j.data ?? []) as WfData['publications'] })
  }, [supabase])

  useEffect(() => { void load(); void loadStore(supabase).then(st => { setStore(st); setStoreReady(true) }).catch(e => setError(e instanceof Error ? `No se pudo leer el historial: ${e.message}` : 'No se pudo leer el historial.')) }, [load, supabase])

  const flows = useMemo<ProjectWorkflow[]>(() => data ? projects.map(p => projectWorkflow(p, data, store.projects[p.id])) : [], [projects, data, store.projects])

  // History: record the state changes since the last visit (only once both the data and the stored snapshot are loaded).
  useEffect(() => {
    if (!storeReady || !flows.length) return
    const { store: next, changed } = recordTransitions(store, flows)
    if (!changed) return
    setStore(next)
    void saveStore(supabase, next).catch(() => undefined)
  }, [flows, storeReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next: WorkflowStore, message: string) {
    const prev = store
    setStore(next); setError(''); setNotice('')
    try { await saveStore(supabase, next); setNotice(message) } catch (e) { setStore(prev); setError(e instanceof Error ? e.message : 'No se pudo guardar.') }
  }

  const attention = (f: ProjectWorkflow) => f.overBudget || f.steps.some(s => s.state === 'failed' || s.state === 'blocked' || s.state === 'needs_approval')
  const shown = flows.filter(f => filter === 'all' ? true : filter === 'done' ? f.steps.slice(0, 7).every(s => s.state === 'done') : attention(f))
  const counts = { attention: flows.filter(attention).length, failed: flows.filter(f => f.steps.some(s => s.state === 'failed')).length }

  return <StudioShell title="Flujos de producción" eyebrow="AUTOMATIZACIONES">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <section className="panel" style={{ marginBottom: 18 }}>
      <p className="muted small" style={{ margin: 0 }}>Cada proyecto recorre Idea → Guion → Storyboard → Materiales → Montaje → Miniatura → Publicación → Analítica. El estado se calcula con lo que ya existe en el proyecto; los materiales y el montaje esperan tu visto bueno. Nada se genera, gasta ni publica desde aquí.</p>
      <div className="pageActions" role="group" aria-label="Filtrar flujos" style={{ marginTop: 12 }}>
        <button type="button" className={filter === 'all' ? 'small' : 'ghost small'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todos ({flows.length})</button>
        <button type="button" className={filter === 'attention' ? 'small' : 'ghost small'} aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Requieren atención ({counts.attention})</button>
        <button type="button" className={filter === 'done' ? 'small' : 'ghost small'} aria-pressed={filter === 'done'} onClick={() => setFilter('done')}>Publicados</button>
        {counts.failed > 0 && <span className="pill bad">{counts.failed} con errores</span>}
      </div>
    </section>

    {!data ? <p className="muted">Cargando…</p> : !shown.length ? <p className="muted">{flows.length ? 'Ningún proyecto en este filtro.' : <>Aún no hay proyectos. <Link href="/projects?new=1">Crea el primero</Link>.</>}</p> : <div className="workflowList">
      {shown.map(f => {
        const pid = f.project.id
        const isOpen = open === pid
        const history = store.history.filter(h => h.projectId === pid).slice(-12).reverse()
        return <article key={pid} className="workflowCard" aria-label={`Flujo de ${f.project.name}`}>
          <header className="workflowHead">
            <div><h3 style={{ margin: 0 }}>{f.project.name}</h3><span className="muted small">{f.done} de {STEPS.length} pasos hechos{f.costUsd > 0 ? ` · ${f.costUsd.toFixed(2)} USD estimados` : ''}{f.costLimitUsd !== null ? ` · límite ${f.costLimitUsd.toFixed(2)} USD` : ''}</span></div>
            {f.next && <Link className="buttonLink small" href={f.next.href}>{f.next.action ?? `Ir a ${f.next.label}`}</Link>}
          </header>
          <ol className="workflowSteps" aria-label="Pasos">
            {f.steps.map(s => <li key={s.id} className={`wfStep ${s.state}`} title={s.detail}><span className="wfDot" aria-hidden="true" /><span>{s.label}</span><span className="srOnly"> · {stepStateLabels[s.state]}</span></li>)}
          </ol>
          {f.warnings.map(w => <p key={w} className="warning small" role={f.overBudget ? 'alert' : undefined}>{w}</p>)}
          <button type="button" className="ghost small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : pid)}>{isOpen ? 'Ocultar detalle' : 'Ver detalle'}</button>
          {isOpen && <div className="workflowDetail">
            <table className="table small"><tbody>
              {f.steps.map(s => <tr key={s.id}>
                <th scope="row">{s.label}</th>
                <td><span className={`pill ${stateClass[s.state]}`}>{stepStateLabels[s.state]}</span></td>
                <td>{s.detail}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {(s.id === 'materials' || s.id === 'montage') && s.state === 'needs_approval' && <button type="button" className="small" onClick={() => void persist(setApproval(store, pid, s.id as 'materials' | 'montage', new Date().toISOString()), `${s.label} de «${f.project.name}» aprobado.`)}>Dar visto bueno</button>}
                  {(s.id === 'materials' || s.id === 'montage') && s.state === 'done' && <button type="button" className="ghost small" onClick={() => void persist(setApproval(store, pid, s.id as 'materials' | 'montage', null), `Visto bueno de ${s.label.toLowerCase()} retirado.`)}>Retirar visto bueno</button>}
                  {' '}{s.state !== 'done' && s.state !== 'pending' || s.action ? <Link href={s.href} className="small">{s.action ?? 'Abrir'}</Link> : null}
                </td>
              </tr>)}
            </tbody></table>
            <form className="pageActions" style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('limit') ?? '').trim(); void persist(setCostLimit(store, pid, v === '' ? null : Number(v.replace(',', '.'))), v === '' ? 'Límite de coste quitado.' : `Límite de coste de «${f.project.name}»: ${Number(v.replace(',', '.')).toFixed(2)} USD.`) }}>
              <label className="small">Límite de coste del proyecto (USD) <input name="limit" type="text" inputMode="decimal" defaultValue={f.costLimitUsd ?? ''} placeholder="sin límite" style={{ width: 110 }} aria-label={`Límite de coste de ${f.project.name}`} /></label>
              <button type="submit" className="ghost small">Guardar límite</button>
              <span className="muted small">El tope diario y mensual del servidor sigue aplicándose; este aviso es por proyecto.</span>
            </form>
            <h4 style={{ margin: '14px 0 6px' }}>Historial</h4>
            {history.length ? <ul className="small plainList">{history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {stepName(h.step)}: {h.from ? stepStateLabels[h.from] : '—'} → <b>{stepStateLabels[h.to]}</b></li>)}</ul> : <p className="muted small">Sin cambios registrados todavía (se anotan desde la primera visita).</p>}
          </div>}
        </article>
      })}
    </div>}
  </StudioShell>
}
