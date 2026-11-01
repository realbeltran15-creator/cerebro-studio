import { isFreeCost, type BudgetLedger, type Cost } from '@/lib/budget/ledger'
import { decide, StepError } from './policy'
import type { ApprovalAction, Job, QueueStore, StepState } from './types'

export type StepKind = 'safe' | 'irreversible'

export type StepContext = {
  job: Job
  /** Clave de idempotencia del paso: pasarla al proveedor para que un reintento no duplique. */
  stepKey: string
  signal: AbortSignal
  dryRun: boolean
  /** Resultados de pasos anteriores. */
  previous: Record<string, unknown>
  isCancelled(): boolean
  heartbeat(): boolean
}
export type StepOutput = { result?: unknown; actualCost?: Cost }

export type StepDef = {
  name: string
  /** irreversible = puede cobrar o publicar: nunca se reintenta solo y exige aprobacion sellada. */
  kind: StepKind
  provider?: string
  estimate?: (job: Job) => Cost
  requiresApproval?: ApprovalAction
  retryOn429?: boolean
  timeoutMs?: number
  run(ctx: StepContext): Promise<StepOutput>
}

export type Registry = Record<string, StepDef[]>

export type ExecutorDeps = {
  store: QueueStore
  ledger: BudgetLedger
  registry: Registry
  executorId: string
  leaseMs?: number
  now: () => number
}

export type RunOutcome =
  | { outcome: 'idle' }
  | { outcome: 'completed' | 'failed' | 'cancelled' | 'awaiting_approval' | 'requeued' | 'lease_lost'; jobId: string; reason?: string }

const DEFAULT_TIMEOUT = 60_000

function withTimeout<T>(p: Promise<T>, ms: number, ac: AbortController): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => { ac.abort(); rej(new StepError(`El paso superó ${ms} ms`, { code: 'timeout' })) }, ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(t))
}

function approvalProblem(store: QueueStore, job: Job, def: StepDef, action: ApprovalAction, cost: Cost, now: number): string | null {
  const a = store.approvals.find(job.id, def.name, action)
  if (!a) return 'approval_missing'
  if (a.revokedAt) return 'approval_revoked'
  if (a.expiresAt <= now) return 'approval_expired'
  if (a.payloadHash !== job.payloadHash) return 'approval_invalidated'
  if (a.maxCost) {
    for (const [unit, v] of Object.entries(cost)) {
      const cap = (a.maxCost as Record<string, number | null | undefined>)[unit]
      if (typeof v === 'number' && v > 0 && (cap === undefined || cap === null || v > cap)) return 'approval_insufficient'
    }
  }
  return null
}

