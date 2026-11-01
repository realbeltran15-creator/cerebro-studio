'use client'

import { statusLabel, languageLabel, regionLabel, sourceLabel } from '@/lib/research/labels'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { OpportunityRow } from '@/lib/types/database'
import { metricsFreshness, projectDraftFromOpportunity } from '@/lib/opportunity-project'
import { compareOpportunities, evidenceLabel, explainOpportunity, MAX_COMPARE } from '@/lib/opportunity-explain'
import { createScriptFromOpportunity, type ScriptPorts } from '@/lib/opportunity-script'
import { calculatedSummary, metricSortValue, observedAt, observedSummary, viewsHistory, type MetricSort } from '@/lib/opportunity-metrics'

const statuses: Record<string, string> = {
  // Must match opportunities_status_check in Supabase.
  discovered: 'Descubierta', research_needed: 'Necesita investigación', candidate: 'Candidata', experiment_approved: 'Experimento aprobado', discarded: 'Descartada',
}

function notesOf(o: OpportunityRow) {
  if (!Array.isArray(o.evidence)) return []
  return o.evidence.flatMap(ev => ev && typeof ev === 'object' && !Array.isArray(ev) && typeof ev.note === 'string' && ev.note.trim() ? [ev.note.trim()] : [])
}

export default function OpportunitiesPage() {
  const supabase = getSupabaseBrowserClient()
  const router = useRouter()
  const [items, setItems] = useState<OpportunityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [sort, setSort] = useState<'new' | 'old' | 'title' | MetricSort>('new')
  const [refreshing, setRefreshing] = useState('')
  const [notice, setNotice] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error: e } = await supabase.from('opportunities').select('*').order('created_at', { ascending: false })
    if (e) setError(e.message); else setItems((data ?? []) as OpportunityRow[])
    setLoading(false)
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function setOppStatus(o: OpportunityRow, next: string) {
    setError('')
    const { error: e } = await supabase.from('opportunities').update({ status: next, updated_at: new Date().toISOString() }).eq('id', o.id)
    if (e) setError(e.message); else setItems(list => list.map(x => x.id === o.id ? { ...x, status: next } : x))
  }

  async function createProject(o: OpportunityRow) {
    setError(''); setBusyId(o.id)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusyId(''); setError('Sesión requerida.'); return }
    // Doble clic / otra pestaña: si ya tiene proyecto, se reutiliza en vez de crear un duplicado.
    const { data: current } = await supabase.from('opportunities').select('project_id').eq('id', o.id).maybeSingle()
    if (current?.project_id) { setBusyId(''); router.push(`/projects/${current.project_id}`); return }
    const { data, error: e } = await supabase.from('projects').insert({ owner_id: user.id, ...projectDraftFromOpportunity(o, Date.now()) }).select('id').single()
    if (e) { setBusyId(''); setError(e.message); return }
    const { error: linkError } = await supabase.from('opportunities').update({ project_id: data.id, status: 'candidate' }).eq('id', o.id)
    if (linkError) { setBusyId(''); setError(`El proyecto se creó pero no se pudo vincular a la oportunidad (${linkError.message}). Ábrelo desde Proyectos.`); return }
    router.push(`/projects/${data.id}`)
  }

  async function createScript(o: OpportunityRow) {
    if (busyId) return
    setError(''); setNotice(''); setBusyId(o.id)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusyId(''); setError('Sesión requerida.'); return }
    const ports: ScriptPorts = {
      currentProjectId: async id => { const { data } = await supabase.from('opportunities').select('project_id').eq('id', id).maybeSingle(); return (data as { project_id: string | null } | null)?.project_id ?? null },
      insertProject: async draft => { const { data, error: e } = await supabase.from('projects').insert({ owner_id: user.id, ...draft }).select('id').single(); return e || !data ? { error: e?.message ?? 'No se pudo crear el proyecto.' } : { id: data.id } },
      linkOpportunity: async (id, projectId) => { const { error: e } = await supabase.from('opportunities').update({ project_id: projectId, status: 'candidate' }).eq('id', id); return e ? e.message : null },
      latestScript: async projectId => { const { data } = await supabase.from('scripts').select('id').eq('project_id', projectId).order('version', { ascending: false }).limit(1).maybeSingle(); return data ? { id: (data as { id: string }).id } : null },
      insertScript: async row => { const { data, error: e } = await supabase.from('scripts').insert({ owner_id: user.id, ...row }).select('id').single(); if (e) return e.code === '23505' ? { conflict: true as const } : { error: e.message }; return { id: (data as { id: string }).id } },
    }
    const r = await createScriptFromOpportunity(o, ports, Date.now())
    setBusyId('')
    if (!r.ok) { setError(r.error); return }
    if (r.warnings.length) setNotice(r.warnings.join(' '))
    router.push(`/scripts?project=${r.projectId}&script=${r.scriptId}`)
  }

  function togglePick(id: string) {
    setPicked(list => list.includes(id) ? list.filter(x => x !== id) : list.length >= MAX_COMPARE ? list : [...list, id])
  }

  async function refresh(ids?: string[]) {
    setError(''); setNotice(''); setRefreshing(ids?.[0] ?? 'all')
    try {
      const r = await fetch('/api/opportunities/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      const json = await r.json() as { updated?: number; checked?: number; missing?: number; error?: string }
      if (!r.ok) throw new Error(json.error ?? 'No se pudieron actualizar las métricas.')
      setNotice(`Métricas actualizadas: ${json.updated ?? 0} de ${json.checked ?? 0}${json.missing ? ` · ${json.missing} vídeos ya no están disponibles` : ''}.`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron actualizar las métricas.') } finally { setRefreshing('') }
  }

  const sources = useMemo(() => [...new Set(items.map(i => i.source_platform))], [items])
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = items.filter(o =>
      (!status || o.status === status) && (!source || o.source_platform === source) &&
      (!term || `${o.title} ${o.query ?? ''} ${o.region ?? ''} ${o.language ?? ''} ${notesOf(o).join(' ')}`.toLowerCase().includes(term)))
    if (sort === 'viewsPerDay' || sort === 'viewsToSubscribers' || sort === 'growth') {
      return [...list].sort((a, b) => metricSortValue(b.observed_metrics, b.calculated_metrics, sort) - metricSortValue(a.observed_metrics, a.calculated_metrics, sort))
    }
    return [...list].sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'old' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at))
  }, [items, q, status, source, sort])

  return (
    <StudioShell title="Oportunidades" eyebrow="DESCUBRIR → PROYECTO" actions={<Link className="buttonLink ghost" href="/market-intelligence">Registrar hallazgo</Link>}>
      <div className="field-row" style={{ marginBottom: 16 }}>
        <label htmlFor="opp-q">Buscar<input id="opp-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Tema, consulta, mercado, observación…" /></label>
        <label htmlFor="opp-status">Estado<select id="opp-status" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(statuses).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label htmlFor="opp-source">Fuente<select id="opp-source" value={source} onChange={e => setSource(e.target.value)}><option value="">Todas</option>{sources.map(s => <option key={s} value={s}>{sourceLabel(s)}</option>)}</select></label>
        <label htmlFor="opp-sort">Orden<select id="opp-sort" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="new">Más recientes</option><option value="old">Más antiguas</option><option value="title">Título A–Z</option><option value="viewsPerDay">Más vistas/día</option><option value="viewsToSubscribers">Mayor ratio vistas/suscriptores</option><option value="growth">Más crecimiento reciente</option></select></label>
      </div>
      <p className="muted small" style={{ marginBottom: 12 }}>{visible.length} de {items.length} · Las métricas solo aparecen cuando son datos observados con fuente; nada se estima aquí.</p>
      {items.some(o => o.source_platform === 'youtube') && <div className="pageActions" style={{ marginBottom: 12 }}>
        <button type="button" className="ghost" disabled={Boolean(refreshing)} onClick={() => void refresh()}>{refreshing === 'all' ? 'Actualizando…' : 'Actualizar métricas de YouTube'}</button>
        <span className="muted small">Lee las métricas actuales (1 unidad de cuota por cada 50 vídeos) y guarda el historial.</span>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {picked.length > 0 && <div className="pageActions" style={{ marginBottom: 12 }} role="group" aria-label="Comparador">
        <span className="small">{picked.length} seleccionada(s) (máximo {MAX_COMPARE})</span>
        <button type="button" disabled={picked.length < 2} onClick={() => setComparing(c => !c)}>{comparing ? 'Ocultar comparación' : 'Comparar'}</button>
        <button type="button" className="ghost" onClick={() => { setPicked([]); setComparing(false) }}>Quitar selección</button>
      </div>}
      {comparing && picked.length >= 2 && (() => {
        const chosen = items.filter(i => picked.includes(i.id)); const cmp = compareOpportunities(chosen, Date.now())
        return cmp.error ? <p className="error" role="alert">{cmp.error}</p> : (
          <div style={{ overflowX: 'auto', marginBottom: 16 }} tabIndex={0} aria-label="Tabla comparativa de oportunidades">
            <table className="small" style={{ borderCollapse: 'collapse', minWidth: 520 }}>
              <caption className="muted small" style={{ textAlign: 'left' }}>Datos guardados; donde falta información se indica. Sin puntuaciones inventadas ni predicciones.</caption>
              <thead><tr><th scope="col">Criterio</th>{chosen.map(c => <th key={c.id} scope="col">{c.title}</th>)}</tr></thead>
              <tbody>{cmp.rows.slice(1).map(r => <tr key={r.label}><th scope="row" style={{ textAlign: 'left' }}>{r.label}</th>{r.values.map((v, i) => <td key={i} style={{ verticalAlign: 'top', padding: '4px 8px' }}>{v}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )
      })()}
      {loading ? <p className="muted">Cargando…</p> : visible.length === 0 ? <p className="emptyState">{items.length ? 'Ninguna oportunidad coincide con los filtros.' : 'Aún no hay oportunidades. Registra un hallazgo desde Investigación o YouTube.'}</p> : (
        <div className="grid">
          {visible.map(o => {
            const observed = observedSummary(o.observed_metrics)
            const calculated = calculatedSummary(o.calculated_metrics)
            const at = observedAt(o.observed_metrics)
            const history = viewsHistory(o.observed_metrics)
            return (
              <article key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={picked.includes(o.id)} disabled={!picked.includes(o.id) && picked.length >= MAX_COMPARE} onChange={() => togglePick(o.id)} />Comparar</label>
                <small>{sourceLabel(o.source_platform)} · {regionLabel(o.region)} · {languageLabel(o.language)} · {new Date(o.created_at).toLocaleDateString()}</small>
                <h3>{o.title}</h3>
                {o.query && <p>Consulta: {o.query}</p>}
                {notesOf(o).map((n, i) => <p key={i}>Observación: {n}</p>)}
                {observed.length > 0 && <p className="small"><b>Observado{at ? ` (${new Date(at).toLocaleDateString()})` : ''}:</b> {observed.join(' · ')}{(() => { const f = metricsFreshness(o.observed_metrics, Date.now()); return f.level === 'stale' ? <span className="error small"> · Desactualizado: hace {f.days} días</span> : null })()}</p>}
                {calculated.length > 0 && <p className="small muted"><b>Calculado:</b> {calculated.join(' · ')}</p>}
                {history.length > 1 && <p className="small muted" title="Vistas en cada lectura guardada">Historial de vistas: {history.map(h => `${new Date(h.at).toLocaleDateString()} ${h.views.toLocaleString('es-ES')}`).join(' → ')}</p>}
                {(() => { const ex = explainOpportunity(o, Date.now()); return (
                  <details className="small">
                    <summary>¿Por qué aparece aquí? · {evidenceLabel[ex.evidenceLevel]} ({ex.evidenceCount}/5)</summary>
                    <p className="muted" style={{ margin: '4px 0' }}>Es un recuento de evidencias comprobables, no una probabilidad de éxito ni de viralidad.</p>
                    <p style={{ margin: '4px 0' }}><b>Observado:</b> {ex.observed.join(' · ') || 'Sin datos suficientes'}</p>
                    <p style={{ margin: '4px 0' }}><b>Calculado:</b> {ex.calculated.join(' · ') || 'Sin datos suficientes'}</p>
                    <p style={{ margin: '4px 0' }}><b>Estimado:</b> nada: esta pantalla no estima.</p>
                    <p style={{ margin: '4px 0' }}><b>Faltan:</b></p><ul>{ex.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
                    <p style={{ margin: '4px 0' }}><b>Riesgos:</b></p><ul>{ex.risks.map((m, i) => <li key={i}>{m}</li>)}</ul>
                  </details>) })()}
                {o.source_id && /^https?:\/\//.test(o.source_id) && <a className="open" href={o.source_id} target="_blank" rel="noopener noreferrer">Fuente original ↗</a>}
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 10, flexWrap: 'wrap' }}>
                  <select aria-label="Estado de la oportunidad" value={o.status} onChange={e => void setOppStatus(o, e.target.value)} style={{ flex: 1, minWidth: 130 }}>
                    {Object.entries(statuses).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    {!(o.status in statuses) && <option value={o.status}>{o.status}</option>}
                  </select>
                  {o.source_platform === 'youtube' && o.source_id && <button type="button" className="ghost small" disabled={Boolean(refreshing)} onClick={() => void refresh([o.id])}>{refreshing === o.id ? 'Actualizando…' : 'Actualizar'}</button>}
                  {o.project_id
                    ? <Link className="buttonLink ghost small" href={`/projects/${o.project_id}`}>Ver proyecto</Link>
                    : <button type="button" className="small" disabled={Boolean(busyId)} onClick={() => void createProject(o)}>{busyId === o.id ? 'Creando…' : 'Crear proyecto'}</button>}
                  <button type="button" className="small" disabled={Boolean(busyId)} onClick={() => void createScript(o)}>{busyId === o.id ? 'Creando…' : 'Crear guion'}</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </StudioShell>
  )
}
