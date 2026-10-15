'use client'

import { useMemo, useState } from 'react'
import { YouTubeResults, type YouTubeSaveContext } from '../components/youtube-results'
import { RunStatus } from './analysis-views'
import { useResearch } from './research-context'
import { SORTS, sortVideos, type SortKey } from '@/lib/research/discovery'
import { blockers, filterVideos, forTab, mergeRegions } from '@/lib/research/filters'

/** Results of the free-text video search. The text, markets, period and format come from the filter panel; its button runs the search. */
export function YouTubeResearch({ onSaved }: { onSaved: () => void }) {
  const { filters, markets, search } = useResearch()
  const f = useMemo(() => forTab('competition', filters), [filters])
  const [sort, setSort] = useState<SortKey>('api')
  const merged = useMemo(() => mergeRegions(search.videos), [search.videos])
  const kept = useMemo(() => filterVideos(merged, f), [merged, f])
  const why = useMemo(() => (merged.length > 0 && kept.length === 0 ? blockers(merged, f) : []), [merged, kept, f])
  const shown = useMemo(() => sortVideos(kept, sort), [kept, sort])
  const context: YouTubeSaveContext = { query: search.ranFor?.q ?? null, region: markets[0]?.region ?? null, language: markets[0]?.language ?? null, origin: 'search' }

  return <section className="panel" style={{ margin: '0 0 18px' }} aria-label="Buscar vídeos en YouTube">
    <h3>Buscar vídeos en YouTube</h3>
    <p className="muted small" style={{ margin: '6px 0 12px' }}>Solo lectura: no conecta tu canal ni publica nada. Escribe la búsqueda arriba y pulsa «Aplicar y buscar»: se busca en <b>{markets.map(m => m.label).join(' · ')}</b> con el periodo y el formato de los filtros.</p>
    <RunStatus />
    {search.ranFor && merged.length === 0 && !search.error && <p className="emptyState">YouTube no devolvió resultados para «{search.ranFor.q}» en {search.ranFor.labels.join(', ')}.</p>}
    {merged.length > 0 && kept.length === 0 && <p className="warnBox" role="status">Los {merged.length} vídeos encontrados quedan fuera por los filtros aplicados.{why.length ? ` Quitando ${why.slice(0, 3).map(w => `${w.group} aparecerían ${w.wouldShow}`).join('; quitando ')}.` : ''}</p>}
    {kept.length > 0 && <div className="campaignBar" style={{ margin: '10px 0' }}>
      <label className="muted small" htmlFor="video-sort">Ordenar por</label>
      <select id="video-sort" value={sort} onChange={e => setSort(e.target.value as SortKey)}>{SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <span className="muted small">Mostrando {shown.length} de {merged.length} vídeos. Los filtros son los del panel de arriba; ordenar no gasta cuota.</span>
    </div>}
    <YouTubeResults results={shown} context={context} onSaved={onSaved} />
  </section>
}
