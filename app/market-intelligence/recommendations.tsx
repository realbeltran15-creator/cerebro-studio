'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { ResultFilterBar } from '../components/result-filters'
import { YouTubeResults, type YouTubeSaveContext } from '../components/youtube-results'
import { COUNTRIES, CONTINENTS, NEGLECTED, NO_FILTERS, QUOTA, applyFilters, crossRegionTerms, neglectedNiches, type Continent, type RegionChart, type ResultFilters } from '@/lib/research/discovery'
import type { YouTubeCategory, YouTubeVideoResult } from '@/lib/providers/youtube-data'

type Tab = 'top' | 'abroad' | 'niches'
const TABS: Array<[Tab, string]> = [['top', 'Más vistas ahora'], ['abroad', 'Tendencias en otros países'], ['niches', 'Nichos descuidados']]
const name = (code: string) => COUNTRIES.find(c => c.code === code)?.name ?? code

async function getJson<T>(url: string): Promise<T & { error?: string }> {
  const r = await fetch(url, { cache: 'no-store' })
  const j = await r.json() as T & { error?: string }
  if (!r.ok) throw new Error(j.error ?? 'No se pudo consultar YouTube.')
  return j
}

/** Recommendations shown as soon as Investigación opens. The first tab loads by itself (2 quota units); the rest are one click. */
export function Recommendations({ onSaved }: { onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>('top')
  const [home, setHome] = useState('ES')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<YouTubeCategory[]>([])
  const [filters, setFilters] = useState<ResultFilters>(NO_FILTERS)
  const [top, setTop] = useState<YouTubeVideoResult[] | null>(null)
  const [continent, setContinent] = useState<Continent>('europe')
  const [charts, setCharts] = useState<RegionChart[] | null>(null)
  const [topic, setTopic] = useState('')
  const [nicheLang, setNicheLang] = useState('')
  const [niches, setNiches] = useState<{ topic: string; all: YouTubeVideoResult[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)

  useEffect(() => { try { const h = localStorage.getItem('cerebro.homeRegion'); if (h && COUNTRIES.some(c => c.code === h)) setHome(h) } catch { /* private mode */ } }, [])

  const run = useCallback(async (job: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await job() } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo consultar YouTube.') } finally { setBusy(false) }
  }, [])

  const loadTop = useCallback((region: string, cat: string) => run(async () => {
    const params = new URLSearchParams({ region, snapshot: '0' }); if (cat) params.set('category', cat)
    const j = await getJson<{ results?: YouTubeVideoResult[]; configured?: boolean }>(`/api/research/trending?${params}`).catch(e => { throw e })
    setTop(j.results ?? [])
  }), [run])

  // Automatic on entering: the cheap official "most popular" chart for the home country.
  useEffect(() => {
    let cancelled = false
    void fetch(`/api/research/categories?region=${home}`).then(async r => {
      const j = await r.json() as { categories?: YouTubeCategory[]; configured?: boolean }
      if (cancelled) return
      if (j.configured === false) setNotConfigured(true)
      setCategories(j.categories ?? []); setCategory('')
    }).catch(() => setCategories([]))
    void loadTop(home, '')
    return () => { cancelled = true }
  }, [home, loadTop])

  function changeHome(code: string) { setHome(code); setTop(null); setCharts(null); try { localStorage.setItem('cerebro.homeRegion', code) } catch { /* ignore */ } }

  const abroadCountries = useMemo(() => COUNTRIES.filter(c => c.continent === continent && c.code !== home), [continent, home])
  const loadAbroad = () => run(async () => {
    const out: RegionChart[] = []
    for (const c of abroadCountries) {
      try { const j = await getJson<{ results?: YouTubeVideoResult[] }>(`/api/research/trending?region=${c.code}&snapshot=0`); out.push({ region: c.code, videos: j.results ?? [] }) }
      catch (e) { if (out.length === 0 && c === abroadCountries[0] && /cuota|clave|configurada/i.test(String(e))) throw e }
    }
    setCharts(out)
  })

  async function searchNiches(event: FormEvent) {
    event.preventDefault()
    const q = topic.trim(); if (!q || busy) return
    await run(async () => {
      const params = new URLSearchParams({ q, order: 'viewCount', days: '90', max: '25' }); if (nicheLang) params.set('lang', nicheLang)
      const j = await getJson<{ results?: YouTubeVideoResult[] }>(`/api/research/youtube?${params}`)
      setNiches({ topic: q, all: j.results ?? [] })
    })
  }

  const context = (q: string, region: string | null, origin: 'search' | 'radar'): YouTubeSaveContext => ({ query: q, region, language: null, origin })
  const topShown = useMemo(() => applyFilters(top ?? [], filters), [top, filters])
  const abroadAll = useMemo(() => (charts ?? []).flatMap(c => c.videos), [charts])
  const nicheList = useMemo(() => applyFilters(neglectedNiches(niches?.all ?? []), filters), [niches, filters])
  const world = useMemo(() => crossRegionTerms([...(top ? [{ region: home, videos: top }] : []), ...(charts ?? [])]), [top, charts, home])

  return <section className="panel" style={{ margin: '18px 0' }} aria-label="Recomendaciones">
    <h3>Recomendaciones para ti</h3>
    <p className="muted small" style={{ margin: '6px 0 12px' }}>Lo que está funcionando ahora en YouTube, separado por qué buscas. Datos observados de la API oficial; los números marcados como calculados no son una predicción de viralidad.</p>
    {notConfigured && <p className="warnBox">Las recomendaciones necesitan <code>YOUTUBE_API_KEY</code> en las variables del servidor.</p>}
    <div className="marketForm" style={{ marginBottom: 8 }}>
      <select value={home} onChange={e => changeHome(e.target.value)} aria-label="Tu país">
        {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
      {tab === 'top' && <select value={category} onChange={e => { setCategory(e.target.value); void loadTop(home, e.target.value) }} aria-label="Categoría">
        <option value="">Todas las categorías</option>{categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>}
    </div>
    <div className="legend" role="tablist" style={{ margin: '8px 0' }}>
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? undefined : 'ghost'} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <ResultFilterBar value={filters} onChange={setFilters} shown={tab === 'top' ? topShown.length : tab === 'abroad' ? applyFilters(abroadAll, filters).length : nicheList.length} total={tab === 'top' ? (top?.length ?? 0) : tab === 'abroad' ? abroadAll.length : neglectedNiches(niches?.all ?? []).length} />
    {error && <p className="error" role="alert">{error}</p>}
    {busy && <p className="muted small" role="status">Consultando YouTube…</p>}

    {tab === 'top' && <>
      <p className="muted small">Vídeos más populares ahora en {name(home)} (lista oficial). Se carga sola al entrar: {QUOTA.trending} unidades de cuota.</p>
      {top && top.length === 0 && !error && <p className="emptyState">YouTube no devolvió vídeos para esta categoría.</p>}
      {top && top.length > 0 && topShown.length === 0 && <p className="emptyState">Ningún vídeo cumple los filtros. Quita alguno.</p>}
      <YouTubeResults results={topShown} context={context(`reco:${home}${category ? `:${categories.find(c => c.id === category)?.title ?? category}` : ''}`, home, 'radar')} onSaved={onSaved} />
    </>}

    {tab === 'abroad' && <>
      <p className="muted small">Qué se ve en otros países, para detectar temas que aún no han llegado al tuyo. Cada país cuesta {QUOTA.trending} unidades.</p>
      <div className="marketForm">
        <select value={continent} onChange={e => { setContinent(e.target.value as Continent); setCharts(null) }} aria-label="Continente">
          {CONTINENTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button type="button" disabled={busy || abroadCountries.length === 0} onClick={() => void loadAbroad()}>Comparar {abroadCountries.length} países (~{abroadCountries.length * QUOTA.trending} unidades)</button>
      </div>
      {world.length > 0 && <>
        <p className="authNote">Calculado: términos que aparecen en las listas de tendencias de varios países a la vez (incluido {name(home)}). Es una señal para investigar.</p>
        <div className="legend" style={{ margin: '8px 0' }}>{world.map(t => <span key={t.term} className="pill" title={t.regions.map(name).join(', ')}>{t.term} · {t.regions.length} países</span>)}</div>
      </>}
      {charts && charts.map(c => {
        const shown = applyFilters(c.videos, filters)
        return shown.length === 0 ? null : <div key={c.region}><h3 className="sectionTitle">{name(c.region)}</h3>
          <YouTubeResults results={shown.slice(0, 6)} context={context(`reco:${c.region}`, c.region, 'radar')} onSaved={onSaved} /></div>
      })}
      {charts && abroadAll.length === 0 && !error && <p className="emptyState">YouTube no devolvió tendencias para estos países.</p>}
    </>}

    {tab === 'niches' && <>
      <p className="muted small">Busca un tema y te enseño solo los vídeos que rindieron mucho en canales pequeños: hasta {NEGLECTED.maxSubscribers.toLocaleString('es-ES')} suscriptores, al menos {NEGLECTED.minViews.toLocaleString('es-ES')} vistas y {NEGLECTED.minRatio}× más vistas que suscriptores, de los últimos 90 días. Señal de demanda con poca competencia, no una garantía. Cuesta unas {QUOTA.search} unidades por búsqueda.</p>
      <form className="marketForm" onSubmit={searchNiches}>
        <input required value={topic} onChange={e => setTopic(e.target.value)} placeholder="Tema o nicho, ej. historia medieval" maxLength={200} aria-label="Tema para buscar nichos" />
        <select value={nicheLang} onChange={e => setNicheLang(e.target.value)} aria-label="Idioma de búsqueda">
          <option value="">Cualquier idioma</option>{[['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['de', 'Alemán'], ['fr', 'Francés']].map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
        <button disabled={busy}>Buscar nichos</button>
      </form>
      {niches && niches.all.length > 0 && nicheList.length === 0 && <p className="emptyState">De {niches.all.length} vídeos de «{niches.topic}», ninguno cumple las condiciones de nicho descuidado con tus filtros. Prueba un tema más concreto.</p>}
      {niches && niches.all.length === 0 && <p className="emptyState">YouTube no devolvió resultados para «{niches.topic}».</p>}
      <YouTubeResults results={nicheList} context={context(niches?.topic ?? '', null, 'search')} onSaved={onSaved} />
    </>}
  </section>
}
