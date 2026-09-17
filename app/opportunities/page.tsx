'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../lib/supabase/client'
import type { OpportunityRow } from '../../lib/types/database'

type Opportunity = Pick<OpportunityRow, 'id' | 'title' | 'source_platform' | 'query' | 'region' | 'language' | 'status' | 'confidence' | 'created_at'>

const statusLabel: Record<string, string> = {
  discovered: 'A · Descubierta',
  research_needed: 'B · Investigación necesaria',
  experiment_candidate: 'C · Candidata a experimento',
  experiment_approved: 'D · Experimento aprobado',
  discarded: 'E · Descartada',
}

export default function OpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([])
  const [message, setMessage] = useState('Comprobando acceso…')
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    try {
      const supabase = createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) {
        setAuthenticated(false)
        setMessage('Inicia sesión para evaluar oportunidades protegidas por RLS.')
        return
      }
      setAuthenticated(true)
      const { data, error } = await supabase
        .from('opportunities')
        .select('id,title,source_platform,query,region,language,status,confidence,created_at')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      setItems((data ?? []) as Opportunity[])
      setMessage(`${data?.length ?? 0} oportunidad(es) disponibles para evaluación.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron cargar las oportunidades.')
    }
  }

  useEffect(() => { void load() }, [])

  async function setStatus(id: string, status: string) {
    setBusyId(id)
    try {
      const supabase = createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!user) { setAuthenticated(false); setMessage('La sesión ha caducado.'); return }
      const { error } = await supabase.from('opportunities').update({ status }).eq('id', id).eq('owner_id', user.id)
      if (error) throw error
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo actualizar la oportunidad.')
    } finally { setBusyId(null) }
  }

  return <main className="projectsPage"><section className="projectsPanel marketPanel">
    <Link className="backLink" href="/">← Centro de operaciones</Link>
    <small>DECISIÓN CONTROLADA</small><h1>Oportunidades</h1>
    <p>Convierte señales verificadas en hipótesis evaluables sin saltarse las puertas de aprobación.</p>
    <p className="connectionStatus">{message}</p>
    {authenticated === false ? <Link className="buttonLink" href="/login">Iniciar sesión</Link> : authenticated === true ? <>
      <p className="authNote">Cambiar el estado clasifica la oportunidad. “Experimento aprobado” no autoriza publicación, gasto ni contacto externo; esas acciones conservan sus gates independientes.</p>
      <div className="projectList">{items.length === 0 ? <p className="emptyState">No hay oportunidades. Registra primero una señal en Market Intelligence.</p> : items.map(item => <article key={item.id}>
        <h3>{item.title}</h3>
        <p>{item.region || 'Mercado sin definir'} · {item.language || 'Idioma sin definir'} · {statusLabel[item.status] || item.status}</p>
        <p>Fuente: {item.source_platform}{item.query ? ` · ${item.query}` : ''}{item.confidence != null ? ` · confianza ${item.confidence}` : ''}</p>
        <div className="statusActions">
          <button disabled={busyId === item.id} onClick={() => void setStatus(item.id, 'research_needed')}>Investigar</button>
          <button disabled={busyId === item.id} onClick={() => void setStatus(item.id, 'experiment_candidate')}>Candidata</button>
          <button disabled={busyId === item.id} onClick={() => void setStatus(item.id, 'experiment_approved')}>Aprobar experimento</button>
          <button disabled={busyId === item.id} onClick={() => void setStatus(item.id, 'discarded')}>Descartar</button>
        </div>
      </article>)}</div>
    </> : null}
  </section></main>
}
