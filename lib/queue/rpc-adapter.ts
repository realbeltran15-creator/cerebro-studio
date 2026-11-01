/**
 * Adaptadores QueueStore y ledger sobre RPC: SOLO llaman a funciones SQL SECURITY DEFINER ya verificadas
 * (claim_next_job, finish_job, reserve_budget_multi…). No hay SQL suelto, asi que el mismo adaptador sirve con
 * supabase-js (`supabase.rpc(fn, args)`) en 4B.3. Hoy se prueba contra PostgreSQL local (lib/queue/dev/pg-rpc.ts).
 * Todas las escrituras del ejecutor llevan claim_token (fencing). Los tiempos los decide la base (now()), no el reloj del proceso.
 */
import type { AsyncBudgetLedger, BudgetUnit, Cost } from '@/lib/budget/ledger'
import { hashPayload } from './hash'
import type { Approval, ApprovalAction, Job, QueueStore } from './types'

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>
type Row = Record<string, unknown>

const ms = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : null)

export function mapJob(r: Row): Job {
  return {
    id: r.id as string, ownerId: r.owner_id as string, projectId: (r.project_id as string | null) ?? null, kind: r.kind as string,
    status: r.status as Job['status'], idempotencyKey: r.idempotency_key as string, payload: (r.payload as Record<string, unknown>) ?? {},
    payloadHash: r.payload_hash as string, priority: r.priority as number, availableAt: ms(r.available_at) ?? 0,
    attempts: r.attempts as number, maxAttempts: r.max_attempts as number, executorId: (r.executor_id as string | null) ?? null,
    claimToken: (r.claim_token as string | null) ?? null, leaseExpiresAt: ms(r.lease_expires_at), cancelRequested: r.cancel_requested === true,
    currentStep: (r.current_step as string | null) ?? null, steps: (r.steps as Job['steps']) ?? [], result: r.result ?? null,
    error: (r.error as Job['error']) ?? null, awaitingReason: (r.awaiting_reason as string | null) ?? null, dryRun: r.dry_run === true,
    createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
  }
}

const rowOrNull = (v: unknown): Row | null => (v && typeof v === 'object' && (v as Row).id ? (v as Row) : null)

export function createRpcStore(rpc: Rpc): QueueStore {
  const ownerOf = async (jobId: string) => {
    const j = rowOrNull(await rpc('get_job', { p_id: jobId }))
    return (j?.owner_id as string | undefined) ?? null
  }
  return {
    enqueue: async n => {
      const out = (await rpc('enqueue_job', {
        p_owner: n.ownerId, p_project: n.projectId ?? null, p_kind: n.kind, p_key: n.idempotencyKey, p_payload: n.payload ?? {},
        p_payload_hash: hashPayload(n.payload ?? {}), p_priority: n.priority ?? 100, p_max_attempts: n.maxAttempts ?? 3, p_dry_run: n.dryRun ?? true,
      })) as Row
      return { job: mapJob(out.job as Row), created: out.created === true, payloadMismatch: out.payload_mismatch === true }
    },
    get: async id => { const r = rowOrNull(await rpc('get_job', { p_id: id })); return r ? mapJob(r) : null },
    claim: async (executorId, leaseMs, _now, kinds) => {
      const r = rowOrNull(await rpc('claim_next_job', { p_executor: executorId, p_lease_seconds: Math.max(1, Math.ceil(leaseMs / 1000)), p_kinds: kinds ?? null }))
      return r ? mapJob(r) : null
    },
    heartbeat: async (id, token, leaseMs) => (await rpc('heartbeat_job', { p_id: id, p_token: token, p_lease_seconds: Math.max(1, Math.ceil(leaseMs / 1000)) })) === true,
    saveSteps: async (id, token, steps, currentStep) => (await rpc('save_job_steps', { p_id: id, p_token: token, p_steps: steps, p_current: currentStep })) === true,
    finish: async (id, token, patch) => (await rpc('finish_job', {
      p_id: id, p_token: token, p_status: patch.status, p_result: patch.result === undefined ? null : patch.result,
      p_error: patch.error ?? null, p_awaiting: patch.awaitingReason ?? null,
      p_available_at: patch.availableAt === undefined ? null : new Date(patch.availableAt).toISOString(),
    })) === true,
    requeue: async (id, token, availableAt) => (await rpc('finish_job', {
      p_id: id, p_token: token, p_status: 'pending', p_result: null, p_error: null, p_awaiting: null, p_available_at: new Date(availableAt).toISOString(),
    })) === true,
    requestCancel: async (id, ownerId) => (await rpc('request_cancel_job', { p_owner: ownerId, p_id: id })) === true,
    resume: async (id, ownerId) => (await rpc('resume_job', { p_owner: ownerId, p_id: id })) === true,
    approvals: {
      grant: async (a: Approval) => {
        const owner = await ownerOf(a.jobId)
        if (!owner) throw new Error('El trabajo no existe')
        await rpc('grant_approval', { p_owner: owner, p_job: a.jobId, p_step: a.step, p_action: a.action, p_payload_hash: a.payloadHash, p_max_amount: a.maxCost ?? {}, p_expires: new Date(a.expiresAt).toISOString() })
      },
      revoke: async (jobId: string, step: string, action: ApprovalAction) => {
        const owner = await ownerOf(jobId)
        if (owner) await rpc('revoke_approval', { p_owner: owner, p_job: jobId, p_step: step, p_action: action })
      },
      find: async (jobId: string, step: string, action: ApprovalAction) => {
        const r = (await rpc('get_approval', { p_job: jobId, p_step: step, p_action: action })) as Row | null
        if (!r) return null
        return { jobId, step, action, payloadHash: r.payload_hash as string, expiresAt: ms(r.expires_at) ?? 0, revokedAt: ms(r.revoked_at), maxCost: r.max_amount && Object.keys(r.max_amount as object).length ? (r.max_amount as Cost) : undefined }   // {} = sin tope propio (manda el límite diario)
      },
    },
  }
}

