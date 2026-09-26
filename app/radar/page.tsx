'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { YouTubeResults } from '../components/youtube-results'
import { recurringTerms } from '@/lib/radar'
import type { YouTubeCategory, YouTubeVideoResult } from '@/lib/providers/youtube-data'

const regions = [['ES', 'España'], ['MX', 'México'], ['AR', 'Argentina'], ['CO', 'Colombia'], ['CL', 'Chile'], ['PE', 'Perú'], ['US', 'Estados Unidos'], ['GB', 'Reino Unido'], ['DE', 'Alemania'], ['FR', 'Francia'], ['IT', 'Italia'], ['PT', 'Portugal'], ['BR', 'Brasil']] as const

export default function RadarPage() {
  const [region, setRegion] = useState('ES')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<YouTubeCategory[]>([])
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [loadedFor, setLoadedFor] = useState<{ region: string; category: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)

  useEffect(() => {
    setCategory('')
    void fetch(`/api/research/categories?region=${region}`)
      .then(async r => {
        const json = await r.json() as { categories?: YouTubeCategory[]; configured?: boolean }
        if (json.configured === false) setNotConfigured(true)
        setCategories(json.categories ?? [])
      })
      .catch(() => setCategories([]))
  }, [region])

  async function load() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const params = new URLSearchParams({ region })
      if (category) params.set('category', category)
      const response = await fetch(`/api/research/trending?${params}`, { cache: 'no-store' })
      const json = await response.json() as { results?: YouTubeVideoResult[]; error?: string; configured?: boolean }
      if (json.configured === false) setNotConfigured(true)
      if (!response.ok) throw new Error(json.error ?? 'No se pudo consultar YouTube.')
      setResults(json.results ?? [])
      setLoadedFor({ region, category })
    } catch (e) {
      setResults([]); setError(e instanceof Error ? e.message : 'No se pudo consultar YouTube.')
    } finally { setBusy(false) }
  }

  const terms = useMemo(() => recurringTerms(results.map(r => r.title)), [results])
  const categoryName = (id: string) => categories.find(c => c.id === id)?.title ?? 'todas las categorías'

  return <StudioShell title="Radar de tendencias" eyebrow="INTELIGENCIA DE MERCADO" actions={<Link className="buttonLink ghost" href="/market-intelligence">Buscar un tema</Link>}>
    {notConfigured && <p className="warnBox">El Radar necesita <code>YOUTUBE_API_KEY</code> en las variables del servidor.</p>}
    <section className="panel" style={{ marginBottom: 18 }}>
      <p className="muted small" style={{ marginBottom: 12 }}>Vídeos más populares ahora mismo según YouTube (lista oficial por país y categoría). Solo lectura. Cada consulta consume unas 2 unidades de cuota.</p>
      <div className="marketForm">
        <select value={region} onChange={e => setRegion(e.target.value)} aria-label="País">
          {regions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button type="button" onClick={() => void load()} disabled={busy}>{busy ? 'Consultando…' : 'Ver tendencias'}</button>
      </div>
      {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    </section>

    {loadedFor && results.length > 0 && <>
      <h3 className="sectionTitle">Términos recurrentes · {regions.find(r => r[0] === loadedFor.region)?.[1]} · {categoryName(loadedFor.category)}</h3>
      <p className="authNote">Calculado: cuántos de los {results.length} títulos en tendencia mencionan cada término. Es una señal para investigar, no una predicción.</p>
      {terms.length === 0 ? <p className="muted small">Ningún término se repite en dos o más títulos.</p> : (
        <div className="legend" style={{ margin: '10px 0 6px' }}>
          {terms.map(t => <Link key={t.term} className="pill" href={`/market-intelligence?q=${encodeURIComponent(t.term)}`} title="Investigar este término">{t.term} · {t.titles}</Link>)}
        </div>
      )}
      <h3 className="sectionTitle">Vídeos en tendencia</h3>
    </>}
    {loadedFor && results.length === 0 && !error && <p className="emptyState">YouTube no devolvió vídeos en tendencia para esta combinación.</p>}
    <YouTubeResults results={results} context={{ query: `radar:${loadedFor?.region ?? region}${loadedFor?.category ? `:${categoryName(loadedFor.category)}` : ''}`, region: loadedFor?.region ?? region, language: null, origin: 'radar' }} />
  </StudioShell>
}
