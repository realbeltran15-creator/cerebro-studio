'use client'

import Link from 'next/link'
import { useState } from 'react'
import { campaignLink } from '@/lib/campaigns/link'
import { saveAnalysis } from '@/lib/research/save'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { VERDICT } from './analysis-views'
import { recoBrief, type NicheReco, type Reco, type RecoSection, type RecoVideo } from '@/lib/research/recommendations'
import { fmtCompact, fmtNumber } from '@/lib/research/format'

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

/** Saves the FULL analysis (same record and same id as the Nichos card, so saving from both places never duplicates). */
function SaveNiche({ r }: { r: NicheReco }) {
  const supabase = getSupabaseBrowserClient()
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'exists' | 'error'>('idle')
  async function save() {
    if (!r.analysis) return
    setState('saving')
    try { setState(await saveAnalysis(supabase as never, r.analysis)) } catch { setState('error') }
  }
  const done = state === 'saved' || state === 'exists'
  return <button type="button" className={done ? 'ghost' : undefined} disabled={state === 'saving' || done || !r.analysis} onClick={() => void save()}>{state === 'saved' ? 'Guardada con todos sus datos' : state === 'exists' ? 'Ya estaba guardada' : state === 'saving' ? 'Guardando…' : state === 'error' ? 'No se pudo guardar: reintentar' : 'Guardar para investigar después'}</button>
}

function RecoBriefView({ a }: { a: NonNullable<NicheReco['analysis']> }) {
  const b = recoBrief(a)
  return <details className="small" style={{ margin: '6px 0' }}><summary>Ficha: ¿merece la pena?</summary>
    <dl style={{ margin: '6px 0 0', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 10px' }}>
      <dt><b>Demanda</b></dt><dd style={{ margin: 0 }}>{b.demand}</dd>
      <dt><b>Competencia</b></dt><dd style={{ margin: 0 }}>{b.competition}</dd>
      <dt><b>Por qué</b></dt><dd style={{ margin: 0 }}>{b.why}</dd>
      <dt><b>Datos</b></dt><dd style={{ margin: 0 }}>{b.data.join(' · ')}</dd>
      <dt><b>Incertidumbre</b></dt><dd style={{ margin: 0 }}>{b.uncertainty}</dd>
      <dt><b>Tipo de canal</b></dt><dd style={{ margin: 0 }}>{b.channelType}</dd>
      <dt><b>Formato</b></dt><dd style={{ margin: 0 }}>{b.formats}</dd>
      <dt><b>Siguiente paso</b></dt><dd style={{ margin: 0 }}>{b.nextStep}</dd>
    </dl></details>
}

export function RecoCard({ r }: { r: Reco }) {
  if (r.kind === 'video') return <article className="recoCard" aria-label={`Recomendación: ${r.video.title}`}><VideoTile v={r.video} reason={r.reason} /></article>
  const v = r.verdict ? VERDICT[r.verdict] : null
  return <article className="recoCard" aria-label={`Recomendación de nicho: ${r.topic}`}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <h4>{r.topic}</h4>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className="pill">{r.market}</span>{v ? <span className={`pill ${v.cls}`}>{v.label}</span> : <span className="pill">Lista oficial</span>}</span>
    </div>
    {r.indices && <p className="small muted">Demanda {r.indices.demand} · Oferta {r.indices.supply} · Competencia {r.indices.competition} · Crecimiento {r.indices.growth ?? 'No calculable'} · Oportunidad {r.indices.opportunity} <span className="tag calculado">calculado</span></p>}
    <p className="small"><b>Por qué:</b> {r.reason}</p>
    {r.rpmNote && <p className="small"><span className="tag estimado">ESTIMADO</span> {r.rpmNote}</p>}
    {r.videos.length > 0 ? <div className="tileRow">{r.videos.map(v => <VideoTile key={v.videoId} v={v} />)}</div> : <p className="muted small">{r.examplesElsewhere ? 'Sus vídeos de ejemplo ya aparecen en otra recomendación (cada vídeo se muestra una sola vez).' : 'Sin vídeos de ejemplo disponibles (no hay muestra guardada de este análisis).'}</p>}
    {r.analysis && <RecoBriefView a={r.analysis} />}
    <p className="muted small">Actualizado {dateEs(r.updatedAt)} · fuente YouTube Data API{r.confidence ? ` · confianza ${r.confidence}` : ''}</p>
    {r.source === 'analysis' && <SaveNiche r={r} />}{r.analysis && <>{' '}<Link className="open" href={campaignLink({ topic: r.analysis.topic, region: r.analysis.region, language: r.analysis.language, verdict: r.analysis.verdict, demand: r.analysis.indices.demand, competition: r.analysis.indices.competition, opportunity: r.analysis.indices.opportunity, fetchedAt: r.analysis.fetchedAt })}>Planificar campaña</Link></>}
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
