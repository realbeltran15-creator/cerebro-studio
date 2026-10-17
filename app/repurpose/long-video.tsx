'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { extractShortCandidates, shortComposition, type ShortCandidate, type TranscriptSegment } from '@/lib/shorts/extract'

type Asset = { id: string; asset_type: string; provenance: Record<string, unknown> | null; created_at: string }
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`
const titleOf = (a: Asset) => String(a.provenance?.title ?? a.provenance?.originalFilename ?? a.provenance?.originalPrompt ?? a.id).slice(0, 70)

/**
 * «Desde un vídeo largo»: proposes Short-sized moments of a long video from its transcript (heuristic, free, explained) and turns the chosen one
 * into a 9:16 draft montage that opens in the manual editor. Nothing is rendered or published here.
 */
export function LongVideoShorts({ projectId }: { projectId: string }) {
  const supabase = getSupabaseBrowserClient()
  const [videos, setVideos] = useState<Asset[]>([])
  const [subs, setSubs] = useState<Asset[]>([])
  const [videoId, setVideoId] = useState('')
  const [range, setRange] = useState<[number, number]>([20, 58])
  const [created, setCreated] = useState<{ jobId: string; start: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    if (!projectId) return
    void (async () => {
      const { data, error: e } = await supabase.from('assets').select('id,asset_type,provenance,created_at').eq('project_id', projectId).in('asset_type', ['video', 'subtitle']).order('created_at', { ascending: false }).limit(300)
      if (e) { setError(e.message); return }
      const rows = (data ?? []) as Asset[]
      setVideos(rows.filter(a => a.asset_type === 'video')); setSubs(rows.filter(a => a.asset_type === 'subtitle'))
    })()
  }, [supabase, projectId])

  const segmentsFor = (id: string): TranscriptSegment[] | null => {
    const s = subs.find(x => x.provenance?.sourceAssetId === id && Array.isArray(x.provenance?.segments))
    return s ? (s.provenance!.segments as TranscriptSegment[]) : null
  }
  const transcribed = videos.filter(v => segmentsFor(v.id))
  const candidates: ShortCandidate[] = useMemo(() => {
    const segs = videoId ? segmentsFor(videoId) : null
    return segs ? extractShortCandidates(segs, { minS: range[0], maxS: range[1], count: 5 }) : []
  }, [videoId, subs, range]) // eslint-disable-line react-hooks/exhaustive-deps

  async function create(c: ShortCandidate) {
    const video = videos.find(v => v.id === videoId)
    if (!video) return
    setBusy(c.startMs); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const comp = shortComposition(video.id, c, `${titleOf(video)} · ${fmt(c.startMs)}`)
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: comp.format, status: 'draft', composition: comp }).select('id').single()
      if (e) throw new Error(e.message)
      setCreated({ jobId: (data as { id: string }).id, start: c.startMs })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el montaje.') } finally { setBusy(null) }
  }

  return <section className="panel" style={{ marginTop: 18 }} aria-label="Shorts desde un vídeo largo">
    <h2 className="panelTitle">Desde un vídeo largo</h2>
    <p className="muted small">Propone los mejores tramos de un vídeo largo a partir de su transcripción: frases completas, gancho al inicio, ritmo de voz y sin silencios largos. Es un cálculo (no IA) y explica por qué elige cada tramo. Transcribe primero el vídeo en la <Link className="open" href="/library">Biblioteca</Link> (gratis con límites).</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="field-row">
      <label htmlFor="lv-video">Vídeo transcrito
        <select id="lv-video" value={videoId} onChange={e => { setVideoId(e.target.value); setCreated(null) }}>
          <option value="">{transcribed.length ? '— Elige un vídeo' : 'Ningún vídeo de este proyecto tiene transcripción'}</option>
          {transcribed.map(v => <option key={v.id} value={v.id}>{titleOf(v)}</option>)}
        </select>
      </label>
      <label htmlFor="lv-len">Duración
        <select id="lv-len" value={range.join('-')} onChange={e => setRange(e.target.value.split('-').map(Number) as [number, number])}>
          <option value="15-30">15–30 s</option><option value="20-58">20–58 s (Shorts)</option><option value="30-90">30–90 s (Reels / TikTok)</option>
        </select>
      </label>
    </div>
    {videoId && candidates.length === 0 && <p className="muted small">No hay tramos de esa duración con frases completas en la transcripción.</p>}
    {candidates.length > 0 && <ol className="small" style={{ marginTop: 10 }}>
      {candidates.map(c => <li key={c.startMs} style={{ marginBottom: 8 }}>
        <b>{fmt(c.startMs)}–{fmt(c.endMs)}</b> ({Math.round((c.endMs - c.startMs) / 1000)} s · puntuación {c.score}) — «{c.hook}»
        <span className="muted" style={{ display: 'block' }}>{c.reasons.join(' · ')}</span>
        <button type="button" className="ghost small" disabled={busy !== null} onClick={() => void create(c)}>{busy === c.startMs ? 'Creando…' : 'Crear Short (borrador 9:16)'}</button>
        {created?.start === c.startMs && <span className="notice small" role="status"> Borrador creado. <Link className="open" href={`/editor/manual?job=${created.jobId}`}>Abrir en el editor manual →</Link></span>}
      </li>)}
    </ol>}
  </section>
}
