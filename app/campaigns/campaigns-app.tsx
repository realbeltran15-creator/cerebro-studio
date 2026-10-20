'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { briefFromLink } from '@/lib/campaigns/link'
import { buildStrategy } from '@/lib/campaigns/strategy'
import { campaignJson, campaignReport } from '@/lib/campaigns/report'
import { changedSince, CloudUnavailable, deleteCloud, isUuid, loadCloud, loadSynced, mergeCampaigns, saveCloud, saveSynced, withUuidIds, type CloudState } from '@/lib/campaigns/cloud'
import { create, duplicate, loadCampaigns, remove, saveCampaigns, setStatus, upsert } from '@/lib/campaigns/store'
import { EMPTY_BRIEF, type Brief, type CampaignStatus, type SavedCampaign } from '@/lib/campaigns/types'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { BriefTab, BudgetTab, ConnectionsTab, ContentTab, ResultsTab, StrategyTab } from './views'

const TABS = [['brief', 'Brief'], ['strategy', 'Estrategia'], ['content', 'Contenido y creatividades'], ['budget', 'Presupuesto y calendario'], ['results', 'Resultados y reglas'], ['connections', 'Conexiones'], ['report', 'Informe']] as const
type Tab = (typeof TABS)[number][0]
const store = () => { try { return window.localStorage } catch { return null } }
const download = (name: string, text: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }
const CLOUD_TEXT: Record<CloudState, string> = {
  local: 'Se guardan en este navegador.',
  syncing: 'Guardando en tu cuenta…',
  synced: 'Guardadas en tu cuenta y en este navegador.',
  unavailable: 'Se guardan solo en este navegador (el guardado en la cuenta aún no está activado).',
  error: 'Se guardan en este navegador; no se pudo guardar en tu cuenta, se reintentará con el próximo cambio.',
}
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'campana'

/** Prefill from Investigación (see lib/campaigns/link.ts). The query string is removed afterwards so a reload never creates a second campaign. */
function fromLink(): Partial<Brief> | null { try { return briefFromLink(window.location.search) } catch { return null } }

