'use client'

import { useMemo, useState } from 'react'
import { YouTubeResults, type YouTubeSaveContext } from '../components/youtube-results'
import { ResultFilterBar } from '../components/result-filters'
import { RunStatus } from './analysis-views'
import { useResearch } from './research-context'
import { NO_FILTERS, applyFilters, type ResultFilters } from '@/lib/research/discovery'
import { blockers, filterVideos, forTab, mergeRegions } from '@/lib/research/filters'

/** Results of the free-text video search. The text, markets, period and format come from the filter panel; its button runs the search. */
export function YouTubeResearch({ onSaved }: { onSaved: () => void }) {
  const { filters, markets, search } = useResearch()
  const f = useMemo(() => forTab('competition', filters), [filters])
  const [quick, setQuick] = useState<ResultFilters>(NO_FILTERS)
  const merged = useMemo(() => mergeRegions(search.videos), [search.videos])
  const kept = useMemo(() => filterVideos(merged, f), [merged, f])
  const why = useMemo(() => (merged.length > 0 && kept.length === 0 ? blockers(merged, f) : []), [merged, kept, f])
  const shown = useMemo(() => applyFilters(kept, quick), [kept, quick])
  const context: YouTubeSaveContext = { query: search.ranFor?.q ?? null, region: markets[0]?.region ?? null, language: markets[0]?.language ?? null, origin: 'search' }

  return <section className="panel" style={{ margin: '0 0 18px' }} aria-label="Buscar vídeos en YouTube">
    <h3>Buscar vídeos en YouTube</h3>
    <p className="muted small" style={{ margin: '6px 0 12px' }}>Solo lectura: no conecta tu canal ni publica nada. Escribe la búsqueda arriba y pulsa «Aplicar y buscar»: se busca en <b>{markets.map(m => m.label).join(' · ')}</b> con el periodo y el formato de los filtros.</p>
    <RunStatus />
    {search.ranFor && merged.length === 0 && !search.error && <p className="emptyState">YouTube no devolvió resultados para «{search.ranFor.q}» en {search.ranFor.labels.join(', ')}.</p>}
    {merged.length > 0 && kept.length === 0 && <p className="warnBox" role="status">Los {merged.length} vídeos encontrados quedan fuera por los filtros aplicados.{why.length ? ` Quitando ${why.slice(0, 3).map(w => `${w.group} aparecerían ${w.wouldShow}`).join('; quitando ')}.` : ''}</p>}
    {kept.length > 0 && <ResultFilterBar value={quick} onChange={setQuick} shown={shown.length} total={kept.length} />}
    <YouTubeResults results={shown} context={context} onSaved={onSaved} />
  </section>
}
