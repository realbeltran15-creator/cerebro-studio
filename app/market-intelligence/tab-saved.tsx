'use client'

import { FormEvent, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { useResearch } from './research-context'
import type { OpportunityRow } from '@/lib/types/database'

export type Opportunity = Pick<OpportunityRow, 'id' | 'title' | 'source_platform' | 'query' | 'region' | 'language' | 'status' | 'confidence' | 'observed_metrics' | 'calculated_metrics' | 'created_at'>

/** Saved research: opportunities stored in the database, the combinations of filters and a manual log. */
export function SavedTab({ items, onChanged }: { items: Opportunity[]; onChanged: () => void }) {
  const { presets, applyPreset, deletePreset, clearAnalyses, list } = useResearch()
  const [title, setTitle] = useState(''), [query, setQuery] = useState(''), [region, setRegion] = useState(''), [language, setLanguage] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function add(e: FormEvent) {
    e.preventDefault()
    const clean = title.trim(); if (!clean) return
    setBusy(true); setError('')
    try {
      const supabase = getSupabaseBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const { error: err } = await supabase.from('opportunities').insert({ owner_id: user.id, title: clean, source_platform: 'manual', query: query.trim() || null, region: region.trim() || null, language: language.trim() || null, status: 'discovered', observed_metrics: {}, calculated_metrics: {}, evidence: [] })
      if (err) throw err
      setTitle(''); setQuery(''); onChanged()
    } catch (x) { setError(x instanceof Error ? x.message : 'No se pudo guardar la oportunidad.') } finally { setBusy(false) }
  }
  return <section className="panel" aria-label="Investigaciones guardadas">
    <h3>Investigaciones guardadas</h3>
    <h3 className="sectionTitle">Combinaciones de filtros favoritas</h3>
    {presets.length === 0 ? <p className="muted small">Aún no hay ninguna. Configura los filtros y pulsa «Guardar combinación». Se guardan en este navegador.</p> : <div className="list">{presets.map(p => <div key={p.id} className="listItem" style={{ flexWrap: 'wrap', gap: 8 }}><span><b>{p.name}</b> <span className="muted small">· {new Date(p.savedAt).toLocaleDateString('es-ES')}</span></span><span style={{ display: 'flex', gap: 8 }}><button type="button" onClick={() => applyPreset(p.id)}>Aplicar</button><button type="button" className="ghost" onClick={() => deletePreset(p.id)}>Borrar</button></span></div>)}</div>}
    <h3 className="sectionTitle">Oportunidades guardadas ({items.length})</h3>
    <p className="muted small">Los análisis guardados conservan lo observado, lo calculado y la evidencia por separado. Esta pantalla no afirma viralidad ni publica contenido.</p>
    <div className="projectList">{items.length === 0 ? <p className="emptyState">No hay oportunidades todavía.</p> : items.map(item => <article key={item.id}>
      <h3>{item.title}</h3>
      <p>{item.region || 'Mercado sin definir'} · {item.language || 'Idioma sin definir'} · {item.status}</p>
      <p>Fuente: {item.source_platform}{item.query ? ` · ${item.query}` : ''}</p>
    </article>)}</div>
    <h3 className="sectionTitle">Registro manual</h3>
    <form className="marketForm" onSubmit={add}>
      <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Oportunidad o tema" />
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Consulta de origen" />
      <input value={region} onChange={e => setRegion(e.target.value)} placeholder="Mercado, ej. DE" />
      <input value={language} onChange={e => setLanguage(e.target.value)} placeholder="Idioma, ej. de" />
      <button disabled={busy}>{busy ? 'Guardando…' : '+ Registrar oportunidad'}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    <h3 className="sectionTitle">Análisis de esta sesión ({list.length})</h3>
    <p className="muted small">Los análisis de pago se conservan en esta pestaña (y en la caché del servidor una semana) para no repetirlos. Borrarlos aquí no devuelve cuota.</p>
    <button type="button" className="ghost" disabled={list.length === 0} onClick={clearAnalyses}>Olvidar análisis de esta sesión</button>
  </section>
}
