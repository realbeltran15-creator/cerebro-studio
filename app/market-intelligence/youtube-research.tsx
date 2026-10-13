'use client'

import { FormEvent, useMemo, useState } from 'react'
import { YouTubeResults, type YouTubeSaveContext } from '../components/youtube-results'
import { ResultFilterBar } from '../components/result-filters'
import { useResearch } from './research-context'
import { NO_FILTERS, applyFilters, type ResultFilters } from '@/lib/research/discovery'
import { UNITS, durationParam, filterVideos, forTab, mergeRegions, planSearchBatch } from '@/lib/research/filters'
import { fmtNumber } from '@/lib/research/format'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

/** Free-text video search in every applied market. The country, language, period and format come from the shared filters, not from separate boxes. */
export function YouTubeResearch({ onSaved }: { onSaved: () => void }) {
  const { filters, markets, usage, dirty, refreshUsage } = useResearch()
  const f = useMemo(() => forTab('competition', filters), [filters])
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState('relevance')
  const [charts, setCharts] = useState<Array<{ region: string; videos: YouTubeVideoResult[] }>>([])
  const [ranFor, setRanFor] = useState<{ q: string; labels: string[] } | null>(null)
  const [quick, setQuick] = useState<ResultFilters>(NO_FILTERS)
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const plan = planSearchBatch({ markets: query.trim() ? markets.length : 0, remainingToday: usage?.remaining ?? 6000 })
  const merged = useMemo(() => mergeRegions(charts), [charts])
  const kept = useMemo(() => filterVideos(merged, f), [merged, f])
  const shown = useMemo(() => applyFilters(kept, quick), [kept, quick])
  const context: YouTubeSaveContext = { query: ranFor?.q ?? null, region: markets[0]?.region ?? null, language: markets[0]?.language ?? null, origin: 'search' }

  async function search(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    if (!q || busy || plan.level === 'blocked' || (plan.level === 'confirm' && !ok)) return
    setBusy(true); setError(''); setDone(''); setOk(false)
    const out: Array<{ region: string; videos: YouTubeVideoResult[] }> = []
    const failed: string[] = []
    for (const m of markets) {
      try {
        const params = new URLSearchParams({ q, order, max: '25' })
        if (m.region) params.set('region', m.region)
        if (m.language) params.set('lang', m.language)
        if (f.periodDays) params.set('days', String(f.periodDays))
        const d = durationParam(f.formats); if (d) params.set('duration', d)
        const response = await fetch(`/api/research/youtube?${params}`, { cache: 'no-store' })
        const json = await response.json() as { results?: YouTubeVideoResult[]; error?: string }
        if (!response.ok) { failed.push(`${m.label}: ${json.error ?? 'error'}`); if (response.status === 503) break; continue }
        out.push({ region: m.region ?? m.label, videos: json.results ?? [] })
      } catch (e) { failed.push(`${m.label}: ${e instanceof Error ? e.message : 'error'}`) }
    }
    setCharts(out); setRanFor({ q, labels: markets.map(m => m.label) }); setBusy(false); void refreshUsage()
    if (failed.length) setError(`falló en ${failed.length} mercado${failed.length === 1 ? '' : 's'} — ${failed.slice(0, 2).join(' · ')}`)
    else setDone(`Resultados actualizados: ${out.reduce((t, c) => t + c.videos.length, 0)} vídeos de ${out.length} mercado${out.length === 1 ? '' : 's'}.`)
  }

  return <section className="panel" style={{ margin: '0 0 18px' }} aria-label="Buscar vídeos en YouTube">
    <h3>Buscar vídeos en YouTube</h3>
    <p className="muted small" style={{ margin: '6px 0 12px' }}>Solo lectura: no conecta tu canal ni publica nada. Se busca en <b>{markets.map(m => m.label).join(' · ')}</b> con el periodo y formato de los filtros aplicados{dirty ? ' (tienes cambios sin aplicar: se usan los aplicados)' : ''}.</p>
    <form className="marketForm" onSubmit={search}>
      <input required value={query} onChange={e => setQuery(e.target.value)} placeholder="Tema, historia o formato" maxLength={200} aria-label="Búsqueda en YouTube" />
      <select value={order} onChange={e => setOrder(e.target.value)} aria-label="Orden">
        <option value="relevance">Relevancia</option><option value="viewCount">Más vistas</option><option value="date">Más recientes</option><option value="rating">Mejor valorados</option>
      </select>
      <button disabled={busy || !query.trim() || plan.level === 'blocked' || (plan.level === 'confirm' && !ok)}>{busy ? 'Buscando…' : `Buscar (${fmtNumber(plan.units || UNITS.search * markets.length)} unidades)`}</button>
    </form>
    <p className="small" style={{ marginTop: 8 }}><b>Coste previsto:</b> {plan.message}</p>
    {plan.level === 'confirm' && <label className="msOpt"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> Entiendo que esto gastará {fmtNumber(plan.units)} unidades de cuota</label>}
    {busy && <p className="muted small" role="status">Consultando YouTube…</p>}
    {error && <p className="error" role="alert">Consulta fallida: {error}</p>}
    {done && <p className="notice" role="status">{done}</p>}
    {ranFor && merged.length === 0 && !error && <p className="emptyState">YouTube no devolvió resultados para «{ranFor.q}» en {ranFor.labels.join(', ')}.</p>}
    {merged.length > 0 && kept.length === 0 && <p className="warnBox" role="status">Los {merged.length} vídeos encontrados quedan fuera por los filtros de formato, periodo o idioma. Quita alguno para verlos.</p>}
    {kept.length > 0 && <ResultFilterBar value={quick} onChange={setQuick} shown={shown.length} total={kept.length} />}
    <YouTubeResults results={shown} context={context} onSaved={onSaved} />
  </section>
}
