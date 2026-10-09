'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { REASONS, STATUS_LABEL } from '@/lib/shorts/labels'
import css from './shorts.module.css'

type Req = { name: string; purpose: string; level: 'blocking' | 'upload' | 'optional'; present: boolean }
type ShortRow = { id: string; run_date: string; status: string; topic: string | null; title: string | null; discard_reason: string | null; category: string | null }

export default function ShortsFactoryPage() {
  const supabase = getSupabaseBrowserClient()
  const [shorts, setShorts] = useState<ShortRow[]>([])
  const [reqs, setReqs] = useState<Req[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('shorts').select('id,run_date,status,topic,title,discard_reason,category').order('created_at', { ascending: false }).limit(40)
    if (e) setError(e.message); else setShorts((data ?? []) as ShortRow[])
    const r = await fetch('/api/shorts/readiness')
    if (r.ok) setReqs((await r.json()).requirements)
  }, [supabase])
  useEffect(() => { void load() }, [load])

  async function prepare(force: boolean) {
    setBusy(true); setMessage('Preparando… puede tardar 1-3 minutos (tema, fuentes, guion, voz e imágenes).'); setError('')
    try {
      const res = await fetch('/api/shorts/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }) })
      const json = await res.json()
      if (json.status === 'blocked') setMessage(`Faltan variables de entorno en el servidor: ${json.missing.join(', ')}`)
      else if (json.status === 'ready') setMessage('Short listo. Ábrelo para revisarlo y aprobarlo.')
      else if (json.status === 'exists') setMessage(`Ya hay un Short de hoy (${STATUS_LABEL[json.shortStatus]?.[0] ?? json.shortStatus}).`)
      else if (json.status === 'discarded') setMessage(`Hoy no se crea Short: ${REASONS[json.reason] ?? json.reason}.`)
      else setMessage(json.error ?? 'Respuesta inesperada')
    } catch (e) { setError(e instanceof Error ? e.message : 'Error de red') }
    setBusy(false); void load()
  }

  const missing = reqs.filter(r => !r.present && r.level !== 'optional')
  const todayDiscarded = shorts.some(s => s.status === 'discarded')

  return <StudioShell title="Fábrica de Shorts">
    <div className="hero"><div><small>AUTOMATIZACIÓN · UMBRAL DEL HITO</small><h2>1 Short de curiosidades al día</h2>
      <p>Tema con interés comprobado → dato con ≥2 fuentes → guion → voz e imágenes gratuitas. El vídeo se renderiza en tu navegador al abrir cada Short; nada se sube sin tu aprobación y siempre como privado.</p></div>
      <div className="status"><b>{shorts.filter(s => s.status === 'ready_for_approval').length}</b><span>pendientes de aprobar</span><span>Gasto: solo capas gratuitas</span><span>Publicación pública: manual</span></div></div>

    {missing.length > 0 && <div className={css.missing}><b>Faltan credenciales para funcionar:</b>
      <ul>{missing.map(m => <li key={m.name}><code>{m.name}</code> — {m.purpose}{m.level === 'upload' ? ' (necesaria para subir/medir)' : ''}</li>)}</ul></div>}

    <div className={css.row}>
      <button disabled={busy} onClick={() => prepare(false)}>{busy ? 'Preparando…' : 'Preparar Short de hoy'}</button>
      {todayDiscarded && <button className="secondaryButton" style={{ margin: 0 }} disabled={busy} onClick={() => prepare(true)}>Reintentar hoy</button>}
    </div>
    {message && <p className="connectionStatus">{message}</p>}
    {error && <p className="error">{error}</p>}

    <div className={css.list}>
      {shorts.length === 0 && <p className="emptyState">Todavía no hay Shorts.</p>}
      {shorts.map(s => {
        const [label, tone] = STATUS_LABEL[s.status] ?? [s.status, '']
        return <Link key={s.id} href={`/automations/shorts/${s.id}`} className={css.item}>
          <div><h3>{s.title ?? s.topic ?? 'Sin tema'}</h3>
            <p>{s.run_date}{s.category ? ` · ${s.category}` : ''}{s.discard_reason ? ` · ${REASONS[s.discard_reason] ?? s.discard_reason}` : ''}</p></div>
          <span className={`${css.badge} ${css[tone] ?? ''}`}>{label}</span>
        </Link>
      })}
    </div>
  </StudioShell>
}