const UNITS: BudgetUnit[] = ['eur', 'usd', 'credits', 'quota']

export function createRpcLedger(rpc: Rpc): AsyncBudgetLedger {
  return {
    setLimit: async l => { await rpc('set_budget_limit', { p_owner: l.ownerId, p_provider: l.provider, p_project: l.projectId ?? null, p_unit: l.unit, p_limit: l.dailyLimit }) },
    reserve: async r => {
      const costs: Record<string, number | null> = {}
      for (const u of UNITS) if (r.cost[u] !== undefined) costs[u] = r.cost[u] as number | null
      const out = (await rpc('reserve_budget_multi', { p_owner: r.ownerId, p_job: r.jobId, p_step: r.step, p_provider: r.provider, p_project: r.projectId, p_costs: costs, p_key: r.keyBase })) as Row
      return out.ok === true ? { ok: true as const, reused: out.reused === true } : { ok: false as const, code: out.code as 'unknown_price' | 'budget_exhausted' | 'invalid_amount', unit: out.unit as BudgetUnit }
    },
    settle: async (keyBase, ownerId, actual: Cost) => {
      for (const u of UNITS) {
        const a = actual[u]
        await rpc('settle_budget', { p_owner: ownerId, p_keybase: keyBase, p_unit: u, p_actual: typeof a === 'number' ? a : null })
      }
    },
    release: async (keyBase, ownerId) => { await rpc('release_budget', { p_owner: ownerId, p_keybase: keyBase }) },
    markUncertain: async (keyBase, ownerId) => { await rpc('mark_budget_uncertain', { p_owner: ownerId, p_keybase: keyBase }) },
    resolveUncertain: async (keyBase, ownerId, r) => {
      const given = UNITS.filter(u => typeof r.actual?.[u] === 'number')
      if (given.length > 1) throw new Error('resolveUncertain con importes reales de varias unidades no esta soportado: resuelvelas por separado')
      await rpc('resolve_uncertain_budget', { p_owner: ownerId, p_keybase: keyBase, p_charged: r.charged, p_actual: given.length ? (r.actual?.[given[0]] as number) : null })
    },
    used: async (ownerId, provider, unit) => Number(await rpc('budget_used', { p_owner: ownerId, p_provider: provider, p_unit: unit })),
  }
}
