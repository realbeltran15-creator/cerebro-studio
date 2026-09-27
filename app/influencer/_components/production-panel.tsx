'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { jobStatusLabels } from '@/lib/virtual-influencer/preflight'
import type { SubjectKind } from '@/lib/virtual-influencer/quality'
import { QualityReview } from './quality-review'
import { useSignedUrls, type Persona } from './shared'
import type { CatalogRow } from './catalog-panel'

type Adapter = { id: string; label: string; kind: string; status: 'CONNECTED' | 'NOT_CONNECTED'; paid: boolean; referenceConditioning: boolean; notes: string; missing: string[] }
export type Job = { id: string; kind: string; provider: string; status: string; blocked_reasons: string[]; prompt: string | null; estimated_cost_eur: number | null; actual_cost_eur: number | null; cost_reported: boolean; output_asset_id: string | null; error: string | null; identity_version: number | null; created_at: string }

const kinds: Array<[string, string]> = [['image', 'Imagen'], ['video', 'Vídeo'], ['voice', 'Voz'], ['lipsync', 'Sincronización labial'], ['upscale', 'Escalado']]

export function ProductionPanel({ persona, jobs, voices, scenes, wardrobe, onChanged }: { persona: Persona; jobs: Job[]; voices: CatalogRow[]; scenes: CatalogRow[]; wardrobe: CatalogRow[]; onChanged: () => void }) {
  const [adapters, setAdapters] = useState<Adapter[]>([])
  const [kind, setKind] = useState('image')
  const [adapterId, setAdapterId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [sceneId, setSceneId] = useState('')
  const [wardrobeId, setWardrobeId] = useState('')
  const [voiceProfileId, setVoiceProfileId] = useState('')
  const [estimate, setEstimate] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const urls = useSignedUrls(jobs.flatMap(j => (j.output_asset_id ? [j.output_asset_id] : [])))

  useEffect(() => {
    void fetch('/api/influencer/providers', { cache: 'no-store' }).then(r => r.json() as Promise<{ adapters?: Adapter[] }>).then(j => setAdapters(j.adapters ?? [])).catch(() => setAdapters([]))
  }, [])
  const forKind = useMemo(() => adapters.filter(a => a.kind === kind), [adapters, kind])
  useEffect(() => { setAdapterId(id => (forKind.some(a => a.id === id) ? id : forKind[0]?.id ?? '')) }, [kind, forKind])

  async function create(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice(''); setBusy('create')
    const voice = voices.find(v => v.id === voiceProfileId)
    const r = await fetch(`/api/influencer/${persona.id}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind, adapterId, prompt, estimatedCostEur: estimate ? Number(estimate) : null,
      inputs: { sceneId: sceneId || null, wardrobeIds: wardrobeId ? [wardrobeId] : [], voiceProfileId: voiceProfileId || null, providerVoiceId: voice?.provider_voice_id ?? null },
    }) })
    const j = await r.json().catch(() => ({})) as { status?: string; blocked_reasons?: string[]; error?: string }
    setBusy('')
    if (!r.ok) { setError(j.error ?? 'No se pudo crear el trabajo.'); return }
    setNotice(j.status === 'blocked' ? `Trabajo registrado como bloqueado: ${(j.blocked_reasons ?? []).join(' ')}` : 'Trabajo en cola. Revisa el coste antes de ejecutarlo.')
    onChanged()
  }
  async function act(job: Job, path: 'run' | 'review', body?: Record<string, unknown>) {
    if (path === 'run' && !window.confirm(`Esto llama a ${job.provider} y puede tener un coste de hasta ${job.estimated_cost_eur ?? '?'} EUR. ¿Ejecutar?`)) return
    setBusy(job.id); setError(''); setNotice('')
    const r = await fetch(`/api/influencer/jobs/${job.id}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    const j = await r.json().catch(() => ({})) as { error?: string }
    setBusy('')
    if (!r.ok) setError(j.error ?? 'La acción falló.'); else onChanged()
  }

  const available = Math.max(Number(persona.budget_eur) - Number(persona.spent_eur), 0)
  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <h3>Producción</h3>
    <div className="stats">
      <span className={Number(persona.budget_eur) > 0 ? 'pill info' : 'pill warn'}>Presupuesto {Number(persona.budget_eur).toFixed(2)} EUR</span>
      <span className="pill">Reservado/gastado {Number(persona.spent_eur).toFixed(2)} EUR</span>
      <span className="pill">Disponible {available.toFixed(2)} EUR</span>
      <span className={persona.current_identity_version ? 'pill ok' : 'pill warn'}>Identidad {persona.current_identity_version ? `v${persona.current_identity_version}` : 'sin aprobar'}</span>
    </div>
    {Number(persona.budget_eur) <= 0 && <p className="warnBox small">Presupuesto 0 EUR: cualquier generación de pago queda bloqueada y registrada con el motivo. No se ha gastado nada.</p>}

    <b className="small">Proveedores</b>
    <div className="list">{adapters.map(a => <div key={a.id} className="listItem">
      <div><b>{a.label} · {kinds.find(k => k[0] === a.kind)?.[1]}</b><span>{a.notes}{a.missing.length ? ` Falta: ${a.missing.join(', ')}.` : ''}</span></div>
      <div className="pageActions">
        <span className={a.status === 'CONNECTED' ? 'pill ok' : 'pill bad'}>{a.status}</span>
        <span className={a.referenceConditioning ? 'pill ok' : 'pill warn'}>{a.referenceConditioning ? 'Usa referencias' : 'Sin referencias'}</span>
      </div>
    </div>)}</div>

    <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field-row">
        <label>Tipo<select value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Proveedor<select value={adapterId} onChange={e => setAdapterId(e.target.value)}>{forKind.map(a => <option key={a.id} value={a.id}>{a.label} ({a.status})</option>)}</select></label>
        <label>Coste máximo estimado (EUR)<input type="number" min={0} step={0.01} value={estimate} onChange={e => setEstimate(e.target.value)} placeholder="Obligatorio para ejecutar" /></label>
      </div>
      <div className="field-row">
        <label>Escena<select value={sceneId} onChange={e => setSceneId(e.target.value)}><option value="">—</option>{scenes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Vestuario<select value={wardrobeId} onChange={e => setWardrobeId(e.target.value)}><option value="">—</option>{wardrobe.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {kind === 'voice' && <label>Voice Profile<select value={voiceProfileId} onChange={e => setVoiceProfileId(e.target.value)}><option value="">—</option>{voices.map(s => <option key={s.id} value={s.id}>{s.name}{s.status === 'approved' ? '' : ' (sin aprobar)'}</option>)}</select></label>}
      </div>
      <label>{kind === 'voice' ? 'Texto a locutar' : 'Descripción del contenido'}<textarea className="viText" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} /></label>
      <div><button disabled={busy === 'create' || !adapterId}>{busy === 'create' ? 'Comprobando…' : 'Comprobar y registrar trabajo'}</button></div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <b className="small">Trabajos ({jobs.length})</b>
    {jobs.length === 0 ? <p className="emptyState">Sin trabajos.</p> : jobs.map(j => <article key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="cardHead" style={{ marginBottom: 0 }}>
        <b className="small">{kinds.find(k => k[0] === j.kind)?.[1]} · {j.provider} · identidad {j.identity_version ? `v${j.identity_version}` : '—'}</b>
        <span className={j.status === 'approved' ? 'pill ok' : ['blocked', 'failed', 'rejected'].includes(j.status) ? 'pill bad' : 'pill warn'}>{jobStatusLabels[j.status] ?? j.status}</span>
      </div>
      {j.prompt && <span className="muted small">{j.prompt.slice(0, 240)}</span>}
      <span className="muted small">Coste estimado {j.estimated_cost_eur ?? '—'} EUR · real {j.cost_reported ? `${j.actual_cost_eur} EUR` : 'no informado por el proveedor'} · {new Date(j.created_at).toLocaleString()}</span>
      {j.blocked_reasons.length > 0 && <ul className="warnList">{j.blocked_reasons.map(r => <li key={r}>{r}</li>)}</ul>}
      {j.error && <p className="error small">{j.error}</p>}
      {j.output_asset_id && urls[j.output_asset_id] && (j.kind === 'voice' ? <audio src={urls[j.output_asset_id]} controls /> : j.kind === 'image' ? <img src={urls[j.output_asset_id]} alt="" style={{ maxWidth: 360, borderRadius: 8 }} /> : <video src={urls[j.output_asset_id]} controls style={{ maxWidth: 480 }} />)}
      {j.status === 'queued' && <div><button type="button" disabled={Boolean(busy)} onClick={() => void act(j, 'run')}>{busy === j.id ? 'Generando…' : 'Ejecutar'}</button></div>}
      {['needs_review', 'approved', 'rejected'].includes(j.status) && <QualityReview personaId={persona.id} subjectType="generation_job" subjectId={j.id} kind={j.kind as SubjectKind} mediaUrl={j.output_asset_id ? urls[j.output_asset_id] : null} readOnly={j.status !== 'needs_review'} />}
      {j.status === 'needs_review' && <div className="pageActions">
        <button type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm('Aprobar este resultado para usarlo con la identidad de la persona. ¿Continuar?')) void act(j, 'review', { decision: 'approved', confirm: 'APROBAR' }) }}>Aprobar resultado</button>
        <button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => void act(j, 'review', { decision: 'rejected', note: window.prompt('Motivo del rechazo') ?? '' })}>Rechazar</button>
      </div>}
    </article>)}
  </section>
}
