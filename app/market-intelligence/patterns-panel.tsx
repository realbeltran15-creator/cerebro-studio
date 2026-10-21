'use client'

import { useMemo } from 'react'
import { analysePatterns, analysisReportMarkdown } from '@/lib/research/patterns'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'

/** Title, duration and weekday patterns of a saved analysis (calculated from its sample, no new query) and the full report download. */
export function PatternsPanel({ a }: { a: TopicAnalysis }) {
  const p = useMemo(() => analysePatterns(a), [a])
  const download = () => {
    const url = URL.createObjectURL(new Blob([analysisReportMarkdown(a, p)], { type: 'text/markdown;charset=utf-8' }))
    const l = document.createElement('a'); l.href = url; l.download = `informe-${a.topic.replace(/\W+/g, '-').toLowerCase().slice(0, 40)}.md`; l.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <details style={{ marginTop: 14 }} open>
    <summary><b>Patrones de títulos, duración y día</b> <span className="tag calculado">calculado</span></summary>
    <p className="muted small">Sobre {p.base} vídeos aceptados de la muestra guardada (sin consultas nuevas). Mediana general: {p.medianVpd ?? '—'} vistas/día. Describe lo que pasó en esta muestra; no demuestra que un rasgo cause más vistas. Grupos de menos de 4 vídeos se marcan como muestra pequeña.</p>
    {p.summary.length > 0 && <ul className="small" style={{ marginLeft: 16 }}>{p.summary.map(s => <li key={s}>{s}</li>)}</ul>}
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', marginTop: 8 }}>
      <article><h3>Rasgos del título</h3><table className="dataTable" aria-label="Rasgos del título"><thead><tr><th>Rasgo</th><th>Vídeos</th><th>Mediana</th><th>Relación</th></tr></thead><tbody>
        {p.titles.map(t => <tr key={t.id}><td>{t.label}</td><td>{t.count}</td><td>{t.medianVpd ?? '—'}</td><td>{t.lift !== null ? <span className={t.lift >= 1.5 ? 'pill ok' : t.lift <= 0.67 ? 'pill warn' : 'pill'}>{t.lift}×</span> : <span className="muted small">{t.small ? 'muestra pequeña' : '—'}</span>}</td></tr>)}
      </tbody></table><p className="muted small">Relación = mediana de vistas/día con el rasgo ÷ sin él.</p></article>
      <article><h3>Duración</h3><table className="dataTable" aria-label="Duración"><thead><tr><th>Duración</th><th>Vídeos</th><th>Mediana vistas/día</th></tr></thead><tbody>
        {p.durations.map(d => <tr key={d.label}><td>{d.label}</td><td>{d.count}</td><td>{d.medianVpd ?? '—'}{d.small && d.count > 0 ? <span className="muted small"> (pequeña)</span> : null}</td></tr>)}
      </tbody></table></article>
      <article><h3>Día de publicación (UTC)</h3><table className="dataTable" aria-label="Día de publicación"><thead><tr><th>Día</th><th>Vídeos</th><th>Mediana vistas/día</th></tr></thead><tbody>
        {p.weekdays.map(d => <tr key={d.label}><td>{d.label}</td><td>{d.count}</td><td>{d.medianVpd ?? '—'}{d.small && d.count > 0 ? <span className="muted small"> (pequeña)</span> : null}</td></tr>)}
      </tbody></table></article>
    </div>
    <button type="button" className="ghost" onClick={download} style={{ marginTop: 10 }}>Descargar informe completo (Markdown)</button>
  </details>
}
