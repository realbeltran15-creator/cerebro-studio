'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { mediaDuration, uploadProjectMedia, validateUpload } from '@/lib/media-upload'
import { classifyKind, CONTENT_ID_NOTE, importProblems, importProvenance, steps, TOPMEDIAI_URL, type ImportKind, type TopMediaiPlan } from '@/lib/providers/topmediai-import'
import { Icon } from './studio-icon'

type Row = { file: File; title: string; kind: ImportKind; durationSeconds: number | null; prompt: string; status: 'ready' | 'importing' | 'done' | 'error'; error?: string }
const kindLabel: Record<ImportKind, string> = { music: 'Música', sfx: 'Efecto de sonido', voice: 'Voz' }

/**
 * "Importar desde TopMediai". TopMediai's API is sold separately from its consumer subscriptions,
 * so nothing is automated here: you download your own files from your account and drop them in.
 * The licence recorded depends on the plan you confirm; see lib/providers/topmediai-import.ts.
 */
export function TopMediaiImport({ projectId, sceneId, onImported }: { projectId: string; sceneId?: string | null; onImported?: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const [rows, setRows] = useState<Row[]>([])
  const [plan, setPlan] = useState<TopMediaiPlan>('paid')
  const [confirmedPaid, setConfirmedPaid] = useState(false)
  const [certificate, setCertificate] = useState('')
  const [model, setModel] = useState('')
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function pick(files: FileList | null) {
    setError(''); setNotice('')
    const list = Array.from(files ?? [])
    const problems = importProblems(list)
    if (problems.length) { setError(problems.join(' ')); setRows([]); return }
    const next: Row[] = []
    for (const file of list) {
      const durationSeconds = await mediaDuration(file)
      const kind = classifyKind({ name: file.name, durationSeconds })
      const bad = validateUpload(kind, file)
      next.push({ file, title: file.name.replace(/\.[^.]+$/, ''), kind, durationSeconds, prompt: '', status: bad ? 'error' : 'ready', error: bad ?? undefined })
    }
    setRows(next)
  }

  const update = (i: number, patch: Partial<Row>) => setRows(list => list.map((r, k) => k === i ? { ...r, ...patch } : r))

  async function run() {
    if (!projectId || busy) return
    setBusy(true); setError(''); setNotice('')
    let done = 0
    for (const [i, row] of rows.entries()) {
      if (row.status === 'done') continue
      const bad = validateUpload(row.kind, row.file)
      if (bad) { update(i, { status: 'error', error: bad }); continue }
      update(i, { status: 'importing', error: undefined })
      try {
        const { license, extra } = importProvenance({ title: row.title, kind: row.kind, plan, confirmedPaid, prompt: row.prompt, model, certificate, originalFilename: row.file.name })
        await uploadProjectMedia(supabase, {
          projectId, kind: row.kind, file: row.file, title: row.title || row.file.name, license: license.status, licenseNotes: license.notes,
          sourceUrl: TOPMEDIAI_URL, provider: 'topmediai', extra: { ...extra, sceneId: sceneId ?? null },
        })
        update(i, { status: 'done' }); done++
      } catch (e) { update(i, { status: 'error', error: e instanceof Error ? e.message : 'No se pudo importar.' }) }
    }
    setBusy(false)
    if (done) { setNotice(`${done} archivo(s) importados desde TopMediai con su licencia registrada.`); onImported?.() }
  }

  const licensed = plan === 'paid' && confirmedPaid
  const pending = rows.filter(r => r.status !== 'done')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ margin: 0 }}>
        <b>Importar archivos generados en TopMediai</b>
        <p className="muted small" style={{ margin: '6px 0' }}>
          La API de TopMediai se contrata aparte de tus suscripciones (según su propia FAQ no está incluida en los planes), así que Cerebro no se conecta a tu cuenta ni automatiza su web.
          Descarga tus archivos y arrástralos aquí.
        </p>
        <ol className="muted small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{steps.map(s => <li key={s}>{s}</li>)}</ol>
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          <a href={TOPMEDIAI_URL} target="_blank" rel="noopener noreferrer">Abrir TopMediai</a> · {CONTENT_ID_NOTE}
        </p>
      </div>

      <div className="field-row">
        <label htmlFor="tm-plan">Plan al generar los archivos
          <select id="tm-plan" value={plan} onChange={e => { setPlan(e.target.value as TopMediaiPlan); if (e.target.value === 'free') setConfirmedPaid(false) }}>
            <option value="paid">Plan de pago (licencia comercial)</option>
            <option value="free">Plan gratuito (uso personal)</option>
          </select>
        </label>
        <label htmlFor="tm-cert">Certificado de licencia (enlace o nota)
          <input id="tm-cert" value={certificate} onChange={e => setCertificate(e.target.value)} maxLength={300} placeholder="Ej.: PDF guardado en Drive / carpeta Licencias" disabled={plan === 'free'} />
        </label>
        <label htmlFor="tm-model">Modelo de TopMediai (opcional)
          <input id="tm-model" value={model} onChange={e => setModel(e.target.value)} maxLength={80} placeholder="Ej.: V4.5" />
        </label>
      </div>
      {plan === 'paid' && (
        <label className="toggle">
          <input type="checkbox" checked={confirmedPaid} onChange={e => setConfirmedPaid(e.target.checked)} />
          Confirmo que estos archivos se generaron con un plan de pago activo de TopMediai
        </label>
      )}
      <p className={licensed ? 'notice' : 'muted small'} role="status">
        {licensed ? 'Se guardarán como «Con licencia». Revisa el certificado de cada pista antes de monetizar.' : 'Se guardarán como «Restringido (no comercial)»: así no se usan por error en una publicación comercial.'}
      </p>

      <label htmlFor="tm-files">Archivos de audio descargados de TopMediai
        <input key={fileKey} id="tm-files" type="file" accept="audio/*" multiple onChange={e => void pick(e.target.files)} />
      </label>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {rows.length > 0 && (
        <div className="list">
          {rows.map((r, i) => (
            <div key={`${r.file.name}-${i}`} className="listItem" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ minWidth: 200, flex: 1 }}>
                <input aria-label="Título" value={r.title} onChange={e => update(i, { title: e.target.value })} maxLength={160} disabled={r.status === 'done'} />
                <span className="muted small" style={{ display: 'block' }}>{r.file.name} · {(r.file.size / 1e6).toFixed(1)} MB{r.durationSeconds !== null ? ` · ${Math.round(r.durationSeconds)} s` : ''}</span>
              </div>
              <select aria-label="Tipo" value={r.kind} onChange={e => update(i, { kind: e.target.value as ImportKind })} disabled={r.status === 'done'} style={{ width: 'auto' }}>
                {(Object.keys(kindLabel) as ImportKind[]).map(k => <option key={k} value={k}>{kindLabel[k]}</option>)}
              </select>
              <input aria-label="Prompt o letra" value={r.prompt} onChange={e => update(i, { prompt: e.target.value })} placeholder="Prompt o descripción (opcional)" maxLength={1000} disabled={r.status === 'done'} style={{ flex: 2, minWidth: 220 }} />
              <span className={r.status === 'done' ? 'pill ok' : r.status === 'error' ? 'pill warn' : 'pill'}>{r.status === 'done' ? 'Importado' : r.status === 'importing' ? 'Subiendo…' : r.status === 'error' ? 'Error' : 'Listo'}</span>
              {r.error && <span className="jobErr" style={{ width: '100%' }}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}

      <div>
        <button type="button" disabled={busy || !projectId || pending.length === 0} onClick={() => void run()}>
          <Icon name="upload" size={16} />{busy ? 'Importando…' : `Importar ${pending.length || ''} archivo(s) al proyecto`}
        </button>
        {rows.length > 0 && !busy && <button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => { setRows([]); setFileKey(k => k + 1) }}>Vaciar</button>}
      </div>
    </div>
  )
}
