'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

type Snapshot = { id: number; platform: string; external_content_id: string; metric_date: string; project_id: string | null; observed: Record<string, unknown>; calculated: Record<string, unknown> }
type Connection = { external_account_name: string | null; status: string; scopes: string[]; updated_at: string }

const n = (v: unknown) => (typeof v === 'number' ? v : null)
const fmt = (v: number | null, digits = 0) => (v === null ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: digits }))
const dur = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

export default function AnalyticsPage() {
  const supabase = getSupabaseBrowserClient()
  const [rows, setRows] = useState<Snapshot[]>([])
  const [connection, setConnection] = useState<Connection | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [{ data, error: e }, { data: c }] = await Promise.all([
      supabase.from('metric_snapshots').select('id,platform,external_content_id,metric_date,project_id,observed,calculated').eq('platform', 'youtube').order('metric_date', { ascending: false }).limit(400),
      supabase.from('channel_connections').select('external_account_name,status,scopes,updated_at').eq('provider', 'youtube').eq('status', 'connected').order('updated_at', { ascending: false }).limit(1),
    ])
    if (e) setError(e.message); else setRows((data ?? []) as Snapshot[])
    setConnection(((c ?? [])[0] as Connection | undefined) ?? null)
  }, [supabase])

  useEffect(() => {
    void load()
    void fetch('/api/providers/status', { cache: 'no-store' }).then(r => r.json() as Promise<{ providers?: Array<{ id: string; enabled: boolean }> }>)
      .then(j => setConfigured(Boolean(j.providers?.some(p => p.id === 'youtube-oauth' && p.enabled)))).catch(() => setConfigured(null))
  }, [load])

  async function importDays(days: number) {
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await fetch('/api/analytics/youtube/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) })
      const json = await r.json() as { error?: string; days?: number; videos?: number; period?: { startDate: string; endDate: string } }
      if (!r.ok) throw new Error(json.error ?? 'No se pudo importar.')
      setNotice(`Importados ${json.days} días y ${json.videos} vídeos (${json.period?.startDate} → ${json.period?.endDate}).`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo importar.') } finally { setBusy(false) }
  }

  const daily = useMemo(() => rows.filter(r => r.external_content_id.startsWith('channel:')).sort((a, b) => a.metric_date.localeCompare(b.metric_date)).slice(-28), [rows])
  const latestEnd = useMemo(() => rows.filter(r => !r.external_content_id.startsWith('channel:')).map(r => r.metric_date).sort().at(-1), [rows])
  const videos = useMemo(() => rows.filter(r => !r.external_content_id.startsWith('channel:') && r.metric_date === latestEnd).sort((a, b) => (n(b.observed.views) ?? 0) - (n(a.observed.views) ?? 0)), [rows, latestEnd])
  const sum = (key: string) => daily.reduce<number | null>((t, r) => (n(r.observed[key]) === null ? t : (t ?? 0) + (n(r.observed[key]) ?? 0)), null)
  const views = sum('views'), minutes = sum('estimatedMinutesWatched'), gained = sum('subscribersGained'), lost = sum('subscribersLost')

  return <StudioShell title="Analytics" eyebrow="RESULTADOS">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {configured === false && <p className="warnBox">La conexión con YouTube no está configurada en el servidor (faltan <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code> o <code>TOKEN_ENCRYPTION_KEY</code>).</p>}

    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="cardHead" style={{ marginBottom: 8 }}>
        <h3>{connection ? `Canal conectado: ${connection.external_account_name ?? 'YouTube'}` : 'Canal de YouTube sin conectar'}</h3>
        {connection ? <div className="pageActions">
          {[7, 28, 90].map(d => <button key={d} type="button" className={d === 28 ? undefined : 'ghost'} disabled={busy} onClick={() => void importDays(d)}>{busy ? 'Importando…' : `Importar ${d} días`}</button>)}
        </div> : <Link className="buttonLink" href="/connectors">Conectar en Conectores</Link>}
      </div>
      <p className="muted small">Datos de YouTube Analytics de tu propio canal (solo lectura). YouTube consolida las métricas con 1–3 días de retraso. Los valores observados vienen de la API; los calculados los deriva Cerebro y se muestran aparte.</p>
    </section>

    {daily.length > 0 && <>
      <h3 className="sectionTitle">Últimos {daily.length} días (observado)</h3>
      <div className="kpis">
        <div className="kpi"><small>Vistas</small><b>{fmt(views)}</b></div>
        <div className="kpi"><small>Minutos vistos</small><b>{fmt(minutes)}</b></div>
        <div className="kpi"><small>Suscriptores ganados</small><b>{fmt(gained)}</b></div>
        <div className="kpi"><small>Suscriptores perdidos</small><b>{fmt(lost)}</b></div>
        <div className="kpi"><small>Neto (calculado)</small><b>{gained === null ? '—' : fmt((gained ?? 0) - (lost ?? 0))}</b></div>
        <div className="kpi"><small>Min/vista (calculado)</small><b>{views ? fmt((minutes ?? 0) / views, 2) : '—'}</b></div>
      </div>
      <div className="panel" style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{['Día', 'Vistas', 'Minutos', 'Duración media', 'Likes', 'Comentarios', 'Subs +', 'Subs −'].map(h => <th key={h} style={{ textAlign: h === 'Día' ? 'left' : 'right', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
          <tbody>{[...daily].reverse().map(r => <tr key={r.id}>
            <td style={{ padding: '5px 8px' }}>{r.metric_date}</td>
            {[fmt(n(r.observed.views)), fmt(n(r.observed.estimatedMinutesWatched)), dur(n(r.observed.averageViewDuration)), fmt(n(r.observed.likes)), fmt(n(r.observed.comments)), fmt(n(r.observed.subscribersGained)), fmt(n(r.observed.subscribersLost))].map((v, i) => <td key={i} style={{ textAlign: 'right', padding: '5px 8px' }}>{v}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </>}

    {videos.length > 0 && <>
      <h3 className="sectionTitle">Vídeos con más vistas · {String(videos[0].observed.periodStart ?? '')} → {String(videos[0].observed.periodEnd ?? '')}</h3>
      <div className="list">{videos.map(v => <div key={v.id} className="listItem" style={{ flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <a href={`https://www.youtube.com/watch?v=${v.external_content_id}`} target="_blank" rel="noopener noreferrer"><b>{String(v.observed.title ?? v.external_content_id)}</b></a>
          {v.project_id && <> · <Link className="open" href={`/projects/${v.project_id}`}>proyecto</Link></>}
          <span className="small" style={{ display: 'block' }}>Observado: {fmt(n(v.observed.views))} vistas · {fmt(n(v.observed.estimatedMinutesWatched))} min · duración media {dur(n(v.observed.averageViewDuration))} · {fmt(n(v.observed.averageViewPercentage), 1)}% visto · {fmt(n(v.observed.subscribersGained))} subs</span>
          <span className="small muted" style={{ display: 'block' }}>Calculado: {fmt(n(v.calculated.likesPer1000Views), 2)} likes/1000 vistas · {fmt(n(v.calculated.subscribersPer1000Views), 2)} subs/1000 vistas</span>
        </div>
      </div>)}</div>
    </>}

    {rows.length === 0 && !error && <p className="emptyState">Sin métricas importadas todavía.</p>}
  </StudioShell>
}
