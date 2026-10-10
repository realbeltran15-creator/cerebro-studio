'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { confirmationMatches, deleteProject, deletionBlockers, impactLines, keptLines, loadImpact, type DeletionImpact } from '@/lib/projects/delete'

/**
 * "Eliminar proyecto": nothing is deleted until the person has seen what goes with it and typed the exact project name.
 * It is a deliberate two-step control, not a single button.
 */
export function DeleteProject({ project }: { project: { id: string; name: string } }) {
  const supabase = getSupabaseBrowserClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [impact, setImpact] = useState<DeletionImpact | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    setOpen(true); setError(''); setTyped('')
    try { setImpact(await loadImpact(supabase, project.id)) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo calcular qué se eliminaría.') }
  }

  async function confirm() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const r = await deleteProject(supabase, project, typed)
      const note = r.failedFiles ? ` (${r.failedFiles} archivo(s) no se pudieron borrar del almacenamiento)` : ''
      sessionStorage.setItem('cerebro.notice', `Proyecto «${project.name}» eliminado${note}.`)
      router.push('/projects')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar.'); setBusy(false) }
  }

  const blockers = impact ? deletionBlockers(impact) : []
  return <section id="eliminar" className="panel dangerZone" aria-labelledby="del-title" style={{ marginTop: 18 }}>
    <h3 id="del-title">Eliminar proyecto</h3>
    {!open && <>
      <p className="muted small">Borra el proyecto y todo lo que contiene. No se puede deshacer.</p>
      <button type="button" className="ghost" onClick={() => void start()}>Eliminar este proyecto…</button>
    </>}
    {open && <>
      <p><b>Vas a eliminar «{project.name}».</b> Se borrará de forma definitiva:</p>
      {!impact ? <p className="muted small">Calculando qué se eliminaría…</p> : <>
        <ul className="small" style={{ paddingLeft: 18 }}>{impactLines(impact).map(l => <li key={l}>{l}</li>)}{impactLines(impact).length === 0 && <li>El proyecto está vacío.</li>}</ul>
        {keptLines(impact).map(l => <p key={l} className="muted small">{l}.</p>)}
        <p className="muted small">No se toca nada en YouTube ni en otras plataformas.</p>
      </>}
      {blockers.map(b => <p key={b} className="warnBox" role="alert">{b}</p>)}
      <label htmlFor="del-confirm">Para confirmar, escribe el nombre exacto del proyecto
        <input id="del-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" placeholder={project.name} disabled={busy || blockers.length > 0} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="pageActions" style={{ marginTop: 10 }}>
        <button type="button" onClick={() => void confirm()} disabled={!impact || blockers.length > 0 || !confirmationMatches(typed, project.name) || busy}>{busy ? 'Eliminando…' : 'Eliminar definitivamente'}</button>
        <button type="button" className="ghost" onClick={() => { setOpen(false); setTyped('') }} disabled={busy}>Cancelar</button>
      </div>
    </>}
  </section>
}
