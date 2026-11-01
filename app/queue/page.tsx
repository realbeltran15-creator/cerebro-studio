'use client'

import { useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

type Step = { name: string; status: string; attempts?: number; durationMs?: number | null; error?: { code: string; message: string } | null }
type JobRow = { id: string; kind: string; status: string; dry_run: boolean; current_step: string | null; awaiting_reason: string | null; steps: Step[]; result: { qc?: { verdict?: string; reasons?: string[] } } | null; error: { code: string; message: string } | null; created_at: string }

/** Panel de SOLO LECTURA de la cola. Lee con la sesion del usuario (RLS: solo sus trabajos). Si la tabla no existe/no esta activa, lo dice. */
export default function QueuePage() {
  const supabase = getSupabaseBrowserClient()
  const [jobs, setJobs] = useState<JobRow[] | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from('job_queue').select('id,kind,status,dry_run,current_step,awaiting_reason,steps,result,error,created_at').order('created_at', { ascending: false }).limit(50)
      if (error) { setNote('La cola no esta activada en este entorno.'); setJobs([]); return }
      setJobs((data ?? []) as JobRow[])
    })()
  }, [supabase])

  return (
    <StudioShell>
      <h1>Cola de trabajos (solo lectura · simulación)</h1>
      {note && <p>{note}</p>}
      {jobs === null ? <p>Cargando…</p> : jobs.length === 0 && !note ? <p>No hay trabajos.</p> : (
        <ul>
          {jobs.map(j => (
            <li key={j.id}>
              <strong>{j.kind}</strong> · {j.status}{j.dry_run ? ' · simulación' : ''}{j.awaiting_reason ? ` · espera: ${j.awaiting_reason}` : ''}
              {j.error && <div>Error: {j.error.code}</div>}
              {j.result?.qc?.verdict && <div>QC: {j.result.qc.verdict} {j.result.qc.reasons?.join(', ')}</div>}
              <ol>{j.steps.map(s => <li key={s.name}>{s.name}: {s.status}{s.durationMs != null ? ` (${s.durationMs} ms)` : ''}{s.error ? ` — ${s.error.code}` : ''}</li>)}</ol>
            </li>
          ))}
        </ul>
      )}
    </StudioShell>
  )
}
