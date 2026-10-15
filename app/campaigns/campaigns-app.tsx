'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildStrategy } from '@/lib/campaigns/strategy'
import { campaignJson, campaignReport } from '@/lib/campaigns/report'
import { create, duplicate, loadCampaigns, remove, saveCampaigns, setStatus, upsert } from '@/lib/campaigns/store'
import { EMPTY_BRIEF, type Brief, type CampaignStatus, type SavedCampaign } from '@/lib/campaigns/types'
import { BriefTab, BudgetTab, ConnectionsTab, ContentTab, ResultsTab, StrategyTab } from './views'

const TABS = [['brief', 'Brief'], ['strategy', 'Estrategia'], ['content', 'Contenido y creatividades'], ['budget', 'Presupuesto y calendario'], ['results', 'Resultados y reglas'], ['connections', 'Conexiones'], ['report', 'Informe']] as const
type Tab = (typeof TABS)[number][0]
const store = () => { try { return window.localStorage } catch { return null } }
const download = (name: string, text: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'campana'

/** Prefill from Investigación: /campaigns?topic=…&country=US. Never auto-creates a second campaign on reload. */
function fromLink(): Partial<Brief> | null {
  try {
    const p = new URLSearchParams(window.location.search), topic = p.get('topic')
    if (!topic) return null
    const country = (p.get('country') ?? '').toUpperCase()
    return { name: `Canal sobre ${topic}`.slice(0, 120), subject: 'channel', subjectName: topic.slice(0, 200), sourceTopic: topic.slice(0, 200), goal: 'subscribers', countries: /^[A-Z]{2}$/.test(country) ? [country] : [], projectId: (p.get('project') ?? '').slice(0, 64) }
  } catch { return null }
}

export function CampaignsApp() {
  const [list, setList] = useState<SavedCampaign[]>([])
  const [currentId, setCurrentId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('brief')
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState<'ok' | 'no'>('ok')
  const linked = useRef(false)

  useEffect(() => {
    let l = loadCampaigns(store())
    const pre = fromLink()
    if (pre && !linked.current) { linked.current = true; const c = create({ ...EMPTY_BRIEF, ...pre }); l = upsert(l, c); setCurrentId(c.id); try { window.history.replaceState(null, '', '/campaigns') } catch { /* ignore */ } }
    else setCurrentId(l.find(c => c.status !== 'archivada')?.id ?? l[0]?.id ?? '')
    setList(l); setReady(true)
  }, [])
  useEffect(() => { if (ready) setSaved(saveCampaigns(store(), list) ? 'ok' : 'no') }, [list, ready])

  const current = list.find(c => c.id === currentId) ?? null
  const brief = current?.brief ?? EMPTY_BRIEF
  const strategy = useMemo(() => buildStrategy(brief), [brief])
  const set = useCallback((patch: Partial<Brief>) => setList(l => { const c = l.find(x => x.id === currentId); return c ? upsert(l, { ...c, brief: { ...c.brief, ...patch } }) : l }), [currentId])
  const add = () => { const c = create(); setList(l => [c, ...l]); setCurrentId(c.id); setTab('brief') }
  const report = useMemo(() => (current ? campaignReport(brief) : ''), [current, brief])

  if (!ready) return <p className="muted">Cargando campañas…</p>
  return <div className="campaigns">
    <p className="muted small">Las campañas se diseñan y se guardan <b>en este navegador</b>, sin ninguna cuenta publicitaria. Cerebro Studio no publica anuncios ni gasta presupuesto. {saved === 'no' && <b className="error"> No se pudo guardar en este navegador.</b>}</p>
    <div className="campaignBar">
      <label className="muted small" htmlFor="campaign-select">Campaña</label>
      <select id="campaign-select" value={currentId} onChange={e => setCurrentId(e.target.value)} disabled={list.length === 0}>
        {list.length === 0 && <option value="">Sin campañas</option>}
        {list.map(c => <option key={c.id} value={c.id}>{c.brief.name || c.brief.subjectName || 'Sin título'} · {c.status}</option>)}
      </select>
      <button type="button" onClick={add}>+ Nueva campaña</button>
      <button type="button" className="ghost" disabled={!current} onClick={() => { const l = duplicate(list, currentId); setList(l); setCurrentId(l[0].id) }}>Duplicar</button>
      <select aria-label="Estado de la campaña" disabled={!current} value={current?.status ?? 'borrador'} onChange={e => setList(l => setStatus(l, currentId, e.target.value as CampaignStatus))}><option value="borrador">Borrador</option><option value="lista">Lista para ejecutar</option><option value="archivada">Archivada</option></select>
      <button type="button" className="ghost" disabled={!current} onClick={() => { if (window.confirm('¿Eliminar esta campaña de este navegador? No se puede deshacer.')) { const l = remove(list, currentId); setList(l); setCurrentId(l[0]?.id ?? '') } }}>Eliminar</button>
    </div>
    {!current ? <section className="panel"><h3>Empieza una campaña</h3><p>Responde a nueve preguntas (puedes dejar las que no sepas) y Cerebro Studio propone la estrategia, el presupuesto y el calendario. También puedes empezar desde un análisis de <a className="open" href="/market-intelligence">Investigación</a>.</p><button type="button" onClick={add}>+ Nueva campaña</button></section> : <>
      <div className="researchTabs" role="tablist" aria-label="Secciones de la campaña">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
      <div role="tabpanel" aria-label={TABS.find(t => t[0] === tab)![1]}>
        {tab === 'brief' && <BriefTab brief={brief} set={set} strategy={strategy} />}
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
