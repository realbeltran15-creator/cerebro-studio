'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Automation, AutomationKind } from '@/lib/automations/run'
import type { YouTubeCategory } from '@/lib/providers/youtube-data'

type Run = { id: string; automation_id: string; trigger: string; status: string; summary: Record<string, unknown>; error: string | null; started_at: string; finished_at: string | null }
type Status = { providers?: Array<{ id: string; enabled: boolean }> }

const kindLabels: Record<AutomationKind, string> = { trend_watch: 'Vigilar tendencias', opportunity_refresh: 'Actualizar métricas de oportunidades' }
const regions = ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'US', 'GB', 'DE', 'FR', 'IT', 'PT', 'BR']

function describe(a: Automation) {
  const c = a.config
  if (a.kind === 'trend_watch') {
    const keywords = Array.isArray(c.keywords) ? (c.keywords as string[]).join(', ') : ''
    return `${String(c.region ?? 'ES')}${c.categoryId ? ` · categoría ${String(c.categoryId)}` : ''} · palabras: ${keywords || '—'} · ${c.autoSave ? 'guarda coincidencias en Oportunidades' : 'solo informa'}`
  }
  return `Hasta ${Number(c.maxItems ?? 50)} oportunidades de YouTube por ejecución`
}

function summaryText(r: Run) {
  const s = r.summary ?? {}
  if (r.status === 'failed') return r.error ?? 'Falló'
  if (r.status === 'running') return 'En curso…'
  if ('matched' in s) return `${String(s.checked)} en tendencia · ${String(s.matched)} coinciden · ${String(s.saved)} guardadas${Number(s.duplicates) ? ` · ${String(s.duplicates)} ya existían` : ''}`
  if ('updated' in s) return `${String(s.updated)} de ${String(s.checked)} actualizadas${Number(s.missing) ? ` · ${String(s.missing)} ya no disponibles` : ''}`
  return 'Completada'
}

