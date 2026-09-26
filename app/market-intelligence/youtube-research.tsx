'use client'

import { FormEvent, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

const fmt = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat('es-ES', { notation: n >= 10000 ? 'compact' : 'standard' }).format(n))
const fmtDuration = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)

export function YouTubeResearch({ onSaved }: { onSaved: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState('relevance')
  const [region, setRegion] = useState('')
  const [language, setLanguage] = useState('')
  const [days, setDays] = useState('')
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastQuery, setLastQuery] = useState('')

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
      setResults(rows); setLastQuery(q)
      if (rows.length === 0) setNotice('YouTube no devolvió resultados para esta búsqueda.')
      // Mark results that are already stored so they are not duplicated.
      const urls = rows.map(r => r.url)
      if (urls.length) {
        const { data } = await supabase.from('opportunities').select('source_id').eq('source_platform', 'youtube').in('source_id', urls)
        setSaved(new Set(((data ?? []) as Array<{ source_id: string }>).map(d => d.source_id)))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar YouTube.')
    } finally { setBusy(false) }
  }

  async function save(video: YouTubeVideoResult) {
    if (saved.has(video.url) || savingId) return
    setSavingId(video.videoId); setError(''); setNotice('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const { data: existing, error: lookupError } = await supabase.from('opportunities').select('id')
        .eq('owner_id', user.id).eq('source_platform', 'youtube').eq('source_id', video.url).limit(1)
      if (lookupError) throw lookupError
      if (existing?.length) { setSaved(s => new Set(s).add(video.url)); setNotice('Este vídeo ya estaba guardado en Oportunidades.'); return }
      const { error: insertError } = await supabase.from('opportunities').insert({
        owner_id: user.id,
        title: video.title.slice(0, 180) || video.url,
        source_platform: 'youtube',
        source_id: video.url,
        query: lastQuery || null,
        region: region.trim().toUpperCase() || null,
        language: language.trim().toLowerCase() || null,
        status: 'discovered',
        observed_metrics: { ...video.observed, channel_title: video.channelTitle, channel_id: video.channelId, published_at: video.publishedAt, source: 'youtube_data_api' },
        calculated_metrics: { ...video.calculated, formula: { viewsPerDay: 'views / días desde publicación', viewsToSubscribers: 'views / suscriptores del canal', engagementRate: '(likes + comentarios) / views × 100' } },
        evidence: [{ url: video.url, source: 'youtube_data_api', captured_at: video.observed.fetchedAt, note: `Canal: ${video.channelTitle}` }],
      })
      if (insertError) throw insertError
      setSaved(s => new Set(s).add(video.url))
      setNotice('Guardado en Oportunidades con las métricas observadas de la API.')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la oportunidad.')
    } finally { setSavingId('') }
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
    {results.length > 0 && <>
      <p className="authNote" style={{ marginTop: 12 }}>Observado = dato de la API en el momento de la consulta. Calculado = derivado de esos datos; no es una predicción.</p>
      <div className="grid" style={{ marginTop: 10 }}>{results.map(v => <article key={v.videoId}>
        {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" style={{ width: '100%', height: 'auto', borderRadius: 8 }} loading="lazy" />}
        <h3 style={{ marginTop: 8 }}><a href={v.url} target="_blank" rel="noopener noreferrer">{v.title}</a></h3>
        <p className="muted small">{v.channelTitle} · {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : 'sin fecha'} · {fmtDuration(v.observed.durationSeconds)}</p>
        <p className="small"><b>Observado:</b> {fmt(v.observed.views)} vistas · {fmt(v.observed.likes)} likes · {fmt(v.observed.comments)} comentarios · {fmt(v.observed.channelSubscribers)} suscriptores</p>
        <p className="small muted"><b>Calculado:</b> {fmt(v.calculated.viewsPerDay)} vistas/día · ratio vistas/suscriptores {v.calculated.viewsToSubscribers ?? '—'} · interacción {v.calculated.engagementRate ?? '—'}%</p>
        <button type="button" className={saved.has(v.url) ? 'ghost' : undefined} disabled={saved.has(v.url) || Boolean(savingId)} onClick={() => void save(v)} style={{ marginTop: 8 }}>
          {saved.has(v.url) ? 'Ya en Oportunidades' : savingId === v.videoId ? 'Guardando…' : 'Guardar como oportunidad'}
        </button>
      </article>)}</div>
    </>}
  </section>
}