/** Ejecuta como maximo un trabajo (reclamo atomico). Pensado para llamarse en bucle desde un worker (4B.1+). */
export async function runOnce(d: ExecutorDeps): Promise<RunOutcome> {
  const leaseMs = d.leaseMs ?? 60_000
  const claimed = d.store.claim(d.executorId, leaseMs, d.now())
  if (!claimed) return { outcome: 'idle' }
  const token = claimed.claimToken as string
  const id = claimed.id
  const lost = (): RunOutcome => ({ outcome: 'lease_lost', jobId: id })
  const fin = (status: 'completed' | 'failed' | 'cancelled' | 'awaiting_approval', patch: { result?: unknown; error?: Job['error']; awaitingReason?: string | null } = {}): RunOutcome =>
    d.store.finish(id, token, { status, ...patch }, d.now()) ? { outcome: status, jobId: id, reason: patch.awaitingReason ?? patch.error?.code } : lost()

  const defs = d.registry[claimed.kind]
  if (!defs) return fin('failed', { error: { code: 'unknown_kind', message: `Tipo de trabajo desconocido: ${claimed.kind}`, retryable: false } })
  if (claimed.attempts > claimed.maxAttempts) {
    return fin('failed', { error: { code: 'max_attempts_exceeded', message: 'Se agotaron los intentos (recuperaciones de lease incluidas).', retryable: false } })
  }

  const steps: StepState[] = defs.map(s => claimed.steps.find(x => x.name === s.name) ?? { name: s.name, status: 'pending', attempts: 0 })
  const previous: Record<string, unknown> = {}
  const save = (cur: string | null) => d.store.saveSteps(id, token, steps, cur, d.now())

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]
    const st = steps[i]
    if (st.status === 'completed' || st.status === 'skipped') { previous[def.name] = st.result; continue }

    if (!d.store.heartbeat(id, token, leaseMs, d.now())) return lost()
    const fresh = d.store.get(id)
    if (!fresh) return lost()
    if (fresh.cancelRequested) return fin('cancelled', { result: { completedSteps: steps.filter(s => s.status === 'completed').map(s => s.name) } })

    const job = fresh
    const cost: Cost = def.estimate?.(job) ?? {}
    const free = isFreeCost(cost)
    const stepKey = `${id}:${def.name}`

    // Configuracion peligrosa: se rechaza antes de tocar nada.
    if ((def.kind === 'irreversible' && !def.requiresApproval) || (!free && def.kind !== 'irreversible')) {
      st.status = 'failed'; st.error = { code: 'misconfigured_step', message: 'Un paso con efectos externos o coste debe ser irreversible y exigir aprobacion.' }
      save(def.name)
      return fin('failed', { error: { code: 'misconfigured_step', message: st.error.message, retryable: false } })
    }

    // Simulacion: lo que cobra o publica no se ejecuta.
    if (job.dryRun && (def.kind === 'irreversible' || !free)) {
      st.status = 'skipped'; st.result = { simulated: true }; previous[def.name] = st.result
      if (!save(def.name)) return lost()
      continue
    }

    // Paso que quedo «running» (caida a mitad): si es irreversible no se repite sin revision humana.
    let consumeRetryApproval = false
    if (st.status === 'running' && def.kind === 'irreversible') {
      const p = approvalProblem(d.store, job, def, 'retry_uncertain', {}, d.now())
      if (p) return fin('awaiting_approval', { awaitingReason: 'uncertain_outcome' })
      consumeRetryApproval = true
    }

    if (def.requiresApproval) {
      const p = approvalProblem(d.store, job, def, def.requiresApproval, cost, d.now())
      if (p) return fin('awaiting_approval', { awaitingReason: p })
    }

    if (!free) {
      const r = d.ledger.reserve({ ownerId: job.ownerId, jobId: id, step: def.name, provider: def.provider ?? 'unknown', projectId: job.projectId, cost, keyBase: stepKey, now: new Date(d.now()) })
      if (!r.ok) {
        st.status = 'failed'; st.error = { code: r.code, message: `Presupuesto: ${r.code} (${r.unit})` }
        save(def.name)
        return fin('failed', { error: { code: r.code, message: st.error.message, retryable: false } })
      }
    }

    st.status = 'running'; st.attempts += 1
    if (!save(def.name)) return lost()
    if (consumeRetryApproval) d.store.approvals.revoke(id, def.name, 'retry_uncertain', d.now())

    const ac = new AbortController()
    try {
      const out = await withTimeout(def.run({
        job, stepKey, signal: ac.signal, dryRun: job.dryRun, previous: { ...previous },
        isCancelled: () => d.store.get(id)?.cancelRequested === true,
        heartbeat: () => d.store.heartbeat(id, token, leaseMs, d.now()),
      }), def.timeoutMs ?? DEFAULT_TIMEOUT, ac)
      // Si perdimos el lease mientras el paso corria, NO escribimos nada (otro ejecutor es el dueno).
      if (!d.store.heartbeat(id, token, leaseMs, d.now())) return lost()
      if (!free) d.ledger.settle(stepKey, job.ownerId, out.actualCost ?? {})
      st.status = 'completed'; st.result = out.result ?? null; st.error = undefined; previous[def.name] = st.result
      if (!save(def.name)) return lost()
    } catch (err) {
      const dec = decide({ error: err, stepKind: def.kind, retryOn429: def.retryOn429 === true, jobAttempts: job.attempts, maxAttempts: job.maxAttempts })
      if (dec.action === 'retry') {
        st.status = 'pending'; st.error = { code: dec.code, message: err instanceof Error ? err.message : String(err) }
        if (!save(def.name)) return lost()
        return d.store.requeue(id, token, d.now() + dec.delayMs, d.now()) ? { outcome: 'requeued', jobId: id, reason: dec.code } : lost()
      }
      if (dec.action === 'await') {
        st.error = { code: dec.code, message: dec.message }     // el paso se queda «running»: no se libera la reserva
        if (!save(def.name)) return lost()
        return fin('awaiting_approval', { awaitingReason: dec.reason })
      }
      if (dec.releaseReservation && !free) d.ledger.release(stepKey, job.ownerId)
      st.status = 'failed'; st.error = { code: dec.code, message: dec.message }
      if (!save(def.name)) return lost()
      return fin('failed', { error: { code: dec.code, message: dec.message, httpStatus: dec.httpStatus, retryable: false } })
    }
  }

  const fresh = d.store.get(id)
  if (fresh?.cancelRequested) return fin('cancelled', { result: { completedSteps: steps.map(s => s.name) } })
  return fin('completed', { result: Object.fromEntries(steps.map(s => [s.name, s.result ?? null])) })
}
