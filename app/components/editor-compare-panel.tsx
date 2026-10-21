'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { parseComposition, type Composition } from '@/lib/editor/composition'
import { compareLanes, laneOfComposition, laneOfSnapshot, type Lane } from '@/lib/editor/compare'
import { CompareView, ComparisonTable } from './compare-view'

type Other = { id: string; title: string; updatedAt: string; manual: boolean; comp: Composition }

/** Manual montage vs automatic montage, side by side: the version it came from, or any other saved montage of the project. */
export function EditorComparePanel({ comp, jobId, projectId, beatsMs }: { comp: Composition; jobId: string; projectId: string; beatsMs: number[] }) {
  const supabase = getSupabaseBrowserClient()
  const [others, setOthers] = useState<Other[] | null>(null)
  const [pick, setPick] = useState<string>(comp.autoSnapshot ? 'snapshot' : '')
  const [tol, setTol] = useState(250)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open || others) return
    void supabase.from('render_jobs').select('id,updated_at,composition').eq('project_id', projectId).eq('status', 'draft').neq('id', jobId).order('updated_at', { ascending: false }).limit(30)
      .then(({ data }: { data: Array<{ id: string; updated_at: string; composition: unknown }> | null }) => setOthers((data ?? []).flatMap(r => { const p = parseComposition(r.composition); return p ? [{ id: r.id, title: p.title || 'Sin título', updatedAt: r.updated_at, manual: p.editedManually === true, comp: p }] : [] })))
  }, [open, others, supabase, projectId, jobId])

  const mine = useMemo(() => laneOfComposition(comp, 'Mi montaje'), [comp])
  const theirs: Lane | null = useMemo(() => {
    if (pick === 'snapshot' && comp.autoSnapshot) return laneOfSnapshot(comp.autoSnapshot, 'Automático')
    const o = others?.find(x => x.id === pick)
    return o ? laneOfComposition(o.comp, o.manual ? `«${o.title}»` : `Automático «${o.title}»`) : null
  }, [pick, comp.autoSnapshot, others])
  const cmp = useMemo(() => (theirs ? compareLanes(mine, theirs, { toleranceMs: tol, beats: beatsMs }) : null), [mine, theirs, tol, beatsMs])

  return <details className="panel" style={{ marginBottom: 12 }} open={open} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)} aria-label="Comparar montajes">
    <summary className="small"><b>Comparar mi montaje con el automático</b> <span className="muted">dónde coinciden los cortes y en qué se diferencian</span></summary>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
      <div className="field-row" style={{ alignItems: 'end' }}>
        <label>Comparar con<select value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">— Elegir</option>
          {comp.autoSnapshot && <option value="snapshot">El montaje automático del que partió este ({comp.autoSnapshot.clips.length} clips)</option>}
          {(others ?? []).map(o => <option key={o.id} value={o.id}>{o.manual ? 'Manual' : 'Automático'} · {o.title} · {new Date(o.updatedAt).toLocaleDateString()}</option>)}
        </select></label>
        <label>Cortes «iguales» si distan menos de {tol} ms<input type="range" min={50} max={1000} step={50} value={tol} onChange={e => setTol(Number(e.target.value))} /></label>
      </div>
      {!comp.autoSnapshot && <p className="muted small">Este montaje se abrió en manual antes de que se guardara su versión automática, así que solo puedes compararlo con otros montajes guardados del proyecto.</p>}
      {others && others.length === 0 && !comp.autoSnapshot && <p className="muted small">No hay otros montajes guardados en este proyecto.</p>}
      {theirs && cmp && <>
        <CompareView a={mine} b={theirs} beats={beatsMs} toleranceMs={tol} />
        <ComparisonTable a={mine} b={theirs} />
        <b className="small">Diferencias</b>
        <ul className="small" style={{ margin: '0 0 0 18px' }}>{cmp.differences.map(d => <li key={d}>{d}</li>)}</ul>
        <p className="muted small">No se puntúa cuál es mejor: solo se muestra qué cambia para que decidas tú.</p>
      </>}
    </div>
  </details>
}
