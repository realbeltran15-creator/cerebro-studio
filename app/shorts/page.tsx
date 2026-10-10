'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { RenderPanel } from '../components/render-panel'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { parseComposition, type Composition } from '@/lib/editor/composition'
import type { EditorAsset } from '@/lib/editor/client'
import { idempotencyKeyFor, approvalSummary, shortPayload } from '@/lib/shorts/publish'
import { isRetentionDue, retentionWindow, themeRetention, type ObservedRetention } from '@/lib/shorts/retention'
import type { Check } from '@/lib/shorts/script'
import type { SourceVerdict } from '@/lib/shorts/sources'

type Item = {
  id: string; status: string; topic: string; theme: string; project_id: string | null; render_job_id: string | null; publication_job_id: string | null
  interest: { video?: { title: string; url: string | null; channel: string | null; views: number | null }; nicheMedianViews?: number | null; poolSize?: number; components?: Record<string, { value: number; kind: string; note: string }>; score?: number }
  sources: SourceVerdict[]; verification: { supported?: boolean; statement?: string; note?: string }; checks: Check[]
  plan: { title?: string; description?: string; hashtags?: string[]; seconds?: number; scenes?: number; music?: { author: string; license: string } | null; musicMissing?: boolean }
  spend: { usd?: number; textCalls?: number; imageCalls?: number; voiceCalls?: number; models?: { image?: string; voice?: string } }
  discarded_reason: string | null; video_id: string | null; published_at: string | null; retention: ObservedRetention | null; created_at: string
}

const statusLabel: Record<string, string> = { prepared: 'Pendiente de tu revisión', approved: 'Aprobado (sin subir)', published: 'Subido como privado', discarded: 'Descartado', failed: 'Fallido' }
const kindLabel: Record<string, string> = { observed: 'Observado', calculated: 'Calculado', inferred: 'Inferido' }
const missingTable = (e: { code?: string; message?: string } | null) => Boolean(e) && (e!.code === 'PGRST205' || e!.code === '42P01' || /shorts_factory_items/.test(e!.message ?? ''))

