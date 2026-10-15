'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { VERDICT } from './analysis-views'
import type { NicheReco, Reco, RecoSection, RecoVideo } from '@/lib/research/recommendations'
import { fmtCompact, fmtNumber } from '@/lib/research/format'
import { isUniqueViolation } from '@/lib/opportunities'

const FORMAT_NAME = { short: 'Short probable', brief: 'Corto', medium: 'Medio', long: 'Largo', live: 'Directo', unknown: 'Formato desconocido' } as const
const dateEs = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : 'sin fecha')
const duration = (s: number | null) => (s === null ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)

/** One real YouTube video with its official thumbnail and the facts the API gave. Clicking opens it on YouTube. */
export function VideoTile({ v, reason }: { v: RecoVideo; reason?: string }) {
  return <figure className="videoTile" aria-label={`Vídeo: ${v.title}`}>
    <a href={v.url} target="_blank" rel="noopener noreferrer" className="thumb" aria-label={`Abrir en YouTube: ${v.title}`}>
      {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" loading="lazy" width={320} height={180} /> : <span className="thumbMissing">Sin miniatura</span>}
      {v.durationSeconds !== null && <span className="thumbDur">{duration(v.durationSeconds)}</span>}
    </a>
    <figcaption>
      <a href={v.url} target="_blank" rel="noopener noreferrer"><b>{v.title}</b></a>
      <span className="muted small">{v.channelTitle}{v.subscribers !== null ? ` · ${fmtCompact(v.subscribers)} suscriptores` : ''}</span>
      <span className="muted small">{v.views !== null ? `${fmtNumber(v.views)} visualizaciones` : 'visualizaciones desconocidas'} · {dateEs(v.publishedAt)}</span>
      <span className="muted small">{v.market}{v.language ? ` · ${v.language}` : ''} · {FORMAT_NAME[v.format.format]} <span className="tag inferido" title={v.format.reason}>inferido</span></span>
      {reason && <span className="small">{reason}</span>}
    </figcaption>
  </figure>
}

function SaveNiche({ r }: { r: NicheReco }) {
  const supabase = getSupabaseBrowserClient()
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  async function save() {
    setState('saving')
    try {
      const { data: { user } } = await supabase.auth.getUser(); if (!user) throw new Error('sesión')
      const sourceId = `reco:${r.key}`
      const { data: ex } = await supabase.from('opportunities').select('id').eq('owner_id', user.id).eq('source_platform', 'research').eq('source_id', sourceId).limit(1)
      if (!ex?.length) {
        const { error } = await supabase.from('opportunities').insert({ owner_id: user.id, title: r.topic.slice(0, 180), source_platform: 'research', source_id: sourceId, query: r.topic, status: 'discovered', observed_metrics: { market: r.market, updatedAt: r.updatedAt, source: 'youtube_data_api' }, calculated_metrics: { indices: r.indices, verdict: r.verdict, reason: r.reason, rpmNote: r.rpmNote }, evidence: r.videos.map(v => ({ url: v.url, source: 'youtube_data_api', captured_at: v.fetchedAt, note: `${v.title} · ${v.channelTitle}` })) })
        if (error && !isUniqueViolation(error)) throw error
      }
      setState('saved')
    } catch { setState('error') }
  }
  return <button type="button" className={state === 'saved' ? 'ghost' : undefined} disabled={state === 'saving' || state === 'saved'} onClick={() => void save()}>{state === 'saved' ? 'Guardada' : state === 'saving' ? 'Guardando…' : state === 'error' ? 'No se pudo guardar: reintentar' : 'Guardar para investigar'}</button>
}

export function RecoCard({ r }: { r: Reco }) {
  if (r.kind === 'video') return <article className="recoCard" aria-label={`Recomendación: ${r.video.title}`}><VideoTile v={r.video} reason={r.reason} /></article>
  const v = r.verdict ? VERDICT[r.verdict] : null
  return <article className="recoCard" aria-label={`Recomendación de nicho: ${r.topic}`}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <h4>{r.topic}</h4>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className="pill">{r.market}</span>{v ? <span className={`pill ${v.cls}`}>{v.label}</span> : <span className="pill">Lista oficial</span>}</span>
    </div>
    {r.indices && <p className="small muted">Demanda {r.indices.demand} · Oferta {r.indices.supply} · Competencia {r.indices.competition} · Crecimiento {r.indices.growth} · Oportunidad {r.indices.opportunity} <span className="tag calculado">calculado</span></p>}
    <p className="small"><b>Por qué:</b> {r.reason}</p>
    {r.rpmNote && <p className="small"><span className="tag estimado">ESTIMADO</span> {r.rpmNote}</p>}
    {r.videos.length > 0 ? <div className="tileRow">{r.videos.map(v => <VideoTile key={v.videoId} v={v} />)}</div> : <p className="muted small">{r.examplesElsewhere ? 'Sus vídeos de ejemplo ya aparecen en otra recomendación (cada vídeo se muestra una sola vez).' : 'Sin vídeos de ejemplo disponibles (no hay muestra guardada de este análisis).'}</p>}
    <p className="muted small">Actualizado {dateEs(r.updatedAt)} · fuente YouTube Data API{r.confidence ? ` · confianza ${r.confidence}` : ''}</p>
    {r.source === 'analysis' && <SaveNiche r={r} />}
  </article>
}

export function RecoSectionView({ s, children }: { s: RecoSection; children?: React.ReactNode }) {
  return <details open className="panel recoSection" aria-label={s.title} style={{ marginBottom: 12 }}>
    <summary><b>{s.title}</b> <span className="muted small">({s.items.length})</span></summary>
    <p className="muted small" style={{ margin: '6px 0 10px' }}>{s.blurb}</p>
    {children}
    {s.items.length === 0 ? <p className="muted small">{s.empty}</p> : <div className="recoGrid">{s.items.map(i => <RecoCard key={i.key} r={i} />)}</div>}
  </details>
}