export default function AutomationsPage() {
  const supabase = getSupabaseBrowserClient()
  const [items, setItems] = useState<Automation[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [status, setStatus] = useState<{ youtube: boolean; scheduler: boolean } | null>(null)
  const [kind, setKind] = useState<AutomationKind>('trend_watch')
  const [name, setName] = useState('')
  const [region, setRegion] = useState('ES')
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<YouTubeCategory[]>([])
  const [keywords, setKeywords] = useState('')
  const [autoSave, setAutoSave] = useState(true)
  const [maxItems, setMaxItems] = useState(50)
  const [schedule, setSchedule] = useState<'daily' | 'manual'>('daily')
  const [running, setRunning] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [{ data: a, error: e }, { data: r }] = await Promise.all([
      supabase.from('automations').select('id,owner_id,kind,name,enabled,schedule,config,last_run_at').order('created_at', { ascending: false }),
      supabase.from('automation_runs').select('id,automation_id,trigger,status,summary,error,started_at,finished_at').order('started_at', { ascending: false }).limit(20),
    ])
    if (e) { setError(e.message); return }
    setItems((a ?? []) as Automation[]); setRuns((r ?? []) as Run[])
  }, [supabase])

  useEffect(() => {
    void load()
    void fetch('/api/providers/status', { cache: 'no-store' }).then(r => r.json() as Promise<Status>).then(j => setStatus({
      youtube: Boolean(j.providers?.some(p => p.id === 'youtube-data' && p.enabled)),
      scheduler: Boolean(j.providers?.some(p => p.id === 'automation-scheduler' && p.enabled)),
    })).catch(() => setStatus(null))
  }, [load])

  useEffect(() => {
    if (kind !== 'trend_watch') return
    setCategoryId('')
    void fetch(`/api/research/categories?region=${region}`).then(r => r.json() as Promise<{ categories?: YouTubeCategory[] }>).then(j => setCategories(j.categories ?? [])).catch(() => setCategories([]))
  }, [region, kind])

  async function create(event: FormEvent) {
    event.preventDefault()
    setError(''); setNotice('')
    const words = keywords.split(',').map(k => k.trim()).filter(k => k.length > 1)
    if (kind === 'trend_watch' && words.length === 0) { setError('Añade al menos una palabra clave para detectar vídeos relevantes.'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('La sesión ha caducado.'); return }
    const config = kind === 'trend_watch' ? { region, categoryId: categoryId || null, keywords: words, autoSave } : { maxItems }
    const { error: e } = await supabase.from('automations').insert({ owner_id: user.id, kind, name: name.trim() || kindLabels[kind], schedule, config })
    if (e) { setError(e.message); return }
    setName(''); setKeywords('')
    setNotice('Automatización creada.')
    await load()
  }

  async function run(a: Automation) {
    setRunning(a.id); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/automations/${a.id}/run`, { method: 'POST' })
      const json = await r.json() as { ok?: boolean; error?: string }
      if (!r.ok || !json.ok) throw new Error(json.error ?? 'La ejecución falló.')
      setNotice(`«${a.name}» ejecutada.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'La ejecución falló.') }
    finally { setRunning(''); await load() }
  }

  async function toggle(a: Automation) {
    const { error: e } = await supabase.from('automations').update({ enabled: !a.enabled, updated_at: new Date().toISOString() }).eq('id', a.id)
    if (e) setError(e.message); else await load()
  }

  async function remove(a: Automation) {
    if (!window.confirm(`¿Borrar «${a.name}» y su historial?`)) return
    const { error: e } = await supabase.from('automations').delete().eq('id', a.id)
    if (e) setError(e.message); else await load()
  }

  return <StudioShell title="Automatizaciones" eyebrow="OPERACIONES" actions={<Link className="buttonLink ghost" href="/opportunities">Ver oportunidades</Link>}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {status && !status.youtube && <p className="warnBox">Las automatizaciones usan YouTube Data API: falta <code>YOUTUBE_API_KEY</code> en el servidor.</p>}
    {status && !status.scheduler && <p className="warnBox">La ejecución diaria automática no está activa: faltan <code>CRON_SECRET</code> y <code>SUPABASE_SERVICE_ROLE_KEY</code> en Vercel. Mientras tanto puedes ejecutarlas manualmente.</p>}

    <section className="panel" style={{ marginBottom: 18 }}>
      <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field-row">
          <label htmlFor="au-kind">Tipo
            <select id="au-kind" value={kind} onChange={e => setKind(e.target.value as AutomationKind)}>
              <option value="trend_watch">{kindLabels.trend_watch}</option>
              <option value="opportunity_refresh">{kindLabels.opportunity_refresh}</option>
            </select>
          </label>
          <label htmlFor="au-name">Nombre<input id="au-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder={kindLabels[kind]} /></label>
          <label htmlFor="au-schedule">Frecuencia
            <select id="au-schedule" value={schedule} onChange={e => setSchedule(e.target.value as 'daily' | 'manual')}>
              <option value="daily">Diaria (07:00 UTC)</option>
              <option value="manual">Solo manual</option>
            </select>
          </label>
        </div>
        {kind === 'trend_watch' ? <>
          <div className="field-row">
            <label htmlFor="au-region">País
              <select id="au-region" value={region} onChange={e => setRegion(e.target.value)}>{regions.map(r => <option key={r}>{r}</option>)}</select>
            </label>
            <label htmlFor="au-cat">Categoría
              <select id="au-cat" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">Todas</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label htmlFor="au-keywords">Palabras clave (separadas por comas)<input id="au-keywords" value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="supervivencia, rescate, expedición" /></label>
          </div>
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} /> Guardar coincidencias en Oportunidades (sin duplicados)</label>
          <p className="muted small">Cada ejecución consulta la lista oficial de tendencias (unas 2 unidades de cuota) y compara los títulos con tus palabras clave.</p>
        </> : <>
          <label htmlFor="au-max" style={{ maxWidth: 260 }}>Máximo de oportunidades por ejecución<input id="au-max" type="number" min={1} max={200} value={maxItems} onChange={e => setMaxItems(Math.min(Math.max(Number(e.target.value) || 1, 1), 200))} /></label>
          <p className="muted small">Vuelve a leer vistas, likes y comentarios de tus oportunidades de YouTube (1 unidad de cuota por cada 50) y calcula el crecimiento desde la última lectura. Conserva un historial de 30 lecturas.</p>
        </>}
        <div><button><Icon name="plus" size={16} />Crear automatización</button></div>
      </form>
    </section>

    <h3 className="sectionTitle">Automatizaciones ({items.length})</h3>
    {items.length === 0 ? <p className="emptyState">Todavía no hay automatizaciones.</p> : <div className="list">
      {items.map(a => <div key={a.id} className="listItem" style={{ flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <b>{a.name}</b> <span className={a.enabled ? 'pill ok' : 'pill'}>{a.enabled ? 'Activa' : 'Pausada'}</span> <span className="pill">{a.schedule === 'daily' ? 'Diaria' : 'Manual'}</span>
          <span className="muted small" style={{ display: 'block' }}>{kindLabels[a.kind]} · {describe(a)}</span>
          <span className="muted small" style={{ display: 'block' }}>Última ejecución: {a.last_run_at ? new Date(a.last_run_at).toLocaleString() : 'nunca'}</span>
        </div>
        <div className="pageActions">
          <button type="button" disabled={Boolean(running)} onClick={() => void run(a)}>{running === a.id ? 'Ejecutando…' : 'Ejecutar ahora'}</button>
          <button type="button" className="ghost" onClick={() => void toggle(a)}>{a.enabled ? 'Pausar' : 'Activar'}</button>
          <button type="button" className="iconButton" aria-label="Borrar automatización" onClick={() => void remove(a)}><Icon name="trash" size={16} /></button>
        </div>
      </div>)}
    </div>}

    {runs.length > 0 && <>
      <h3 className="sectionTitle">Ejecuciones recientes</h3>
      <div className="list">{runs.map(r => {
        const a = items.find(x => x.id === r.automation_id)
        const matches = Array.isArray(r.summary?.matches) ? r.summary.matches as Array<{ title: string; url: string }> : []
        const top = Array.isArray(r.summary?.top) ? r.summary.top as Array<{ title: string; url: string; viewsGained: number }> : []
        return <div key={r.id} className="listItem" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <b>{a?.name ?? 'Automatización'}</b> <span className={r.status === 'succeeded' ? 'pill ok' : r.status === 'failed' ? 'pill warn' : 'pill'}>{r.status === 'succeeded' ? 'Correcta' : r.status === 'failed' ? 'Falló' : 'En curso'}</span> <span className="pill">{r.trigger === 'manual' ? 'Manual' : 'Programada'}</span>
            <span className="small" style={{ display: 'block' }}>{summaryText(r)}</span>
            {matches.length > 0 && <ul className="small" style={{ margin: '4px 0 0 16px' }}>{matches.slice(0, 5).map(m => <li key={m.url}><a href={m.url} target="_blank" rel="noopener noreferrer">{m.title}</a></li>)}</ul>}
            {top.length > 0 && <ul className="small" style={{ margin: '4px 0 0 16px' }}>{top.map(m => <li key={m.url}><a href={m.url} target="_blank" rel="noopener noreferrer">{m.title}</a> · +{m.viewsGained.toLocaleString('es-ES')} vistas</li>)}</ul>}
          </div>
          <span className="muted small">{new Date(r.started_at).toLocaleString()}</span>
        </div>
      })}</div>
    </>}
  </StudioShell>
}
