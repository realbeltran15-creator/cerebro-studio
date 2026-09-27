'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { applyAutomated, avSyncCheck, decide, flickerCheck, newReport, overall, qualityChecks, resolutionCheck, type CheckResult, type SubjectKind } from '@/lib/virtual-influencer/quality'
import { measureImage, measureVideo } from '@/lib/virtual-influencer/measure'

const statusLabel = { pending: 'Pendiente', pass: 'Correcto', fail: 'Fallo' } as const

/** Quality review for one subject. Human checks are decided here; automated checks only take real measurements. */
export function QualityReview({ personaId, subjectType, subjectId, kind, mediaUrl, readOnly }: {
  personaId: string; subjectType: 'identity_version' | 'generation_job'; subjectId: string; kind: SubjectKind; mediaUrl?: string | null; readOnly?: boolean
}) {
  const supabase = getSupabaseBrowserClient()
  const [checks, setChecks] = useState<CheckResult[] | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [measuring, setMeasuring] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('vi_quality_reports').select('id,checks').eq('subject_type', subjectType).eq('subject_id', subjectId).maybeSingle()
    const row = data as { id: string; checks: CheckResult[] } | null
    const base = newReport(kind)
    // Keep stored decisions for checks that still apply; add any new checks as pending.
    const merged = base.map(c => row?.checks?.find(s => s.id === c.id) ?? c)
    setReportId(row?.id ?? null); setChecks(merged)
  }, [supabase, subjectType, subjectId, kind])
  useEffect(() => { void load() }, [load])

  async function persist(next: CheckResult[]) {
    setError('')
    const now = new Date().toISOString()
    if (reportId) {
      const { error: e } = await supabase.from('vi_quality_reports').update({ checks: next, overall: overall(next), updated_at: now }).eq('id', reportId)
      if (e) { setError(e.message); return }
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error: e } = await supabase.from('vi_quality_reports').insert({ owner_id: user!.id, persona_id: personaId, subject_type: subjectType, subject_id: subjectId, checks: next, overall: overall(next) }).select('id').single()
      if (e) { setError(e.message); return }
      setReportId((data as { id: string }).id)
    }
    setChecks(next)
  }

  async function measure() {
    if (!mediaUrl || !checks) return
    setMeasuring(true); setError('')
    try {
      const results: CheckResult[] = []
      if (kind === 'image') { const m = await measureImage(mediaUrl); results.push(resolutionCheck('image', m.width, m.height)) }
      if (kind === 'video' || kind === 'lipsync') {
        const m = await measureVideo(mediaUrl)
        results.push(resolutionCheck(kind, m.width, m.height), avSyncCheck(m.durationMs, m.audioDurationMs), flickerCheck(m.lumas))
      }
      await persist(applyAutomated(checks, results))
    } catch (e) { setError(e instanceof Error ? `No se pudo medir: ${e.message}` : 'No se pudo medir.') } finally { setMeasuring(false) }
  }

  if (!checks) return <p className="muted small">Cargando revisión…</p>
  const state = overall(checks)
  const hasAutomated = checks.some(c => c.method === 'automated')
  return <div className="viChecks">
    <div className="cardHead" style={{ marginBottom: 0 }}>
      <b>Revisión de calidad</b>
      <span className={state === 'pass' ? 'pill ok' : state === 'fail' ? 'pill bad' : 'pill warn'}>{state === 'pass' ? 'Superada' : state === 'fail' ? 'Con fallos' : 'Pendiente'}</span>
    </div>
    {hasAutomated && <div>
      <button type="button" className="ghost" disabled={!mediaUrl || measuring || readOnly} onClick={() => void measure()}>{measuring ? 'Midiendo…' : 'Medir controles automáticos'}</button>
      {!mediaUrl && <span className="muted small"> · Sin archivo que medir todavía.</span>}
    </div>}
    {error && <p className="error small" role="alert">{error}</p>}
    {checks.map(c => {
      const def = qualityChecks.find(d => d.id === c.id)!
      return <div key={c.id} className="viCheck">
        <div>
          <b className="small">{def.label}</b> <span className="pill">{c.method === 'automated' ? 'Medido' : 'Revisión humana'}</span>
          <span className="muted small" style={{ display: 'block' }}>{def.guidance}</span>
          {c.method === 'human' && def.automationNeeds && <span className="muted small" style={{ display: 'block' }}>Automatización pendiente: {def.automationNeeds} (no conectado).</span>}
          {c.note && <span className="small" style={{ display: 'block' }}>{c.note}</span>}
          {c.method === 'human' && !readOnly && <input className="small" placeholder="Nota de la revisión" value={notes[c.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))} style={{ marginTop: 6, width: '100%' }} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <span className={c.status === 'pass' ? 'pill ok' : c.status === 'fail' ? 'pill bad' : 'pill'}>{statusLabel[c.status]}</span>
          {c.method === 'human' && !readOnly && <div className="pageActions">
            <button type="button" className="ghost small" onClick={() => void persist(decide(checks, c.id, 'pass', notes[c.id] ?? c.note ?? null))}>Correcto</button>
            <button type="button" className="ghost small" onClick={() => void persist(decide(checks, c.id, 'fail', notes[c.id] ?? c.note ?? null))}>Fallo</button>
          </div>}
        </div>
      </div>
    })}
  </div>
}