export default function ShortsPage() {
  const supabase = getSupabaseBrowserClient()
  const [items, setItems] = useState<Item[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [composition, setComposition] = useState<Composition | null>(null)
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [pubStatus, setPubStatus] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [renderKey, setRenderKey] = useState(0)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('shorts_factory_items').select('*').order('created_at', { ascending: false }).limit(60)
    if (e) { if (missingTable(e)) setPending(true); else setError(e.message); return }
    setPending(false)
    const rows = (data ?? []) as Item[]
    setItems(rows)
    setSelectedId(id => id || rows.find(r => r.status === 'prepared')?.id || rows[0]?.id || '')
  }, [supabase])

  useEffect(() => { void load() }, [load])

  const selected = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId])

  const loadDetail = useCallback(async (item: Item | null) => {
    setComposition(null); setAssets([]); setPubStatus('')
    if (!item?.project_id) return
    const [job, a, pub] = await Promise.all([
      item.render_job_id ? supabase.from('render_jobs').select('composition').eq('id', item.render_job_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('assets').select('id,asset_type,storage_path,license_status,source_provider,provenance,created_at').eq('project_id', item.project_id).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(100),
      item.publication_job_id ? supabase.from('publication_jobs').select('status').eq('id', item.publication_job_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setComposition(parseComposition((job.data as { composition?: unknown } | null)?.composition))
    setAssets((a.data ?? []) as EditorAsset[])
    setPubStatus((pub.data as { status?: string } | null)?.status ?? '')
  }, [supabase])

  useEffect(() => { void loadDetail(selected) }, [selected?.id, selected?.publication_job_id, loadDetail]) // eslint-disable-line react-hooks/exhaustive-deps

  // The newest finished render of this Short (a browser render, or its H.264 conversion).
  const renderAsset = useMemo(() => assets.find(a => a.asset_type === 'video' && (a.source_provider === 'browser-render' || a.source_provider === 'browser-transcode')) ?? null, [assets])
  const accepted = (selected?.sources ?? []).filter(s => s.status === 'accepted')
  const learning = useMemo(() => themeRetention(items.map(i => ({ theme: i.theme as never, retention: i.retention }))), [items])
  const failedChecks = (selected?.checks ?? []).filter(c => !c.ok)
  const canApprove = Boolean(selected && selected.status === 'prepared' && renderAsset && accepted.length >= 2 && failedChecks.length === 0)

  async function approve() {
    if (!selected || !renderAsset || !selected.project_id) return
    const payload = shortPayload(selected.plan, selected.sources, renderAsset.id)
    const summary = approvalSummary(selected.topic, payload, accepted.length)
    if (!window.confirm(`${summary}\n\nAl aprobar autorizas subirlo a tu canal como PRIVADO. Todavía no se sube: tendrás que pulsar «Subir a YouTube».`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      let jobId = selected.publication_job_id
      if (!jobId) {
        const { data, error: e } = await supabase.from('publication_jobs').insert({ owner_id: user.id, project_id: selected.project_id, platform: 'youtube', status: 'draft', idempotency_key: idempotencyKeyFor(selected.id), payload }).select('id').single()
        if (e) throw new Error(e.message)
        jobId = (data as { id: string }).id
        await supabase.from('shorts_factory_items').update({ publication_job_id: jobId, updated_at: new Date().toISOString() }).eq('id', selected.id)
      }
      const r = await fetch(`/api/publish/youtube/${jobId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'APROBAR', riskSummary: summary }) })
      const json = await r.json() as { error?: string }
      if (!r.ok) throw new Error(json.error ?? 'No se pudo aprobar.')
      await supabase.from('shorts_factory_items').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', selected.id)
      setNotice('Aprobado. Todavía no se ha subido: pulsa «Subir a YouTube (privado)».')
      await load(); await loadDetail({ ...selected, publication_job_id: jobId, status: 'approved' })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo aprobar.') } finally { setBusy(false) }
  }

  async function upload() {
    if (!selected?.publication_job_id) return
    if (!window.confirm(`Se subirá «${selected.plan.title ?? selected.topic}» a tu canal como PRIVADO con el contenido sintético declarado. ¿Continuar?`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/publish/youtube/${selected.publication_job_id}/publish`, { method: 'POST' })
      const json = await r.json() as { videoId?: string; url?: string; error?: string }
      if (!r.ok || !json.videoId) throw new Error(json.error ?? 'La subida falló.')
      await supabase.from('shorts_factory_items').update({ status: 'published', video_id: json.videoId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', selected.id)
      setNotice(`Subido como privado: ${json.url}. La retención a 7 días se leerá automáticamente cuando esté disponible.`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'La subida falló.') } finally { setBusy(false) }
  }

  async function discard() {
    if (!selected || !window.confirm('¿Descartar este Short? El tema no volverá a proponerse.')) return
    const { error: e } = await supabase.from('shorts_factory_items').update({ status: 'discarded', discarded_reason: 'Descartado por el propietario en la pantalla de aprobación.', updated_at: new Date().toISOString() }).eq('id', selected.id)
    if (e) setError(e.message); else { setNotice('Descartado.'); await load() }
  }

  return <StudioShell title="Shorts" eyebrow="FÁBRICA DE CURIOSIDADES">
    <p className="muted" style={{ marginBottom: 14 }}>Un Short al día, preparado con recursos gratuitos. Nada se sube sin tu aprobación, y siempre como privado con el contenido sintético declarado.</p>
    {pending && <p className="warnBox">Falta aplicar la migración <code>20261010120000_shorts_factory.sql</code> en Supabase. Hasta entonces la fábrica no puede guardar Shorts.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    {!pending && items.length === 0 && <p className="emptyState">Todavía no hay Shorts. Crea la automatización «Fábrica de Shorts de curiosidades» en <a href="/automations">Automatizaciones</a> y ejecútala (o espera a la ejecución diaria).</p>}

    {items.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 280px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="shortsLayout">
      <aside className="panel" aria-label="Shorts">
        <h3 style={{ marginBottom: 8 }}>Shorts ({items.length})</h3>
        <div className="list">{items.map(i => <button key={i.id} type="button" className={i.id === selectedId ? 'listItem active' : 'listItem'} onClick={() => setSelectedId(i.id)} aria-pressed={i.id === selectedId} style={{ textAlign: 'left' }}>
          <span><b>{i.topic}</b><span className="muted small" style={{ display: 'block' }}>{statusLabel[i.status] ?? i.status} · {new Date(i.created_at).toLocaleDateString('es-ES')}</span></span>
        </button>)}</div>
        <h4 style={{ margin: '16px 0 6px' }}>Qué aprende la fábrica</h4>
        {learning.samples < 5 ? <p className="muted small">Hacen falta 5 Shorts publicados con retención medida a 7 días (ahora {learning.samples}) para empezar a priorizar temas con ella.</p>
          : <ul className="small" style={{ paddingLeft: 18 }}>{learning.stats.map(s => <li key={s.theme}>{s.theme}: {s.median.toFixed(1)}% de retención media a 7 días <span className="pill info">Observado</span> en {s.n} Short(s)</li>)}<li className="muted">Priorizar más los temas que retienen mejor es una <span className="pill warn">Inferencia</span>, no una garantía.</li></ul>}
      </aside>

      {selected && <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section className="panel">
          <div className="cardHead"><h2>{selected.plan.title ?? selected.topic}</h2><span className="pill">{statusLabel[selected.status] ?? selected.status}</span></div>
          <p className="muted small">Tema: {selected.topic} · {selected.theme} · ≈ {selected.plan.seconds ?? '?'} s · {selected.plan.scenes ?? '?'} escenas</p>
          <p className="pill ok" style={{ alignSelf: 'flex-start' }}>Coste de generación: {selected.spend.usd ?? 0} USD · {selected.spend.textCalls ?? 0} llamadas de texto, {selected.spend.imageCalls ?? 0} imágenes, {selected.spend.voiceCalls ?? 0} voz (solo opciones gratuitas)</p>
          {selected.discarded_reason && <p className="warnBox">{selected.discarded_reason}</p>}
        </section>

        <section className="panel" aria-labelledby="sh-sources">
          <h3 id="sh-sources">Fuentes del dato ({accepted.length} verificadas)</h3>
          <p style={{ margin: '6px 0' }}><b>Dato:</b> {selected.verification.statement ?? '—'}</p>
          <ul className="list">{(selected.sources ?? []).map(s => <li key={s.url} className="listItem" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span><span className={s.status === 'accepted' ? 'pill ok' : 'pill warn'}>{s.status === 'accepted' ? 'Aceptada' : 'Rechazada'}</span> <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.domain || s.url}</a> <span className="muted small">({s.domain})</span></span>
            <span className="muted small">{s.reason}</span>
          </li>)}</ul>
          {selected.verification.note && <p className="muted small">Verificación con IA sobre los extractos de las fuentes: {selected.verification.note}</p>}
        </section>

        <section className="panel" aria-labelledby="sh-checks">
          <h3 id="sh-checks">Controles antes de aprobar</h3>
          <ul className="list">{(selected.checks ?? []).map(c => <li key={c.id} className="listItem"><span className={c.ok ? 'pill ok' : 'pill warn'}>{c.ok ? 'Cumple' : 'Falla'}</span> <span>{c.message}</span></li>)}</ul>
          {selected.plan.musicMissing && <p className="muted small">Música: no se añadió (falta <code>FREESOUND_API_KEY</code> o no hubo una pista CC0 adecuada). El Short funciona sin música.</p>}
          {selected.plan.music && <p className="muted small">Música CC0 de {selected.plan.music.author} ({selected.plan.music.license}).</p>}
        </section>

        <section className="panel" aria-labelledby="sh-interest">
          <h3 id="sh-interest">Por qué este tema</h3>
          {selected.interest.video && <p className="small">Vídeo del Radar: <a href={selected.interest.video.url ?? '#'} target="_blank" rel="noopener noreferrer">{selected.interest.video.title}</a> — {selected.interest.video.views?.toLocaleString('es-ES') ?? '?'} vistas <span className="pill info">Observado</span> (mediana del nicho {Math.round(selected.interest.nicheMedianViews ?? 0).toLocaleString('es-ES')}, {selected.interest.poolSize} vídeos)</p>}
          <ul className="small" style={{ paddingLeft: 18 }}>{Object.entries(selected.interest.components ?? {}).map(([k, c]) => <li key={k}>{c.note} <span className="pill">{kindLabel[c.kind] ?? c.kind}</span></li>)}</ul>
        </section>

        {selected.status === 'prepared' && composition && selected.project_id && <>
          <RenderPanel key={renderKey} projectId={selected.project_id} composition={composition} assets={assets} autoStart onRendered={() => { setRenderKey(k => k); void loadDetail(selected) }} />
          <p className="muted small">El vídeo se renderiza al abrir esta pantalla, en tu navegador, en tiempo real: mantén la pestaña visible hasta que termine.</p>
        </>}

        <section className="panel" aria-labelledby="sh-approval">
          <h3 id="sh-approval">Aprobación</h3>
          {selected.status === 'prepared' && <>
            <p className="muted small">{renderAsset ? 'Vídeo renderizado y guardado en la Biblioteca.' : 'Espera a que termine el render para poder aprobar.'}{failedChecks.length ? ' Hay controles que fallan: no se puede aprobar.' : ''}{accepted.length < 2 ? ' Faltan fuentes verificadas.' : ''}</p>
            <div className="pageActions"><button type="button" onClick={() => void approve()} disabled={!canApprove || busy}>Aprobar (subida privada)</button><button type="button" className="ghost" onClick={() => void discard()} disabled={busy}>Descartar</button></div>
          </>}
          {selected.status === 'approved' && <div className="pageActions"><button type="button" onClick={() => void upload()} disabled={busy || pubStatus === 'publishing'}>Subir a YouTube (privado)</button><span className="muted small">Estado del trabajo: {pubStatus || '—'}</span></div>}
          {selected.status === 'published' && <>
            <p className="small">Subido como privado{selected.video_id ? <> — <a href={`https://www.youtube.com/watch?v=${selected.video_id}`} target="_blank" rel="noopener noreferrer">ver en YouTube</a></> : null}.</p>
            {selected.retention ? <p className="small"><b>Retención media a 7 días:</b> {selected.retention.averageViewPercentage !== null ? `${selected.retention.averageViewPercentage.toFixed(1)}%` : 'sin dato'} <span className="pill info">Observado (YouTube Analytics, {selected.retention.window.startDate} → {selected.retention.window.endDate})</span>{selected.retention.usableForLearning ? '' : ' · pocas vistas: no se usa para priorizar temas'}</p>
              : selected.published_at ? <p className="muted small">Retención a 7 días: {isRetentionDue(selected.published_at) ? 'se leerá en la próxima ejecución diaria' : `disponible a partir del ${new Date(Date.parse(`${retentionWindow(selected.published_at).endDate}T00:00:00Z`) + 3 * 86400000).toLocaleDateString('es-ES')}`}.</p> : null}
          </>}
          {selected.status === 'discarded' && <p className="muted small">Este Short está descartado.</p>}
        </section>
      </div>}
    </div>}
  </StudioShell>
}
