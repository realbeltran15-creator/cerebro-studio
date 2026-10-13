'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { StudioShell } from '../components/studio-shell'
import { YouTubeResearch } from './youtube-research'
import { ChannelResearch } from './channel-analysis'
import { ResearchProvider } from './research-context'
import { FilterPanel } from './filter-panel'
import { CompareTab, KeywordsTab, NichesTab } from './tabs-analysis'
import { DiscoverTab, InternationalTab, MonetizationTab } from './tabs-trends'
import { SavedTab, type Opportunity } from './tab-saved'
import { createClient } from '../../lib/supabase/client'
import type { TabId } from '@/lib/research/filters'

const TABS = [['discover', 'Descubrir oportunidades'], ['niches', 'Nichos'], ['keywords', 'Palabras clave'], ['international', 'Tendencias internacionales'], ['competition', 'Competencia y canales'], ['money', 'Monetización'], ['compare', 'Comparador'], ['saved', 'Guardadas']] as const satisfies ReadonlyArray<readonly [TabId, string]>
type Tab = (typeof TABS)[number][0]

export default function MarketIntelligencePage() {
  const [items, setItems] = useState<Opportunity[]>([])
  const [message, setMessage] = useState('Comprobando acceso…')
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [tab, setTabState] = useState<Tab>('discover')

  const setTab = useCallback((t: string) => { if (TABS.some(x => x[0] === t)) { setTabState(t as Tab); try { window.sessionStorage.setItem('cerebro.research.tab', t) } catch { /* ignore */ } } }, [])
  useEffect(() => { try { const t = window.sessionStorage.getItem('cerebro.research.tab'); if (t && TABS.some(x => x[0] === t)) setTabState(t as Tab) } catch { /* ignore */ } }, [])

  const load = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) { setAuthenticated(false); setMessage('Inicia sesión para trabajar con oportunidades protegidas por RLS.'); return }
      setAuthenticated(true)
      const { data, error } = await supabase.from('opportunities').select('id,title,source_platform,query,region,language,status,confidence,observed_metrics,calculated_metrics,created_at').order('created_at', { ascending: false }).limit(50)
      if (error) throw error
      setItems((data ?? []) as Opportunity[])
      setMessage(`${data?.length ?? 0} oportunidad(es) en el workspace.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo cargar Market Intelligence.') }
  }, [])
  useEffect(() => { void load() }, [load])

  return <StudioShell title="Investigación" eyebrow="INTELIGENCIA DE MERCADO" actions={<Link className="buttonLink ghost" href="/youtube">Explorar YouTube</Link>}>
    <p className="connectionStatus">{message}</p>
    {authenticated === false ? <Link className="buttonLink" href="/login">Iniciar sesión</Link> : authenticated === true ? <ResearchProvider>
      <p className="muted small" style={{ margin: '0 0 4px' }}>1 · Qué quieres investigar</p>
      <div className="researchTabs" role="tablist" aria-label="Secciones de Investigación">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <FilterPanel tab={tab} />
      {tab === 'discover' && <DiscoverTab onSaved={() => void load()} goTo={setTab} />}
      {tab === 'niches' && <NichesTab onSaved={() => void load()} />}
      {tab === 'keywords' && <KeywordsTab />}
      {tab === 'international' && <InternationalTab onSaved={() => void load()} />}
      {tab === 'competition' && <><YouTubeResearch onSaved={() => void load()} /><ChannelResearch onSaved={() => void load()} /></>}
      {tab === 'money' && <MonetizationTab />}
      {tab === 'compare' && <CompareTab onSaved={() => void load()} />}
      {tab === 'saved' && <SavedTab items={items} onChanged={() => void load()} />}
      <p className="authNote">Los datos observados, las métricas calculadas, las estimaciones y las recomendaciones se mantienen separados y etiquetados. Esta pantalla no afirma viralidad ni publica contenido.</p>
    </ResearchProvider> : null}
  </StudioShell>
}
