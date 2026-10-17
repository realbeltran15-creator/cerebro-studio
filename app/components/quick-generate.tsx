'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './studio-icon'
import { modalityLabels, modelById, type Modality } from '@/lib/providers/catalog'
import { tierLabels, type CostTier } from '@/lib/providers/directory'
import { normalizeStrategy, qualityLevels, rankModels, STRATEGY_KEY, strategyLabels, type Strategy } from '@/lib/providers/router'

type Model = { id: string; modality: Modality; label: string; tier: CostTier; price: string; priceConfirmed: boolean; ready: boolean; creditsExhausted: boolean; durations: number[] | null; missing: string[] }

/**
 * Compact generator used inside modules (Música y sonidos, Editor…). Same server routes, cost
 * confirmation and provenance as the Creation Studio; results are saved to the Biblioteca.
 */
export function QuickGenerate({ modalities, projectId, sceneId, defaultPrompt = '', onGenerated }: {
  modalities: Modality[]; projectId: string; sceneId?: string | null; defaultPrompt?: string; onGenerated?: (assetId: string) => void
}) {
  const [models, setModels] = useState<Model[]>([])
  const [modality, setModality] = useState<Modality>(modalities[0])
  const [strategy, setStrategy] = useState<Strategy>('best_value')
  const [minQuality, setMinQuality] = useState(4)
  const [modelId, setModelId] = useState('')
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [duration, setDuration] = useState<number | null>(null)
  const [instrumental, setInstrumental] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const alive = useRef(true)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { try { const v = normalizeStrategy(localStorage.getItem(STRATEGY_KEY)); if (v && v !== 'manual') setStrategy(v); const q = Number(localStorage.getItem(`${STRATEGY_KEY}.quality`)); if (q >= 1 && q <= 5) setMinQuality(q) } catch { /* private mode */ } }, [])
  useEffect(() => {
    fetch('/api/studio/catalog', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j) setModels(j.models) }).catch(() => {})
  }, [])
  useEffect(() => { setPrompt(defaultPrompt) }, [defaultPrompt])

  const list = useMemo(() => models.filter(m => m.modality === modality), [models, modality])
  const ranked = useMemo(() => {
    const full = list.map(m => modelById(m.id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    return rankModels(full, { modality, strategy, minQuality: strategy === 'best_quality' ? undefined : minQuality }, Object.fromEntries(list.map(m => [m.id, { ready: m.ready, creditsExhausted: m.creditsExhausted }])))
  }, [list, modality, strategy, minQuality])
  useEffect(() => {
    const best = ranked.find(r => r.eligible)
    setModelId(best?.model.id ?? list[0]?.id ?? '')
  }, [ranked, list])
  const model = list.find(m => m.id === modelId) ?? null
  const full = modelById(modelId)
  useEffect(() => { if (model?.durations && (!duration || !model.durations.includes(duration))) setDuration(model.durations[Math.min(1, model.durations.length - 1)]) }, [model, duration])
  const estimate = full?.estimateUsd({ durationSeconds: duration ?? undefined, instrumental }) ?? 0
  const costText = !model ? '' : model.tier === 'free' || model.tier === 'local' ? 'gratis' : estimate > 0 ? `≈ $${estimate.toFixed(2)}` : 'con créditos'

  async function poll(token: string) {
    for (let i = 0; i < 120 && alive.current; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const r = await fetch('/api/studio/job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const j = await r.json().catch(() => ({})) as { state?: string; error?: string; assets?: Array<{ id: string }> }
      if (j.state === 'done' && j.assets?.[0]) return j.assets[0].id
      if (j.state === 'failed' || j.state === 'expired') throw new Error(j.error ?? 'Falló la generación.')
      setStatus(j.state === 'queued' ? 'En cola…' : 'Generando…')
    }
    throw new Error('Sigue en proceso; aparecerá en la Biblioteca al terminar si vuelves al Estudio.')
  }

  async function generate() {
    if (!model || !prompt.trim() || !projectId) return
    setConfirming(false); setBusy(true); setStatus('Generando…'); setPreview('')
    try {
      const r = await fetch('/api/studio/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, sceneId: sceneId || null, modelId: model.id, prompt: prompt.trim(), options: { durationSeconds: duration ?? undefined, instrumental }, selection: `${strategy}:q${minQuality}`, confirmedEstimateUsd: estimate }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string; assets?: Array<{ id: string }>; job?: { token: string } }
      if (!r.ok && r.status !== 202) throw new Error(j.error ?? 'No se pudo generar.')
      const id = j.job ? await poll(j.job.token) : j.assets?.[0]?.id
      if (!id) throw new Error('El proveedor no devolvió archivo.')
      const s = await fetch(`/api/assets/${id}/signed-url`, { cache: 'no-store' }).then(x => x.json()).catch(() => ({})) as { url?: string }
      if (alive.current) { setPreview(s.url ?? ''); setStatus(`Listo · guardado en la Biblioteca (${model.label}).`) }
      onGenerated?.(id)
    } catch (e) {
      if (alive.current) setStatus(e instanceof Error ? e.message : 'No se pudo generar.')
    } finally { if (alive.current) setBusy(false) }
  }

  return (
    <div className="quickGen">
      {modalities.length > 1 && (
        <div className="chips" role="tablist" aria-label="Tipo">
          {modalities.map(m => <button key={m} type="button" role="tab" aria-selected={m === modality} className={m === modality ? 'chip active' : 'chip'} onClick={() => { setModality(m); setConfirming(false) }}>{modalityLabels[m]}</button>)}
        </div>
      )}
      <div className="field-row">
        <label>Elegir
          <select value={strategy} onChange={e => setStrategy(e.target.value as Strategy)}>
            {(Object.keys(strategyLabels) as Strategy[]).map(k => <option key={k} value={k}>{strategyLabels[k]}</option>)}
          </select>
        </label>
        {strategy !== 'best_quality' && <label>Calidad necesaria
          <select value={minQuality} onChange={e => setMinQuality(Number(e.target.value))}>
            {qualityLevels.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
          </select>
        </label>}
        <label>Modelo
          <select value={modelId} onChange={e => setModelId(e.target.value)}>
            {ranked.map(r => { const m = list.find(x => x.id === r.model.id)!; return <option key={m.id} value={m.id} disabled={!m.ready}>{m.label} · {tierLabels[m.tier]}{m.ready ? (m.creditsExhausted ? ' · sin créditos' : '') : ' · sin clave'}</option> })}
          </select>
        </label>
      </div>
      {model && <p className="muted small"><span className={`tierBadge tier-${model.tier}`}>{tierLabels[model.tier]}</span> {model.priceConfirmed ? '' : 'Precio de referencia · '}{model.price}</p>}
      {list.length > 0 && !list.some(m => m.ready) && <p className="warnBox small">Ningún proveedor de {modalityLabels[modality].toLowerCase()} está configurado. Puedes usar los bancos gratuitos o subir tus archivos.</p>}
      <label>Descripción
        <textarea rows={3} value={prompt} onChange={e => { setPrompt(e.target.value); setConfirming(false) }} maxLength={4000}
          placeholder={modality === 'music' ? 'Ambient cinematográfico, 70 BPM, cuerdas graves y piano, tensión contenida' : modality === 'ambient' ? 'Selva tropical de noche, insectos, lluvia lejana' : 'Golpe metálico seco en un hangar vacío'} />
      </label>
      {model?.durations && <div className="chips">{model.durations.map(d => <button key={d} type="button" className={d === duration ? 'chip active' : 'chip'} onClick={() => setDuration(d)}>{d} s</button>)}</div>}
      {modality === 'music' && <label className="toggle"><input type="checkbox" checked={instrumental} onChange={e => setInstrumental(e.target.checked)} /> Solo instrumental</label>}
      {!confirming
        ? <button type="button" disabled={busy || !model?.ready || !prompt.trim() || !projectId} onClick={() => setConfirming(true)}><Icon name="bolt" size={16} />{busy ? 'Generando…' : `Generar ${modalityLabels[modality].toLowerCase()} · ${costText}`}</button>
        : <div className="confirmBox" role="alertdialog" aria-label="Confirmar generación">
            <p><b>¿Generar con {model?.label}?</b> {model?.tier === 'paid' ? `Se cobrará en tu cuenta del proveedor (${costText}, estimado).` : model?.tier === 'free' ? 'Usa el cupo gratuito; no tiene coste.' : 'Consume créditos o el nivel gratuito de tu cuenta.'}</p>
            <div className="pageActions"><button type="button" onClick={() => void generate()}>Confirmar y generar</button><button type="button" className="ghost" onClick={() => setConfirming(false)}>Cancelar</button></div>
          </div>}
      {status && <p className="muted small" role="status">{status}</p>}
      {preview && <audio src={preview} controls style={{ width: '100%' }} />}
    </div>
  )
}
