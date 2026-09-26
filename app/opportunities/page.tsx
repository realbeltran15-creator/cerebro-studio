'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { OpportunityRow } from '@/lib/types/database'
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
    const notes = notesOf(o)
    const { data, error: e } = await supabase.from('projects').insert({
      owner_id: user.id, name: o.title, status: 'research', target_platforms: ['youtube'],
      description: [`Oportunidad (${o.source_platform}${o.query ? ` · ${o.query}` : ''})`, ...notes].join('\n'),
    }).select('id').single()
    if (e) { setBusyId(''); setError(e.message); return }
    await supabase.from('opportunities').update({ project_id: data.id, status: 'candidate' }).eq('id', o.id)
    router.push(`/projects/${data.id}`)
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
        <label htmlFor="opp-source">Fuente<select id="opp-source" value={source} onChange={e => setSource(e.target.value)}><option value="">Todas</option>{sources.map(s => <option key={s}>{s}</option>)}</select></label>
        <label htmlFor="opp-sort">Orden<select id="opp-sort" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="new">Más recientes</option><option value="old">Más antiguas</option><option value="title">Título A–Z</option><option value="viewsPerDay">Más vistas/día</option><option value="viewsToSubscribers">Mayor ratio vistas/suscriptores</option><option value="growth">Más crecimiento reciente</option></select></label>
      </div>
      <p className="muted small" style={{ marginBottom: 12 }}>{visible.length} de {items.length} · Las métricas solo aparecen cuando son datos observados con fuente; nada se estima aquí.</p>
      {items.some(o => o.source_platform === 'youtube') && <div className="pageActions" style={{ marginBottom: 12 }}>
        <button type="button" className="ghost" disabled={Boolean(refreshing)} onClick={() => void refresh()}>{refreshing === 'all' ? 'Actualizando…' : 'Actualizar métricas de YouTube'}</button>
        <span className="muted small">Lee las métricas actuales (1 unidad de cuota por cada 50 vídeos) y guarda el historial.</span>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {loading ? <p className="muted">Cargando…</p> : visible.length === 0 ? <p className="emptyState">{items.length ? 'Ninguna oportunidad coincide con los filtros.' : 'Aún no hay oportunidades. Registra un hallazgo desde Investigación o YouTube.'}</p> : (
        <div className="grid">
          {visible.map(o => {
            const observed = observedSummary(o.observed_metrics)
            const calculated = calculatedSummary(o.calculated_metrics)
            const at = observedAt(o.observed_metrics)
            const history = viewsHistory(o.observed_metrics)
            return (
              <article key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <small>{o.source_platform} · {o.region || 'Global'} · {o.language || '—'} · {new Date(o.created_at).toLocaleDateString()}</small>
                <h3>{o.title}</h3>
                {o.query && <p>Consulta: {o.query}</p>}
                {notesOf(o).map((n, i) => <p key={i}>Observación: {n}</p>)}
                {observed.length > 0 && <p className="small"><b>Observado{at ? ` (${new Date(at).toLocaleDateString()})` : ''}:</b> {observed.join(' · ')}</p>}
                {calculated.length > 0 && <p className="small muted"><b>Calculado:</b> {calculated.join(' · ')}</p>}
                {history.length > 1 && <p className="small muted" title="Vistas en cada lectura guardada">Historial de vistas: {history.map(h => `${new Date(h.at).toLocaleDateString()} ${h.views.toLocaleString('es-ES')}`).join(' → ')}</p>}
                {o.source_id && /^https?:\/\//.test(o.source_id) && <a className="open" href={o.source_id} target="_blank" rel="noopener noreferrer">Fuente original ↗</a>}
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 10, flexWrap: 'wrap' }}>
                  <select aria-label="Estado de la oportunidad" value={o.status} onChange={e => void setOppStatus(o, e.target.value)} style={{ flex: 1, minWidth: 130 }}>
                    {Object.entries(statuses).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    {!(o.status in statuses) && <option value={o.status}>{o.status}</option>}
                  </select>
                  {o.source_platform === 'youtube' && o.source_id && <button type="button" className="ghost small" disabled={Boolean(refreshing)} onClick={() => void refresh([o.id])}>{refreshing === o.id ? 'Actualizando…' : 'Actualizar'}</button>}
                  {o.project_id
                    ? <Link className="buttonLink ghost small" href={`/projects/${o.project_id}`}>Ver proyecto</Link>
                    : <button type="button" className="small" disabled={busyId === o.id} onClick={() => void createProject(o)}>{busyId === o.id ? 'Creando…' : 'Crear proyecto'}</button>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </StudioShell>
  )
}
