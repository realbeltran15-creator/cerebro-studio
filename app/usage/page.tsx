'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { modelById } from '@/lib/providers/catalog'
import { tierLabels, type CostTier } from '@/lib/providers/directory'
import { STRATEGY_KEY, strategyLabels, type Strategy } from '@/lib/providers/router'
import { summarizeUsage, type UsageAsset } from '@/lib/providers/usage'

type Balance = { used: number; limit: number; remaining: number; resetsAt: string | null; tier: string | null } | null
type Project = { id: string; name: string }

export default function UsagePage() {
  const supabase = getSupabaseBrowserClient()
  const [assets, setAssets] = useState<UsageAsset[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [balance, setBalance] = useState<Balance>(null)
  const [range, setRange] = useState<'30' | '90' | 'all'>('30')
  const [projectId, setProjectId] = useState('')
  const [strategy, setStrategy] = useState<Strategy | 'manual'>('manual')
  const [error, setError] = useState('')
  const [now, setNow] = useState(0)

  useEffect(() => {
    try { const v = localStorage.getItem(STRATEGY_KEY); if (v) setStrategy(v as Strategy) } catch { /* private mode */ }
    void (async () => {
      const [a, p, cat] = await Promise.all([
        supabase.from('assets').select('id,asset_type,project_id,source_provider,license_status,provenance,created_at').order('created_at', { ascending: false }).limit(2000),
        supabase.from('projects').select('id,name'),
        fetch('/api/studio/catalog', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      if (a.error) setError(a.error.message)
      setAssets((a.data ?? []) as UsageAsset[])
      setProjects((p.data ?? []) as Project[])
      setBalance(cat?.balances?.elevenlabs ?? null)
      setNow(Date.now())
    })()
  }, [supabase])

  function saveStrategy(v: Strategy | 'manual') {
    setStrategy(v)
    try { localStorage.setItem(STRATEGY_KEY, v) } catch { /* private mode */ }
  }

  const since = range === 'all' || !now ? null : new Date(now - Number(range) * 864e5).toISOString()
  const filtered = useMemo(() => assets.filter(a => (!since || a.created_at >= since) && (!projectId || a.project_id === projectId)), [assets, since, projectId])
  const s = useMemo(() => summarizeUsage(filtered), [filtered])
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? '—'

  return (
    <StudioShell title="Costes y créditos" eyebrow="CONTROL" actions={<Link className="buttonLink ghost" href="/connectors">Proveedores</Link>}>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="field-row" style={{ marginBottom: 16 }}>
        <label htmlFor="u-range">Periodo<select id="u-range" value={range} onChange={e => setRange(e.target.value as typeof range)}><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="all">Todo</option></select></label>
        <label htmlFor="u-project">Proyecto<select id="u-project" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">Todos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label htmlFor="u-strategy">Elección de modelo por defecto en el Estudio
          <select id="u-strategy" value={strategy} onChange={e => saveStrategy(e.target.value as Strategy | 'manual')}>
            <option value="manual">Manual</option>
            {(Object.keys(strategyLabels) as Strategy[]).map(k => <option key={k} value={k}>{strategyLabels[k]}</option>)}
          </select>
        </label>
      </div>

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><span>Generaciones</span><b>{s.generations}</b></div>
        <div className="kpi"><span>Gratis / cupo gratuito</span><b>{s.byTier.free + s.byTier.local}</b></div>
        <div className="kpi"><span>Con créditos o freemium</span><b>{s.byTier.credits + s.byTier.freemium}</b></div>
        <div className="kpi"><span>Coste estimado (de pago)</span><b>${s.estimatedUsd.toFixed(2)}</b></div>
        <div className="kpi"><span>Coste real informado</span><b>{s.reportedUsd === null ? '—' : `$${s.reportedUsd.toFixed(2)}`}</b></div>
        <div className="kpi"><span>Créditos ElevenLabs gastados</span><b>{s.elevenCredits.toLocaleString()}</b></div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2 className="panelTitle">Saldos en vivo</h2>
        <div className="list">
          <div className="listItem"><div><b>ElevenLabs</b><span>{balance ? `${balance.remaining.toLocaleString()} de ${balance.limit.toLocaleString()} créditos disponibles${balance.resetsAt ? ` · se renuevan el ${new Date(balance.resetsAt).toLocaleDateString()}` : ''}${balance.tier ? ` · plan ${balance.tier}` : ''}` : 'Sin clave configurada o saldo no disponible.'}</span></div>{balance && <span className={balance.remaining > 0 ? 'pill ok' : 'pill warn'}>{Math.round(100 * balance.remaining / Math.max(1, balance.limit))} %</span>}</div>
          <div className="listItem"><div><b>Cloudflare Workers AI</b><span>10.000 neuronas gratis al día. La API no expone el saldo restante; se reinicia cada día.</span></div><span className="pill">Cupo diario</span></div>
          <div className="listItem"><div><b>Gemini API</b><span>Nivel gratuito con límites por minuto y día; sin API de saldo. Si se agota, el proveedor responde 429 y Cerebro lo indica.</span></div><span className="pill">Freemium</span></div>
          <div className="listItem"><div><b>fal.ai · OpenAI</b><span>Pago por uso; consulta el saldo y la factura en sus paneles. Cerebro registra el coste estimado de cada generación.</span></div><span className="pill">De pago</span></div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2 className="panelTitle">Por proveedor y modelo</h2>
        {s.rows.length === 0 ? <p className="emptyState">Aún no hay generaciones en este periodo.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dataTable">
              <thead><tr><th>Proveedor</th><th>Modelo</th><th>Tipo</th><th>Coste</th><th className="num">Generaciones</th><th className="num">Estimado</th><th className="num">Real</th><th className="num">Créditos</th></tr></thead>
              <tbody>{s.rows.map(r => (
                <tr key={r.key}>
                  <td>{r.provider}</td><td>{modelById(r.model)?.label ?? r.model}</td><td>{r.kind}</td>
                  <td><span className={`tierBadge tier-${r.tier}`}>{tierLabels[r.tier as CostTier] ?? r.tier}</span></td>
                  <td className="num">{r.count}</td><td className="num">${r.estimatedUsd.toFixed(2)}</td><td className="num">{r.reportedUsd === null ? '—' : `$${r.reportedUsd.toFixed(2)}`}</td><td className="num">{r.credits ? r.credits.toLocaleString() : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="panelTitle">Últimas generaciones</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="dataTable">
            <thead><tr><th>Fecha</th><th>Proyecto</th><th>Recurso</th><th>Proveedor / modelo</th><th>Coste</th><th className="num">Estimado</th><th className="num">Créditos</th></tr></thead>
            <tbody>{s.recent.slice(0, 40).map(r => (
              <tr key={r.id}><td>{new Date(r.date).toLocaleString()}</td><td>{projectName(r.projectId)}</td><td>{r.kind}</td><td>{r.provider}{r.model ? ` · ${modelById(r.model)?.label ?? r.model}` : ''}</td>
                <td><span className={`tierBadge tier-${r.tier}`}>{tierLabels[r.tier as CostTier] ?? r.tier}</span></td><td className="num">{r.estimatedUsd ? `$${r.estimatedUsd.toFixed(3)}` : '—'}</td><td className="num">{r.credits ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>«Estimado» usa el precio de lista guardado al generar. «Real» solo aparece cuando el proveedor informa el importe. Los créditos son los que el proveedor descuenta (ElevenLabs los indica en cada respuesta).</p>
      </section>
    </StudioShell>
  )
}
