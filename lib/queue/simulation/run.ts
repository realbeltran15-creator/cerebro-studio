/**
 * Runner de simulacion (Fase 4B.2). Levanta un PostgreSQL desechable, encola trabajos de produccion en dry_run,
 * los ejecuta con el ejecutor real, inspecciona MP4 reales con ffmpeg y devuelve un informe estructurado.
 * Rechaza cualquier configuracion no local (assertLocalOnly). Nunca llama a servicios externos.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runOnce, type ExecutorDeps } from '@/lib/queue/executor'
import { createPgRpc } from '@/lib/queue/dev/pg-rpc'
import { OWNER_A, PROJECT_A, startLocalPg } from '@/lib/queue/dev/pg-local'
import { assertLocalOnly } from '@/lib/queue/local-guard'
import { createRpcLedger, createRpcStore } from '@/lib/queue/rpc-adapter'
import { buildRegistry, KIND, type Scenario, type SimContext } from './video-production'

export type SimJobReport = {
  scenario: Scenario; jobId: string; status: string; attempts: number; awaitingReason: string | null; error: unknown
  steps: Array<{ name: string; status: string; durationMs: number | null; dependsOn: string[]; error?: unknown; summary?: unknown }>
  qc: { verdict: string; codes: string[] } | null
}
export type SimReport = {
  dryRun: true
  jobs: SimJobReport[]
  recovery?: { aStepRuns: Record<string, number>; aOutcome: string; bOutcome: string; finalStatus: string; attempts: number }
  cost: { estimated: Record<string, number>; reserved: number; confirmed: number; note: string }
  invariants: { externalCalls: number; budgetEntries: number; publishedOrSpent: number; duplicateJobRows: number; jobCount: number }
  ok: boolean
}

export async function runSimulation(o: { scenarios: Scenario[]; recover?: boolean; env: Record<string, string | undefined>; dryRun?: boolean; concurrency?: number }): Promise<SimReport> {
  const dryRun = o.dryRun ?? true
  assertLocalOnly({ env: o.env, dbHost: tmpdir(), dryRun })
  const pg = await startLocalPg()
  const workDir = mkdtempSync(path.join(tmpdir(), 'simmedia-'))
  try {
    assertLocalOnly({ env: o.env, dbHost: pg.dir, dryRun })
    const pool = pg.connect('service_role')
    const store = createRpcStore(createPgRpc(pool)), ledger = createRpcLedger(createPgRpc(pool))
    const ctx: SimContext = { workDir, rendersSeen: [], externalCalls: { count: 0 }, requestCancel: (id, owner) => Promise.resolve(store.requestCancel(id, owner, Date.now())) }
    const registry = buildRegistry(ctx)
    const deps = (id: string): ExecutorDeps => ({ store, ledger, registry, executorId: id, leaseMs: 5000, now: Date.now })
    const enqueue = async (scenario: Scenario, i: number, seed = i + 1, key = `sim-${scenario}-${i}`) =>
      (await store.enqueue({ ownerId: OWNER_A, projectId: PROJECT_A, kind: KIND, idempotencyKey: key, payload: { scenario, seed, projectName: 'Proyecto ficticio' }, dryRun }, Date.now())).job

    const drain = async (n: number) => {
      for (let round = 0; round < 20; round++) {
        const outs = await Promise.all(Array.from({ length: n }, (_, k) => runOnce(deps(`sim-ex-${k + 1}`))))
        if (outs.every(x => x.outcome === 'idle')) return
      }
    }
    const conc = o.concurrency ?? 3
    const first = o.scenarios.filter(s => s !== 'duplicate'), later = o.scenarios.filter(s => s === 'duplicate')
    const jobs: Array<{ scenario: Scenario; id: string }> = []
    for (const [i, s] of first.entries()) jobs.push({ scenario: s, id: (await enqueue(s, i, s === 'ok' ? 0 : undefined)).id })
    await drain(conc)
    for (const [i, s] of later.entries()) jobs.push({ scenario: s, id: (await enqueue(s, first.length + i, 0)).id })   // mismo seed que 'ok' = misma composición
    await drain(conc)

    let recovery: SimReport['recovery']
    if (o.recover) {
      const aRuns: Record<string, number> = {}
      let release!: () => void
      const gate = new Promise<void>(r => { release = r })
      const ctxA: SimContext = { ...ctx, renderGate: gate }
      const regA = buildRegistry(ctxA)
      const counting = { ...regA, [KIND]: regA[KIND].map(s => ({ ...s, run: async (c: Parameters<typeof s.run>[0]) => { aRuns[s.name] = (aRuns[s.name] ?? 0) + 1; return s.run(c) } })) }
      const j = await enqueue('ok', 99, 50, 'sim-recover-1')
      const A = runOnce({ ...deps('crashing-A'), registry: counting })
      await new Promise(r => setTimeout(r, 1500))                                   // A completó script/storyboard/montage y se «cae» en render
      await pg.admin.query("update job_queue set lease_expires_at = now() - interval '1 second' where id = $1", [j.id])
      const poolB = pg.connect('service_role')                                      // «proceso nuevo»
      const B = await runOnce({ ...deps('recovering-B'), store: createRpcStore(createPgRpc(poolB)), ledger: createRpcLedger(createPgRpc(poolB)) })
      release()
      const aOut = await A
      const row = (await pg.admin.query('select status, attempts from job_queue where id = $1', [j.id])).rows[0]
      jobs.push({ scenario: 'ok', id: j.id })
      recovery = { aStepRuns: aRuns, aOutcome: aOut.outcome, bOutcome: B.outcome, finalStatus: row.status, attempts: row.attempts }
    }

    const reports: SimJobReport[] = []
    for (const j of jobs) {
      const r = (await pg.admin.query('select status, attempts, awaiting_reason, error, steps from job_queue where id = $1', [j.id])).rows[0]
      const steps = (r.steps as Array<Record<string, unknown>>).map(s => ({ name: s.name as string, status: s.status as string, durationMs: (s.durationMs as number | undefined) ?? null, dependsOn: (s.dependsOn as string[] | undefined) ?? [], error: s.error, summary: s.name === 'qc' ? undefined : undefined }))
      const qcStep = (r.steps as Array<{ name: string; result?: { verdict: string; findings: Array<{ severity: string; code: string }> } }>).find(s => s.name === 'qc')
      reports.push({ scenario: j.scenario, jobId: j.id, status: r.status, attempts: r.attempts, awaitingReason: r.awaiting_reason, error: r.error, steps,
        qc: qcStep?.result ? { verdict: qcStep.result.verdict, codes: qcStep.result.findings.map(f => `${f.severity}:${f.code}`) } : null })
    }
    const budgetEntries = (await pg.admin.query('select count(*)::int c from budget_entries')).rows[0].c
    const dup = (await pg.admin.query('select count(*)::int c from (select owner_id, kind, idempotency_key from job_queue group by 1,2,3 having count(*) > 1) x')).rows[0].c
    const total = (await pg.admin.query('select count(*)::int c from job_queue')).rows[0].c
    const spentOrPublished = reports.flatMap(r => r.steps).filter(s => (s.name === 'publish' || s.name === 'generate_assets') && s.status === 'completed').length
    const estimated = { credits: 5 * reports.filter(r => r.steps.some(s => s.name === 'generate_assets' && s.status === 'skipped')).length }
    const invariants = { externalCalls: ctx.externalCalls.count, budgetEntries, publishedOrSpent: spentOrPublished, duplicateJobRows: dup, jobCount: total }
    const ok = invariants.externalCalls === 0 && budgetEntries === 0 && spentOrPublished === 0 && dup === 0
    return { dryRun: true, jobs: reports, recovery, cost: { estimated, reserved: 0, confirmed: 0, note: 'Simulación: los pasos de pago están saltados (estimado), no se reservó ni se confirmó nada. Gasto real: 0 €.' }, invariants, ok }
  } finally {
    await pg.stop()
    rmSync(workDir, { recursive: true, force: true })
  }
}
