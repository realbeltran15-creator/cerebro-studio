'use client'

import { FormEvent, useEffect, useState } from 'react'
import { YouTubeResults, type YouTubeSaveContext } from '../components/youtube-results'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

export function YouTubeResearch({ onSaved }: { onSaved: () => void }) {
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState('relevance')
  const [region, setRegion] = useState('')
  const [language, setLanguage] = useState('')
  const [days, setDays] = useState('')
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [context, setContext] = useState<YouTubeSaveContext>({ query: null, region: null, language: null, origin: 'search' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Radar links here with ?q=term; prefill only, since every search spends quota.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setQuery(q.slice(0, 200))
  }, [])

  async function search(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    if (!q || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const params = new URLSearchParams({ q, order })
      if (region.trim()) params.set('region', region.trim())
      if (language.trim()) params.set('lang', language.trim())
      if (days) params.set('days', days)
      const response = await fetch(`/api/research/youtube?${params}`, { cache: 'no-store' })
      const json = await response.json() as { results?: YouTubeVideoResult[]; error?: string }
      if (!response.ok) throw new Error(json.error ?? 'No se pudo consultar YouTube.')
      const rows = json.results ?? []
      // Saved opportunities keep the filters used for this search, not later edits to the form.
      setContext({ query: q, region: region.trim().toUpperCase() || null, language: language.trim().toLowerCase() || null, origin: 'search' })
      setResults(rows)
      if (rows.length === 0) setNotice('YouTube no devolvió resultados para esta búsqueda.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar YouTube.')
    } finally { setBusy(false) }
  }

  return <section className="panel" style={{ margin: '18px 0' }}>
    <h3>Buscar en YouTube</h3>
    <p className="muted small" style={{ margin: '6px 0 12px' }}>Consulta YouTube Data API desde el servidor. Solo lectura: no conecta tu canal ni publica nada. Cada búsqueda consume unas 102 unidades de la cuota diaria.</p>
    <form className="marketForm" onSubmit={search}>
      <input required value={query} onChange={e => setQuery(e.target.value)} placeholder="Tema, historia o formato" maxLength={200} aria-label="Búsqueda en YouTube" />
      <select value={order} onChange={e => setOrder(e.target.value)} aria-label="Orden">
        <option value="relevance">Relevancia</option>
        <option value="viewCount">Más vistas</option>
        <option value="date">Más recientes</option>
        <option value="rating">Mejor valorados</option>
      </select>
      <select value={days} onChange={e => setDays(e.target.value)} aria-label="Fecha de publicación">
        <option value="">Cualquier fecha</option>
        <option value="30">Último mes</option>
        <option value="90">Últimos 3 meses</option>
        <option value="365">Último año</option>
      </select>
      <input value={region} onChange={e => setRegion(e.target.value)} placeholder="País, ej. ES" maxLength={2} aria-label="Código de país" />
      <input value={language} onChange={e => setLanguage(e.target.value)} placeholder="Idioma, ej. es" maxLength={2} aria-label="Código de idioma" />
      <button disabled={busy}>{busy ? 'Buscando…' : 'Buscar'}</button>
    </form>
    {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    {notice && <p className="notice" role="status" style={{ marginTop: 12 }}>{notice}</p>}
    <YouTubeResults results={results} context={context} onSaved={onSaved} />
  </section>
}
