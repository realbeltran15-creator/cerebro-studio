'use client'

import { FormEvent, useState } from 'react'
import { YouTubeResults } from '../components/youtube-results'
import type { ChannelAnalysis } from '@/lib/providers/youtube-data'

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('es-ES', { notation: n >= 100000 ? 'compact' : 'standard' }))

/** Channel research: stats and latest uploads, with outliers against the channel's own median. */
export function ChannelResearch({ onSaved }: { onSaved: () => void }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState<ChannelAnalysis | null>(null)

  async function analyze(e: FormEvent) {
    e.preventDefault()
    if (!input.trim() || busy) return
    setBusy(true); setError('')
    try {
      const r = await fetch(`/api/research/channel?q=${encodeURIComponent(input.trim())}`, { cache: 'no-store' })
      const json = await r.json() as { analysis?: ChannelAnalysis; error?: string }
      if (!r.ok || !json.analysis) throw new Error(json.error ?? 'No se pudo analizar el canal.')
      setAnalysis(json.analysis)
    } catch (err) { setAnalysis(null); setError(err instanceof Error ? err.message : 'No se pudo analizar el canal.') } finally { setBusy(false) }
  }

  const outliers = new Set(analysis?.calculated.outlierIds ?? [])
  const median = analysis?.calculated.medianViews ?? null

  return <section className="panel" style={{ margin: '18px 0' }}>
    <h3>Analizar un canal</h3>
    <p className="muted small" style={{ margin: '6px 0 12px' }}>Estadísticas del canal y sus últimos 25 vídeos. Los vídeos con al menos el doble de vistas que la mediana del propio canal se marcan como destacados. Unas 4 unidades de cuota.</p>
    <form className="marketForm" onSubmit={analyze}>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="URL del canal, @handle o id UC…" maxLength={300} aria-label="Canal de YouTube" required />
      <button disabled={busy}>{busy ? 'Analizando…' : 'Analizar canal'}</button>
    </form>
    {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    {analysis && <>
      <div className="listItem" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {analysis.channel.thumbnailUrl && <img src={analysis.channel.thumbnailUrl} alt="" width={48} height={48} style={{ borderRadius: '50%' }} />}
          <div>
            <a href={analysis.channel.url} target="_blank" rel="noopener noreferrer"><b>{analysis.channel.title}</b></a>
            <span className="muted small" style={{ display: 'block' }}>{analysis.channel.handle ?? ''}{analysis.channel.country ? ` · ${analysis.channel.country}` : ''}</span>
          </div>
        </div>
      </div>
      <div className="kpis" style={{ marginTop: 10 }}>
        <div className="kpi"><small>Suscriptores</small><b>{fmt(analysis.observed.subscribers)}</b></div>
        <div className="kpi"><small>Vistas totales</small><b>{fmt(analysis.observed.totalViews)}</b></div>
        <div className="kpi"><small>Vídeos</small><b>{fmt(analysis.observed.videoCount)}</b></div>
        <div className="kpi"><small>Mediana (últimos {analysis.calculated.sampleSize})</small><b>{fmt(median)}</b></div>
        <div className="kpi"><small>Media (últimos {analysis.calculated.sampleSize})</small><b>{fmt(analysis.calculated.avgViews)}</b></div>
        <div className="kpi"><small>Subidas/semana</small><b>{analysis.calculated.uploadsPerWeek ?? '—'}</b></div>
      </div>
      <p className="authNote" style={{ marginTop: 8 }}>Suscriptores, vistas y número de vídeos son observados; mediana, media, frecuencia y destacados se calculan sobre la muestra.</p>
      <YouTubeResults
        results={analysis.videos}
        context={{ query: `canal:${analysis.channel.title}`.slice(0, 200), region: analysis.channel.country, language: null, origin: 'search' }}
        onSaved={onSaved}
        extra={v => outliers.has(v.videoId) && median ? <span className="pill ok">Destacado · {Math.round(((v.observed.views ?? 0) / median) * 10) / 10}× la mediana</span> : null}
      />
    </>}
  </section>
}
