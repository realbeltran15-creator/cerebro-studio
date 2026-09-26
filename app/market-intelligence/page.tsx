'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { StudioShell } from '../components/studio-shell'
import { YouTubeResearch } from './youtube-research'
import { createClient } from '../../lib/supabase/client'
import type { OpportunityRow } from '../../lib/types/database'

type Opportunity = Pick<OpportunityRow, 'id' | 'title' | 'source_platform' | 'query' | 'region' | 'language' | 'status' | 'confidence' | 'observed_metrics' | 'calculated_metrics' | 'created_at'>

export default function MarketIntelligencePage() {
  const [items, setItems] = useState<Opportunity[]>([])
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState('')
  const [language, setLanguage] = useState('')
  const [message, setMessage] = useState('Comprobando acceso…')
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const supabase = createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) {
        setAuthenticated(false)
        setMessage('Inicia sesión para trabajar con oportunidades protegidas por RLS.')
        return
      }
      setAuthenticated(true)
      const { data, error } = await supabase
        .from('opportunities')
        .select('id,title,source_platform,query,region,language,status,confidence,observed_metrics,calculated_metrics,created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      setItems((data ?? []) as Opportunity[])
      setMessage(`${data?.length ?? 0} oportunidad(es) en el workspace.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar Market Intelligence.')
    }
  }

  useEffect(() => { void load() }, [])

  async function addOpportunity(event: FormEvent) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    setBusy(true)
    try {
      const supabase = createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) { setAuthenticated(false); setMessage('La sesión ha caducado.'); return }
      const { error } = await supabase.from('opportunities').insert({
        owner_id: user.id,
        title: cleanTitle,
        source_platform: 'manual',
        query: query.trim() || null,
        region: region.trim() || null,
        language: language.trim() || null,
        status: 'discovered',
        observed_metrics: {},
        calculated_metrics: {},
        evidence: []
      })
      if (error) throw error
      setTitle(''); setQuery('')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la oportunidad.')
    } finally { setBusy(false) }
  }

  return <StudioShell title="Investigación" eyebrow="INTELIGENCIA DE MERCADO" actions={<Link className="buttonLink ghost" href="/youtube">Explorar YouTube</Link>}>
    <p className="connectionStatus">{message}</p>
    {authenticated === false ? <Link className="buttonLink" href="/login">Iniciar sesión</Link> : authenticated === true ? <>
      <YouTubeResearch onSaved={() => void load()} />
      <h3 className="sectionTitle">Registro manual</h3>
      <form className="marketForm" onSubmit={addOpportunity}>
        <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Oportunidad o tema" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Consulta de origen" />
        <input value={region} onChange={e => setRegion(e.target.value)} placeholder="Mercado, ej. DE" />
        <input value={language} onChange={e => setLanguage(e.target.value)} placeholder="Idioma, ej. de" />
        <button disabled={busy}>{busy ? 'Guardando…' : '+ Registrar oportunidad'}</button>
      </form>
      <p className="authNote">Los datos observados, métricas calculadas y recomendaciones se mantienen separados. Esta pantalla no afirma viralidad ni publica contenido.</p>
      <div className="projectList">{items.length === 0 ? <p className="emptyState">No hay oportunidades todavía.</p> : items.map(item => <article key={item.id}>
        <h3>{item.title}</h3>
        <p>{item.region || 'Mercado sin definir'} · {item.language || 'Idioma sin definir'} · {item.status}</p>
        <p>Fuente: {item.source_platform}{item.query ? ` · ${item.query}` : ''}</p>
      </article>)}</div>
    </> : null}
  </StudioShell>
}
