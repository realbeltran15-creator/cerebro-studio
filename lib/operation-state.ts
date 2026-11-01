/**
 * Common vocabulary for every operation (publication, generation job, render, automation run):
 * prepared -> awaiting_approval -> running -> verified, plus failed / cancelled / uncertain shown SEPARATELY (never turned into success).
 * «verified» needs evidence that the output exists; a provider saying «done» is not enough.
 */
export type OperationState = 'prepared' | 'awaiting_approval' | 'running' | 'verified' | 'failed' | 'cancelled' | 'uncertain'

export const operationLabels: Record<OperationState, string> = {
  prepared: 'Preparado', awaiting_approval: 'Pendiente de aprobación', running: 'En ejecución', verified: 'Completado y verificado',
  failed: 'Fallido', cancelled: 'Cancelado', uncertain: 'Incierto: comprueba el resultado',
}

export type Evidence = { outputExists?: boolean; outputVerified?: boolean }

const PREPARED = new Set(['draft', 'queued', 'planned', 'ready', 'blocked'])
const AWAITING = new Set(['awaiting_approval', 'needs_review', 'pending_approval'])
const RUNNING = new Set(['running', 'publishing', 'processing', 'rendering', 'generating', 'in_progress'])
const DONE = new Set(['completed', 'published', 'succeeded', 'approved_output', 'done'])

/**
 * `approved` is a publication state meaning «authorized but not yet published», so it is awaiting execution (prepared), not success.
 * A «done» status without evidence of the output is `uncertain`, and an interrupted run (marker `interrupted`) is `uncertain` too.
 */
export function operationState(status: string, evidence: Evidence = {}, flags: { interrupted?: boolean } = {}): OperationState {
  const s = status.toLowerCase()
  if (flags.interrupted) return 'uncertain'
  if (s === 'failed' || s === 'error' || s === 'rejected' || s === 'expired') return 'failed'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  if (AWAITING.has(s)) return 'awaiting_approval'
  if (RUNNING.has(s)) return 'running'
  if (DONE.has(s)) return evidence.outputVerified || (evidence.outputExists && evidence.outputVerified !== false) ? 'verified' : 'uncertain'
  if (s === 'approved') return 'prepared'
  if (PREPARED.has(s)) return 'prepared'
  return 'uncertain'
}
