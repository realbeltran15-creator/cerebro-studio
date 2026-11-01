import { randomUUID } from 'node:crypto'
import { hashPayload } from './hash'
import type { Approval, ApprovalAction, Job, JobStatus, QueueStore, StepState } from './types'

/** Almacen en memoria con la misma semantica que job_queue + claim_next_job (para simulacion y tests). */
export function createMemoryStore(): QueueStore & { all(): Job[] } {
  const jobs = new Map<string, Job>()
  const approvals: Approval[] = []
  const owns = (j: Job | undefined, token: string): j is Job => !!j && j.status === 'running' && j.claimToken === token

  return {
    all: () => [...jobs.values()].map(j => ({ ...j })),
    enqueue: (n, now) => {
      for (const j of jobs.values()) {
        if (j.ownerId === n.ownerId && j.kind === n.kind && j.idempotencyKey === n.idempotencyKey) return { job: { ...j }, created: false }
      }
      const payload = n.payload ?? {}
      const job: Job = {
        id: randomUUID(), ownerId: n.ownerId, projectId: n.projectId ?? null, kind: n.kind, status: 'pending',
        idempotencyKey: n.idempotencyKey, payload, payloadHash: hashPayload(payload), priority: n.priority ?? 100,
        availableAt: now, attempts: 0, maxAttempts: n.maxAttempts ?? 3, executorId: null, claimToken: null,
        leaseExpiresAt: null, cancelRequested: false, currentStep: null, steps: [], result: null, error: null,
        awaitingReason: null, dryRun: n.dryRun ?? true, createdAt: now, updatedAt: now,
      }
      jobs.set(job.id, job)
      return { job: { ...job }, created: true }
    },
    get: id => { const j = jobs.get(id); return j ? structuredClone(j) : null },
    claim: (executorId, leaseMs, now) => {
      const ready = [...jobs.values()].filter(j =>
        (j.status === 'pending' && j.availableAt <= now) || (j.status === 'running' && (j.leaseExpiresAt ?? 0) < now),
      ).sort((a, b) => a.priority - b.priority || a.availableAt - b.availableAt)
      const j = ready[0]
      if (!j) return null
      j.status = 'running'; j.executorId = executorId; j.claimToken = randomUUID()
      j.leaseExpiresAt = now + leaseMs; j.attempts += 1; j.updatedAt = now
      return structuredClone(j)
    },
    heartbeat: (id, token, leaseMs, now) => {
      const j = jobs.get(id); if (!owns(j, token)) return false
      j.leaseExpiresAt = now + leaseMs; j.updatedAt = now; return true
    },
    saveSteps: (id, token, steps: StepState[], currentStep, now) => {
      const j = jobs.get(id); if (!owns(j, token)) return false
      j.steps = structuredClone(steps); j.currentStep = currentStep; j.updatedAt = now; return true
    },
    finish: (id, token, patch, now) => {
      const j = jobs.get(id); if (!owns(j, token)) return false
      j.status = patch.status as JobStatus
      if (patch.result !== undefined) j.result = patch.result
      j.error = patch.error ?? null
      j.awaitingReason = patch.awaitingReason ?? null
      if (patch.availableAt !== undefined) j.availableAt = patch.availableAt
      j.executorId = null; j.claimToken = null; j.leaseExpiresAt = null; j.updatedAt = now
      return true
    },
    requeue: (id, token, availableAt, now) => {
      const j = jobs.get(id); if (!owns(j, token)) return false
      j.status = 'pending'; j.availableAt = availableAt; j.executorId = null; j.claimToken = null; j.leaseExpiresAt = null; j.updatedAt = now
      return true
    },
    requestCancel: (id, ownerId, now) => {
      const j = jobs.get(id); if (!j || j.ownerId !== ownerId) return false
      if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') return false
      if (j.status === 'running') { j.cancelRequested = true } else { j.status = 'cancelled'; j.cancelRequested = true }
      j.updatedAt = now; return true
    },
    resume: (id, ownerId, now) => {
      const j = jobs.get(id); if (!j || j.ownerId !== ownerId || j.status !== 'awaiting_approval') return false
      j.status = 'pending'; j.awaitingReason = null; j.availableAt = now; j.updatedAt = now; return true
    },
    approvals: {
      grant: a => { approvals.push({ ...a }) },
      revoke: (jobId, step, action: ApprovalAction, now) => {
        for (const a of approvals) if (a.jobId === jobId && a.step === step && a.action === action && !a.revokedAt) a.revokedAt = now
      },
      find: (jobId, step, action) => {
        const m = approvals.filter(a => a.jobId === jobId && a.step === step && a.action === action)
        return m.length ? { ...m[m.length - 1] } : null
      },
    },
  }
}
