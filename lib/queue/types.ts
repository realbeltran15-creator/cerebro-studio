import type { Cost } from '@/lib/budget/ledger'

export type JobStatus = 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type StepState = {
  name: string
  status: StepStatus
  attempts: number
  /** Resultado del paso: un paso completado NUNCA se vuelve a ejecutar al reanudar. */
  result?: unknown
  error?: { code: string; message: string }
  /** Trazabilidad por etapa (ms desde epoch / duración / pasos de los que depende). */
  startedAt?: number
  durationMs?: number
  dependsOn?: string[]
}

export type JobError = { code: string; message: string; httpStatus?: number; retryable: boolean }

export type Job = {
  id: string
  ownerId: string
  projectId: string | null
  kind: string
  status: JobStatus
  idempotencyKey: string
  payload: Record<string, unknown>
  payloadHash: string
  priority: number
  availableAt: number
  attempts: number
  maxAttempts: number
  executorId: string | null
  claimToken: string | null
  leaseExpiresAt: number | null
  cancelRequested: boolean
  currentStep: string | null
  steps: StepState[]
  result: unknown
  error: JobError | null
  awaitingReason: string | null
  dryRun: boolean
  createdAt: number
  updatedAt: number
}

export type NewJob = {
  ownerId: string
  projectId?: string | null
  kind: string
  idempotencyKey: string
  payload?: Record<string, unknown>
  priority?: number
  maxAttempts?: number
  /** Simulacion por defecto (true): los pasos con efectos externos no se ejecutan. */
  dryRun?: boolean
}

export type ApprovalAction = 'spend' | 'render_batch' | 'publish' | 'retry_uncertain'
export type Approval = {
  jobId: string; step: string; action: ApprovalAction
  payloadHash: string; expiresAt: number; revokedAt: number | null
  /** Tope aprobado por unidad; si el coste estimado lo supera la aprobacion no vale. */
  maxCost?: Cost
}

/**
 * Almacen de la cola. Cada escritura de un ejecutor lleva el claimToken: si el lease cambio de manos
 * (caduco y otro ejecutor lo reclamo) la escritura se rechaza (fencing). La implementacion Supabase
 * (4B.1) usara claim_next_job y UPDATE ... WHERE claim_token = $token.
 */
export type SyncQueueStore = {
  /** Idempotente por (ownerId, kind, idempotencyKey): devuelve el existente sin crear otro. */
  enqueue(n: NewJob, now: number): { job: Job; created: boolean; /** La clave ya existia con OTRO payload: no se creo nada. */ payloadMismatch: boolean }
  get(id: string): Job | null
  /** `kinds`: solo reclama trabajos de esos tipos (un worker no debe tocar lo que no sabe ejecutar). */
  claim(executorId: string, leaseMs: number, now: number, kinds?: string[]): Job | null
  /** false si el token ya no es vigente. */
  heartbeat(id: string, token: string, leaseMs: number, now: number): boolean
  /** Reemplaza steps/currentStep. false = lease perdido. */
  saveSteps(id: string, token: string, steps: StepState[], currentStep: string | null, now: number): boolean
  finish(id: string, token: string, patch: { status: JobStatus; result?: unknown; error?: JobError | null; awaitingReason?: string | null; availableAt?: number }, now: number): boolean
  /** Devuelve el trabajo a la cola con espera (reintento seguro). */
  requeue(id: string, token: string, availableAt: number, now: number): boolean
  requestCancel(id: string, ownerId: string, now: number): boolean
  /** awaiting_approval -> pending (tras conceder una aprobacion). */
  resume(id: string, ownerId: string, now: number): boolean
  approvals: {
    grant(a: Approval): void
    revoke(jobId: string, step: string, action: ApprovalAction, now: number): void
    find(jobId: string, step: string, action: ApprovalAction): Approval | null
  }
}

export type { Cost }

/** Cualquier metodo puede ser sincrono (memoria) o asincrono (PostgreSQL). El ejecutor siempre hace await. */
export type MaybeAsync<T> = T | Promise<T>
export type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => MaybeAsync<R> : T[K] extends object ? Asyncify<T[K]> : T[K]
}
export type QueueStore = Asyncify<SyncQueueStore>
