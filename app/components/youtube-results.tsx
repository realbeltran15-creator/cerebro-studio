'use client'

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

const fmt = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat('es-ES', { notation: n >= 10000 ? 'compact' : 'standard' }).format(n))
const fmtDuration = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)

export type YouTubeSaveContext = { query: string | null; region: string | null; language: string | null; origin: 'search' | 'radar' }

/** Result cards with observed/calculated metrics and duplicate-safe saving to Oportunidades. */
export function YouTubeResults({ results, context, onSaved }: { results: YouTubeVideoResult[]; context: YouTubeSaveContext; onSaved?: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Mark results that are already stored so they are not duplicated.
  useEffect(() => {
    const urls = results.map(r => r.url)
    if (urls.length === 0) { setSaved(new Set()); return }
    void supabase.from('opportunities').select('source_id').eq('source_platform', 'youtube').in('source_id', urls)
      .then(({ data }: { data: unknown }) => setSaved(new Set(((data ?? []) as Array<{ source_id: string }>).map(d => d.source_id))))
  }, [results, supabase])

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
        query: context.query,
        region: context.region,
        language: context.language,
        status: 'discovered',
        observed_metrics: { ...video.observed, channel_title: video.channelTitle, channel_id: video.channelId, published_at: video.publishedAt, source: 'youtube_data_api', origin: context.origin },
        calculated_metrics: { ...video.calculated, formula: { viewsPerDay: 'views / días desde publicación', viewsToSubscribers: 'views / suscriptores del canal', engagementRate: '(likes + comentarios) / views × 100' } },
        evidence: [{ url: video.url, source: 'youtube_data_api', captured_at: video.observed.fetchedAt, note: `Canal: ${video.channelTitle}${context.origin === 'radar' ? ' · detectado en Radar (tendencias)' : ''}` }],
      })
      if (insertError) throw insertError
      setSaved(s => new Set(s).add(video.url))
      setNotice('Guardado en Oportunidades con las métricas observadas de la API.')
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la oportunidad.')
    } finally { setSavingId('') }
  }

  if (results.length === 0) return null
  return <>
    {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    {notice && <p className="notice" role="status" style={{ marginTop: 12 }}>{notice}</p>}
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
  </>
}
