import { operationLabels, operationState, type Evidence, type OperationState } from '@/lib/operation-state'

/**
 * Presentation layer over the EXISTING persisted statuses (no DB change). Every screen that shows a job, run or publication goes
 * through here, so the same work can never read «Completado» in one screen and «Pendiente/Incierto» in another.
 * Rule: «verified» only with evidence stored by the backend; time passing never turns an uncertain operation into a completed one.
 */
export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'neutral'
export type OperationView = { state: OperationState; label: string; tone: Tone; detail?: string }

export const operationTone: Record<OperationState, Tone> = {
  prepared: 'neutral', awaiting_approval: 'warn', running: 'info', verified: 'ok', failed: 'bad', cancelled: 'neutral', uncertain: 'warn',
}
export const toneClass = (t: Tone) => (t === 'neutral' ? 'pill' : `pill ${t}`)

function view(state: OperationState, detail?: string): OperationView {
  return { state, label: operationLabels[state], tone: operationTone[state], detail }
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** Publication job (YouTube / Instagram / TikTok). `published` without the platform's id is NOT verified. */
export function publicationView(job: { status: string; result?: Record<string, unknown> | null }): OperationView {
  const r = job.result ?? {}
  const check = r.youtubeCheck as { exists?: boolean; matches?: boolean } | undefined
  const hasId = Boolean(str(r.videoId) || str(r.mediaId) || str(r.publishId) || str(r.url))
  const evidence: Evidence = { outputExists: hasId && check?.exists !== false, outputVerified: check ? check.exists === true && check.matches === true : undefined }
  // An interrupted publish returns the job to «approved» with interruptedAt: it MAY have been published, so it is uncertain.
  const interrupted = Boolean(str(r.interruptedAt)) && (job.status === 'approved' || job.status === 'publishing')
  const state = operationState(job.status, evidence, { interrupted })
  if (state === 'uncertain' && interrupted) return view(state, 'La publicación se interrumpió: comprueba en la plataforma antes de reintentar.')
  if (state === 'uncertain' && job.status === 'published') return view(state, check && check.matches === false ? 'La comprobación en la plataforma no coincide con lo aprobado.' : 'Marcado como publicado pero sin identificador del vídeo.')
  if (state === 'prepared' && job.status === 'approved') return view(state, 'Aprobado · sin publicar')
  return view(state)
}

/** Virtual-influencer generation job. `approved` needs the stored output asset to count as verified. */
export function generationJobView(job: { status: string; output_asset_id?: string | null }): OperationView {
  if (job.status === 'blocked') return view('prepared', 'Bloqueado: faltan requisitos')
  if (job.status === 'approved') return view(job.output_asset_id ? 'verified' : 'uncertain', job.output_asset_id ? undefined : 'Aprobado sin archivo guardado')
  if (job.status === 'needs_review') return view('awaiting_approval', 'Pendiente de tu revisión de calidad')
  return view(operationState(job.status, { outputExists: Boolean(job.output_asset_id) }))
}

export const STALE_RUN_MS = 15 * 60 * 1000

/** Automation run: a run that has been «running» for more than 15 min is treated as interrupted (uncertain), never as success. */
export function automationRunView(run: { status: string; error?: string | null; started_at: string; finished_at?: string | null }, now = Date.now()): OperationView {
  const startedMs = Date.parse(run.started_at)
  const stale = run.status === 'running' && Number.isFinite(startedMs) && now - startedMs > STALE_RUN_MS
  if (stale) return view('uncertain', 'Ejecución sin terminar desde hace más de 15 min: puede haberse interrumpido.')
  const ok = run.status === 'succeeded' && !run.error && Boolean(run.finished_at)
  return view(operationState(run.status === 'succeeded' ? 'completed' : run.status, { outputVerified: ok }), run.status === 'succeeded' && !ok ? 'Terminó sin hora de cierre o con error registrado.' : undefined)
}

/** Shorts factory item. `published` = uploaded as private; it needs the stored video id. */
export function shortItemView(item: { status: string }, pub?: { status?: string; videoId?: string | null } | null): OperationView {
  if (item.status === 'discarded') return view('cancelled', 'Descartado')
  if (item.status === 'prepared') return view('awaiting_approval', 'Pendiente de tu revisión')
  if (item.status === 'approved') return view('prepared', 'Aprobado (sin subir)')
  if (item.status === 'published') return view(pub?.videoId ? 'verified' : 'uncertain', pub?.videoId ? 'Subido como privado' : 'Marcado como subido sin identificador del vídeo')
  return view(operationState(item.status))
}
