'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { extractShortCandidates, SHORT_TEMPLATES, shortComposition, viralPotential, type ShortCandidate, type TranscriptSegment } from '@/lib/shorts/extract'

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
  const [created, setCreated] = useState<Array<{ jobId: string; start: number; title: string }>>([])
  const [picked, setPicked] = useState<number[]>([])
  const [templateId, setTemplateId] = useState(SHORT_TEMPLATES[0].id)
  const [focusX, setFocusX] = useState(0.5)
  const [count, setCount] = useState(5)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
  const pending = videos.filter(v => !segmentsFor(v.id))
  const [transcribing, setTranscribing] = useState('')
  const [language, setLanguage] = useState('es')
  async function transcribe(v: Asset) {
    setTranscribing(v.id); setError('')
    try {
      const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: v.id, language }) })
      const j = await r.json().catch(() => ({})) as { asset?: Asset; error?: string; attempts?: string[] }
      if (!r.ok || !j.asset) throw new Error(`${j.error ?? 'No se pudo transcribir.'}${j.attempts?.length ? ` (${j.attempts.join(' · ')})` : ''}`)
      const { data } = await supabase.from('assets').select('id,asset_type,provenance,created_at').eq('id', j.asset.id).maybeSingle()
      if (data) setSubs(list => [data as Asset, ...list.filter(x => x.id !== (data as Asset).id)])
      setVideoId(v.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo transcribir.') } finally { setTranscribing('') }
  }
  const candidates: ShortCandidate[] = useMemo(() => {
    const segs = videoId ? segmentsFor(videoId) : null
    return segs ? extractShortCandidates(segs, { minS: range[0], maxS: range[1], count }) : []
  }, [videoId, subs, range, count]) // eslint-disable-line react-hooks/exhaustive-deps
  const ranked = useMemo(() => candidates.map(c => ({ c, p: viralPotential(c) })).sort((a, b) => b.p.score - a.p.score), [candidates])

  /** Creates one 9:16 draft per chosen moment in a single insert (all or nothing). Nothing is rendered or published. */
  async function createMany(list: ShortCandidate[]) {
    const video = videos.find(v => v.id === videoId)
    if (!video || !list.length) return
    setBusy(true); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const template = SHORT_TEMPLATES.find(t => t.id === templateId)
      const rows = list.map(c => {
        const title = `${titleOf(video)} · ${fmt(c.startMs)}`
        return { title, start: c.startMs, row: { owner_id: user.id, project_id: projectId, output_format: '9:16', status: 'draft', composition: shortComposition(video.id, c, title, segmentsFor(video.id) ?? [], { template, focusX }) } }
      })
      const { data, error: e } = await supabase.from('render_jobs').insert(rows.map(r => r.row)).select('id')
      if (e) throw new Error(e.message)
      const ids = (data ?? []) as Array<{ id: string }>
      setCreated(prev => [...rows.map((r, i) => ({ jobId: ids[i]?.id ?? '', start: r.start, title: r.title })).filter(x => x.jobId), ...prev])
      setPicked([])
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron crear los montajes.') } finally { setBusy(false) }
  }
  const toggle = (start: number) => setPicked(p => p.includes(start) ? p.filter(x => x !== start) : [...p, start])

  return <section className="panel" style={{ marginTop: 18 }} aria-label="Shorts desde un vídeo largo">
    <h2 className="panelTitle">Desde un vídeo largo</h2>
    <p className="muted small">Propone los mejores tramos de un vídeo largo a partir de su transcripción: frases completas, gancho al inicio, ritmo de voz y sin silencios largos. Es un cálculo (no IA) y explica por qué elige cada tramo. Si el vídeo aún no tiene transcripción, transcríbelo aquí abajo o en la <Link className="open" href="/library">Biblioteca</Link> (gratis con límites).</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="field-row">
      <label htmlFor="lv-video">Vídeo transcrito
        <select id="lv-video" value={videoId} onChange={e => { setVideoId(e.target.value); setPicked([]) }}>
          <option value="">{transcribed.length ? '— Elige un vídeo' : 'Ningún vídeo de este proyecto tiene transcripción'}</option>
          {transcribed.map(v => <option key={v.id} value={v.id}>{titleOf(v)}</option>)}
        </select>
      </label>
      <label htmlFor="lv-len">Duración
        <select id="lv-len" value={range.join('-')} onChange={e => setRange(e.target.value.split('-').map(Number) as [number, number])}>
          <option value="15-30">15–30 s</option><option value="20-58">20–58 s (Shorts)</option><option value="30-90">30–90 s (Reels / TikTok)</option>
        </select>
      </label>
      <label htmlFor="lv-count">Momentos a proponer
        <select id="lv-count" value={count} onChange={e => setCount(Number(e.target.value))}>{[3, 5, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</select>
      </label>
    </div>
    <div className="field-row">
      <label htmlFor="lv-template">Plantilla
        <select id="lv-template" value={templateId} onChange={e => setTemplateId(e.target.value)}>{SHORT_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </label>
      <label htmlFor="lv-focus">Encuadre vertical (si el vídeo es horizontal)
        <select id="lv-focus" value={focusX} onChange={e => setFocusX(Number(e.target.value))}><option value={0.5}>Centro</option><option value={0.25}>Izquierda</option><option value={0.75}>Derecha</option><option value={0}>Borde izquierdo</option><option value={1}>Borde derecho</option></select>
      </label>
    </div>
    <p className="muted small">{SHORT_TEMPLATES.find(t => t.id === templateId)?.description} El encuadre se puede afinar después clip a clip en el editor.</p>
    {pending.length > 0 && <div className="small" style={{ marginTop: 10 }}>
      <p className="muted">Vídeos sin transcripción ({pending.length}). Transcribir es gratis dentro de los límites de Groq o Cloudflare; el resultado se guarda en la Biblioteca.</p>
      <label htmlFor="lv-lang">Idioma del audio <select id="lv-lang" value={language} onChange={e => setLanguage(e.target.value)}><option value="es">Español</option><option value="en">Inglés</option><option value="pt">Portugués</option><option value="fr">Francés</option><option value="de">Alemán</option><option value="it">Italiano</option></select></label>
      <ul>{pending.slice(0, 8).map(v => <li key={v.id}>{titleOf(v)} <button type="button" className="ghost small" disabled={!!transcribing} onClick={() => void transcribe(v)}>{transcribing === v.id ? 'Transcribiendo…' : 'Transcribir'}</button></li>)}</ul>
    </div>}
    {videoId && candidates.length === 0 && <p className="muted small">No hay tramos de esa duración con frases completas en la transcripción.</p>}
    {ranked.length > 0 && <>
      <div className="pageActions" style={{ marginTop: 10 }}>
        <button type="button" disabled={busy || picked.length === 0} onClick={() => void createMany(ranked.filter(r => picked.includes(r.c.startMs)).map(r => r.c))}>{busy ? 'Creando…' : `Crear ${picked.length || ''} Short${picked.length === 1 ? '' : 's'} (borradores 9:16)`}</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setPicked(ranked.map(r => r.c.startMs))}>Elegir todos</button>
        {picked.length > 0 && <button type="button" className="ghost" onClick={() => setPicked([])}>Quitar selección</button>}
      </div>
      <ol className="small" style={{ marginTop: 10 }} aria-label="Momentos propuestos">
        {ranked.map(({ c, p }) => <li key={c.startMs} style={{ marginBottom: 10 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={picked.includes(c.startMs)} onChange={() => toggle(c.startMs)} aria-label={`Elegir ${fmt(c.startMs)}–${fmt(c.endMs)}`} />
            <span><b>{fmt(c.startMs)}–{fmt(c.endMs)}</b> ({Math.round((c.endMs - c.startMs) / 1000)} s) · <span className={p.label === 'alto' ? 'pill ok' : p.label === 'medio' ? 'pill info' : 'pill'} title={p.factors.map(f => `${f.name}: +${f.points}`).join(' · ')}>Potencial {p.label} · {p.score}/100 (estimado)</span> — «{c.hook}»
              <span className="muted" style={{ display: 'block' }}>{c.reasons.join(' · ')}</span></span>
          </label>
        </li>)}
      </ol>
      <p className="muted small">El potencial es una estimación a partir del texto (gancho, final, ritmo, tono directo, cifras y duración); no predice visualizaciones.</p>
    </>}
    {created.length > 0 && <div className="notice small" role="status" style={{ marginTop: 10 }}>
      <b>{created.length} borrador{created.length === 1 ? '' : 'es'} creado{created.length === 1 ? '' : 's'}.</b> Revísalos y renderízalos en el editor; después, miniatura y publicación (siempre con tu aprobación):
      <ul>{created.map(c => <li key={c.jobId}>{c.title} — <Link className="open" href={`/editor/manual?job=${c.jobId}`}>Abrir en el editor</Link></li>)}</ul>
      <Link className="open" href={`/thumbnails?project=${projectId}`}>Crear miniaturas</Link> · <Link className="open" href={`/youtube?project=${projectId}`}>Preparar YouTube</Link> · <Link className="open" href={`/social?project=${projectId}`}>Preparar Instagram / TikTok</Link>
    </div>}
  </section>
}
