'use client'

import { useMemo, useState } from 'react'
import { sampleCsv } from '@/lib/research/export'
import { fmtNumber } from '@/lib/research/format'
import type { SampleVideo, TopicAnalysis } from '@/lib/research/topic-analysis'

const STATUS = { aceptado: 'Aceptado', dudoso: 'Dudoso', descartado: 'Descartado' } as const
const REASON: Record<string, string> = { tema: 'Otro tema', nicho: 'Otro tema (nicho distinto)', sentido: 'Otro significado de la palabra', idioma: 'Otro idioma', directo: 'Directo', contexto: 'Sin pruebas del significado buscado' }
const FILTERS = [['todos', 'Todos'], ['aceptado', 'Aceptados'], ['dudoso', 'Dudosos'], ['descartado', 'Descartados']] as const
const WHICH = (v: SampleVideo) => (v.inTop && v.inRecent ? 'Más vistos y recientes' : v.inTop ? 'Más vistos del año' : 'Recientes')

/** Every video the search returned, with its verdict and the reason, links included: the engine's judgement can be checked by hand. */
export function SampleInspector({ a }: { a: TopicAnalysis }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('todos')
  const sample = a.sample ?? []
  const counts = useMemo(() => ({ aceptado: sample.filter(v => v.status === 'aceptado').length, dudoso: sample.filter(v => v.status === 'dudoso').length, descartado: sample.filter(v => v.status === 'descartado').length }), [sample])
  const shown = filter === 'todos' ? sample : sample.filter(v => v.status === filter)
  if (!sample.length) return <p className="muted small">Este análisis no guardó el detalle de la muestra (se hizo con una versión anterior o el navegador no tenía espacio). Repite la consulta para verla.</p>
  const download = () => { const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([sampleCsv(a)], { type: 'text/csv;charset=utf-8' })); el.download = `muestra-${a.topic.replace(/\W+/g, '-').toLowerCase().slice(0, 40)}.csv`; el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 1000) }
  return <details className="small" style={{ marginTop: 8 }}>
    <summary>Muestra: {sample.length} vídeos examinados ({counts.aceptado} aceptados · {counts.dudoso} dudosos · {counts.descartado} descartados)</summary>
    {a.quality.ambiguousSample && <p className="notice" role="note">La consulta tiene varios significados: solo cuentan los vídeos que confirman el sentido buscado. Los «dudosos» no se han dado por erróneos, pero no entran en las métricas.</p>}
    <div className="campaignBar" role="group" aria-label="Filtrar la muestra" style={{ margin: '8px 0' }}>
      {FILTERS.map(([id, label]) => <button key={id} type="button" className={`chip${filter === id ? ' active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}{id !== 'todos' ? ` (${counts[id]})` : ` (${sample.length})`}</button>)}
      <button type="button" className="ghost" onClick={download}>Descargar muestra (.csv)</button>
    </div>
    <div style={{ overflowX: 'auto' }}>
      <table className="dataTable" aria-label={`Muestra de ${a.topic}`}>
        <thead><tr><th>Estado</th><th>Vídeo</th><th>Canal</th><th>Vistas</th><th>Muestra</th><th>Motivo</th></tr></thead>
        <tbody>{shown.map(v => <tr key={v.videoId}>
          <td><span className={`pill ${v.status === 'aceptado' ? 'ok' : v.status === 'dudoso' ? 'warn' : 'bad'}`}>{STATUS[v.status]}</span></td>
          <td><a className="open" href={v.url} target="_blank" rel="noreferrer">{v.title || '(sin título)'}</a>{(v.promo || v.outlier) && <div className="muted">{v.promo ? 'Posible anuncio (fuera de la demanda). ' : ''}{v.outlier ? 'Viral atípico (fuera de la demanda).' : ''}</div>}</td>
          <td>{v.channelTitle}</td><td>{v.views === null ? '—' : fmtNumber(v.views)}</td><td>{WHICH(v)}</td>
          <td>{v.reason ? <><b>{REASON[v.reason]}</b><div className="muted">{v.detail}</div></> : <span className="muted">Cuenta en las métricas{v.detail ? `: ${v.detail}` : ''}{v.languageVerdict === 'sin_verificar' ? ' · idioma sin verificar' : ''}</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>
}