export function CampaignsApp() {
  const [list, setList] = useState<SavedCampaign[]>([])
  const [currentId, setCurrentId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('brief')
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState<'ok' | 'no'>('ok')
  const linked = useRef(false)
  const booted = useRef(false)
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    // Optional link with Estudio projects: if the list cannot be read (not signed in, offline), campaigns still work.
    let off = false
    ;(async () => { try { const { data } = await getSupabaseBrowserClient().from('projects').select('id,name').order('updated_at', { ascending: false }).limit(100); if (!off && Array.isArray(data)) setProjects(data as Array<{ id: string; name: string }>) } catch { /* optional */ } })()
    return () => { off = true }
  }, [])

  useEffect(() => {
    // React StrictMode runs effects twice in development; the second run would reload the list without the campaign just created from a link.
    if (booted.current) return
    booted.current = true
    let l = loadCampaigns(store())
    const pre = fromLink()
    if (pre && !linked.current) { linked.current = true; const c = create({ ...EMPTY_BRIEF, ...pre }); l = upsert(l, c); setCurrentId(c.id); try { window.history.replaceState(null, '', '/campaigns') } catch { /* ignore */ } }
    else setCurrentId(l.find(c => c.status !== 'archivada')?.id ?? l[0]?.id ?? '')
    setList(l); setReady(true)
  }, [])
  useEffect(() => { if (ready) setSaved(saveCampaigns(store(), list) ? 'ok' : 'no') }, [list, ready])

  // Copy in the account (table `campaigns`). Before its migration is applied this reports 'unavailable' and nothing else changes.
  const [cloud, setCloud] = useState<CloudState>('local')
  const listRef = useRef(list)
  useEffect(() => { listRef.current = list }, [list])
  const projectIds = useRef<Set<string>>(new Set())
  useEffect(() => { projectIds.current = new Set(projects.map(p => p.id)) }, [projects])
  const synced = useRef<Set<string>>(new Set())
  const savedAt = useRef<Map<string, string>>(new Map())
  const cloudOn = useRef(false)
  const cloudStarted = useRef(false)
  const fail = (e: unknown) => { if (e instanceof CloudUnavailable) { cloudOn.current = false; setCloud('unavailable') } else setCloud('error') }
  useEffect(() => {
    if (!ready || cloudStarted.current) return
    cloudStarted.current = true
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') return
    const db = getSupabaseBrowserClient()
    ;(async () => {
      try {
        await Promise.resolve(); setCloud('syncing')
        const remote = await loadCloud(db)
        synced.current = loadSynced(store())
        const { list: local, renamed } = withUuidIds(listRef.current, () => crypto.randomUUID())
        const { list: merged, upload } = mergeCampaigns(local, remote, synced.current)
        await saveCloud(db, upload, projectIds.current)
        savedAt.current = new Map(merged.map(c => [c.id, c.updatedAt]))
        synced.current = new Set(merged.map(c => c.id)); saveSynced(store(), synced.current)
        cloudOn.current = true
        setList(merged)
        setCurrentId(id => { const n = renamed[id] ?? id; return merged.some(c => c.id === n) ? n : (merged.find(c => c.status !== 'archivada')?.id ?? merged[0]?.id ?? '') })
        setCloud('synced')
      } catch (e) { fail(e) }
    })()
  }, [ready])
  useEffect(() => {
    if (!cloudOn.current) return
    const timer = setTimeout(() => {
      const changed = changedSince(list, savedAt.current).filter(c => isUuid(c.id))
      if (!changed.length) return
      setCloud('syncing')
      void saveCloud(getSupabaseBrowserClient(), changed, projectIds.current).then(() => {
        for (const c of changed) { savedAt.current.set(c.id, c.updatedAt); synced.current.add(c.id) }
        saveSynced(store(), synced.current); setCloud('synced')
      }).catch(fail)
    }, 1500)
    return () => clearTimeout(timer)
  }, [list])
  const removeCurrent = () => {
    const id = currentId, l = remove(list, id); setList(l); setCurrentId(l[0]?.id ?? '')
    if (cloudOn.current) void deleteCloud(getSupabaseBrowserClient(), id).then(() => { synced.current.delete(id); savedAt.current.delete(id); saveSynced(store(), synced.current) }).catch(fail)
  }

  const current = list.find(c => c.id === currentId) ?? null
  const brief = current?.brief ?? EMPTY_BRIEF
  const strategy = useMemo(() => buildStrategy(brief), [brief])
  const set = useCallback((patch: Partial<Brief>) => setList(l => { const c = l.find(x => x.id === currentId); return c ? upsert(l, { ...c, brief: { ...c.brief, ...patch } }) : l }), [currentId])
  const add = () => { const c = create(); setList(l => [c, ...l]); setCurrentId(c.id); setTab('brief') }
  const report = useMemo(() => (current ? campaignReport(brief) : ''), [current, brief])

  if (!ready) return <p className="muted">Cargando campañas…</p>
  return <div className="campaigns">
    <p className="muted small" data-cloud={cloud}>Las campañas se diseñan sin ninguna cuenta publicitaria: Cerebro Studio no publica anuncios ni gasta presupuesto. {CLOUD_TEXT[cloud]} {saved === 'no' && <b className="error"> No se pudo guardar en este navegador.</b>}</p>
    <div className="campaignBar">
      <label className="muted small" htmlFor="campaign-select">Campaña</label>
      <select id="campaign-select" value={currentId} onChange={e => setCurrentId(e.target.value)} disabled={list.length === 0}>
        {list.length === 0 && <option value="">Sin campañas</option>}
        {list.map(c => <option key={c.id} value={c.id}>{c.brief.name || c.brief.subjectName || 'Sin título'} · {c.status}</option>)}
      </select>
      <button type="button" onClick={add}>+ Nueva campaña</button>
      <button type="button" className="ghost" disabled={!current} onClick={() => { const l = duplicate(list, currentId); setList(l); setCurrentId(l[0].id) }}>Duplicar</button>
      <select aria-label="Estado de la campaña" disabled={!current} value={current?.status ?? 'borrador'} onChange={e => setList(l => setStatus(l, currentId, e.target.value as CampaignStatus))}><option value="borrador">Borrador</option><option value="lista">Lista para ejecutar</option><option value="archivada">Archivada</option></select>
      <button type="button" className="ghost" disabled={!current} onClick={() => { if (window.confirm(cloudOn.current ? '¿Eliminar esta campaña de tu cuenta y de este navegador? No se puede deshacer.' : '¿Eliminar esta campaña de este navegador? No se puede deshacer.')) removeCurrent() }}>Eliminar</button>
    </div>
    {!current ? <section className="panel"><h3>Empieza una campaña</h3><p>Responde a nueve preguntas (puedes dejar las que no sepas) y Cerebro Studio propone la estrategia, el presupuesto y el calendario. También puedes empezar desde un análisis de <a className="open" href="/market-intelligence">Investigación</a>.</p><button type="button" onClick={add}>+ Nueva campaña</button></section> : <>
      <div className="researchTabs" role="tablist" aria-label="Secciones de la campaña">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
      <div role="tabpanel" aria-label={TABS.find(t => t[0] === tab)![1]}>
        {tab === 'brief' && <BriefTab brief={brief} set={set} strategy={strategy} projects={projects} />}
        {tab === 'strategy' && <StrategyTab brief={brief} set={set} strategy={strategy} />}
        {tab === 'content' && <ContentTab strategy={strategy} />}
        {tab === 'budget' && <BudgetTab brief={brief} set={set} strategy={strategy} />}
        {tab === 'results' && <ResultsTab brief={brief} set={set} strategy={strategy} />}
        {tab === 'connections' && <ConnectionsTab brief={brief} />}
        {tab === 'report' && <div>
          <p className="muted small">Informe final de la campaña. Incluye lo decidido, los supuestos, lo que falta y los límites.</p>
          <div className="campaignBar"><button type="button" onClick={() => download(`campana-${slug(brief.name || brief.subjectName)}.md`, report, 'text/markdown')}>Descargar informe (.md)</button><button type="button" className="ghost" onClick={() => download(`campana-${slug(brief.name || brief.subjectName)}.json`, campaignJson(brief), 'application/json')}>Descargar datos (.json)</button><button type="button" className="ghost" onClick={() => navigator.clipboard?.writeText(report)}>Copiar</button></div>
          <pre className="reportPreview" aria-label="Vista previa del informe">{report}</pre></div>}
      </div>
    </>}
  </div>
}
