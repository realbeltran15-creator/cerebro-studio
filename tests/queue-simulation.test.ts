import { describe, expect, it } from 'vitest'
import { createMemoryLedger } from '@/lib/budget/ledger'
import { runOnce, type ExecutorDeps, type Registry, type StepDef } from '@/lib/queue/executor'
import { createMemoryStore } from '@/lib/queue/memory-store'
import { StepError } from '@/lib/queue/policy'
import { checkIncomplete, verdictOf } from '@/lib/qc/validators'
import type { Job } from '@/lib/queue/types'

const OWNER = 'owner-1'
const HOUR = 3_600_000

/** Proveedor simulado: cuenta llamadas, cargos y publicaciones. Nada sale de la memoria. */
function world(opts: { generate?: (n: number) => Promise<unknown> | void; publish?: () => Promise<unknown> | void; analyze?: (n: number) => Promise<unknown> | void; extra?: StepDef[] } = {}) {
  const calls = { analyze: 0, generate: 0, render: 0, publish: 0, qc: 0 }
  const generateKeys: string[] = []
  let credits = 0
  const steps: StepDef[] = [
    { name: 'analyze', kind: 'safe', timeoutMs: 40, retryOn429: true, run: async () => { calls.analyze++; await opts.analyze?.(calls.analyze); return { result: 'ok' } } },
    {
      name: 'generate', kind: 'irreversible', provider: 'gen', requiresApproval: 'spend', timeoutMs: 40,
      estimate: () => ({ credits: 5 }),
      run: async ctx => { calls.generate++; generateKeys.push(ctx.stepKey); await opts.generate?.(calls.generate); credits += 5; return { result: 'asset', actualCost: { credits: 5 } } },
    },
    { name: 'render', kind: 'safe', run: async () => { calls.render++; return { result: 'mp4' } } },
    ...(opts.extra ?? []),
    {
      name: 'publish', kind: 'irreversible', provider: 'youtube', requiresApproval: 'publish',
      run: async () => { calls.publish++; await opts.publish?.(); return { result: 'published' } },
    },
  ]
  const registry: Registry = { pipeline: steps, local: steps.filter(s => s.kind === 'safe') }
  const store = createMemoryStore()
  const ledger = createMemoryLedger()
  let t = 10 * HOUR
  const clock = { now: () => t, advance: (ms: number) => { t += ms } }
  const exec = (id = 'ex-1', leaseMs = 1000): ExecutorDeps => ({ store, ledger, registry, executorId: id, leaseMs, now: clock.now })
  const enqueue = (key: string, kind = 'pipeline', extra: { dryRun?: boolean; payload?: Record<string, unknown>; maxAttempts?: number; owner?: string } = {}) =>
    store.enqueue({ ownerId: extra.owner ?? OWNER, kind, idempotencyKey: key, dryRun: extra.dryRun ?? false, payload: extra.payload ?? { v: 1 }, maxAttempts: extra.maxAttempts }, t).job
  const approve = (job: Job, step: string, action: 'spend' | 'publish' | 'retry_uncertain', over: Partial<{ payloadHash: string; expiresAt: number; maxCost: Record<string, number> }> = {}) =>
    store.approvals.grant({ jobId: job.id, step, action, payloadHash: over.payloadHash ?? job.payloadHash, expiresAt: over.expiresAt ?? t + HOUR, revokedAt: null, maxCost: over.maxCost })
  const spend = (j: Job) => ledger.entries().filter(e => e.jobId === j.id)
  return { calls, generateKeys, charged: () => credits, store, ledger, clock, exec, enqueue, approve, spend }
}

describe('4B.0 simulación: concurrencia e idempotencia', () => {
  it('tres trabajos concurrentes se reparten sin que ninguno se ejecute dos veces', async () => {
    const w = world()
    for (const k of ['job-aaaa-1', 'job-aaaa-2', 'job-aaaa-3']) w.enqueue(k, 'local')
    const out = await Promise.all(['a', 'b', 'c', 'd'].map(id => runOnce(w.exec(id))))
    expect(out.filter(o => o.outcome === 'completed')).toHaveLength(3)
    expect(out.filter(o => o.outcome === 'idle')).toHaveLength(1)
    expect(new Set(out.flatMap(o => ('jobId' in o ? [o.jobId] : []))).size).toBe(3)
    expect(w.calls.analyze).toBe(3)
    expect(w.calls.render).toBe(3)
    expect(w.charged()).toBe(0)
    expect(w.calls.publish).toBe(0)
  })

  it('dos solicitudes con la misma clave de idempotencia crean un solo trabajo (por propietario)', async () => {
    const w = world()
    const a = w.store.enqueue({ ownerId: OWNER, kind: 'local', idempotencyKey: 'same-key-1' }, w.clock.now())
    const b = w.store.enqueue({ ownerId: OWNER, kind: 'local', idempotencyKey: 'same-key-1' }, w.clock.now())
    const other = w.store.enqueue({ ownerId: 'owner-2', kind: 'local', idempotencyKey: 'same-key-1' }, w.clock.now())
    expect(a.created).toBe(true)
    expect(b.created).toBe(false)
    expect(b.job.id).toBe(a.job.id)
    expect(other.job.id).not.toBe(a.job.id)               // el ámbito incluye al propietario
    await runOnce(w.exec('a')); await runOnce(w.exec('b')); await runOnce(w.exec('c'))
    expect(w.calls.analyze).toBe(2)                        // un trabajo por propietario, ninguno repetido
    expect(await runOnce(w.exec('d'))).toEqual({ outcome: 'idle' })
  })

  it('un trabajo terminado no vuelve a ejecutarse', async () => {
    const w = world(); w.enqueue('job-done-1', 'local')
    expect((await runOnce(w.exec())).outcome).toBe('completed')
    expect((await runOnce(w.exec())).outcome).toBe('idle')
    expect(w.calls.analyze).toBe(1)
  })
})

describe('4B.0 simulación: timeout, reinicio y lease', () => {
  it('timeout en un paso seguro: se reintenta con espera y no repite los pasos ya hechos', async () => {
    const w = world({ analyze: n => (n === 1 ? new Promise(() => {}) : undefined) })
    w.enqueue('job-timeout-1', 'local')
    const first = await runOnce(w.exec())
    expect(first).toMatchObject({ outcome: 'requeued', reason: 'timeout' })
    expect(await runOnce(w.exec())).toEqual({ outcome: 'idle' })            // aún en espera
    w.clock.advance(60_000)
    expect((await runOnce(w.exec())).outcome).toBe('completed')
    expect(w.calls.analyze).toBe(2)
    expect(w.calls.render).toBe(1)
  })

  it('timeout en un paso irreversible: queda en revisión y NO se repite solo ni se libera la reserva', async () => {
    const w = world({ generate: () => new Promise(() => {}) })
    const j = w.enqueue('job-timeout-2'); w.approve(j, 'generate', 'spend'); w.ledger.setLimit({ ownerId: OWNER, provider: 'gen', unit: 'credits', dailyLimit: 10 })
    const o = await runOnce(w.exec())
    expect(o).toMatchObject({ outcome: 'awaiting_approval', reason: 'uncertain_outcome' })
    expect(w.spend(j)).toMatchObject([{ state: 'uncertain', reserved: 5 }])
    // Reanudar sin aprobación de reintento: no llama al proveedor otra vez.
    w.store.resume(j.id, OWNER, w.clock.now())
    expect(await runOnce(w.exec())).toMatchObject({ outcome: 'awaiting_approval', reason: 'uncertain_outcome' })
    expect(w.calls.generate).toBe(1)
    expect(w.charged()).toBe(0)
  })

  it('reinicio del ejecutor: el segundo toma el trabajo, no repite pasos completados y el primero queda descartado', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const w = world({ analyze: n => (n === 1 ? gate : undefined) })
    const j = w.enqueue('job-restart-1', 'local')
    const pendingA = runOnce({ ...w.exec('A'), registry: { local: [{ name: 'analyze', kind: 'safe', timeoutMs: 100_000, run: async () => { w.calls.analyze++; await gate; return { result: 'A' } } }, ...(w.exec().registry.local.slice(1))] } })
    await Promise.resolve()
    w.clock.advance(5_000)                                                    // el lease de A caduca
    const b = await runOnce(w.exec('B'))
    expect(b.outcome).toBe('completed')
    release()
    expect((await pendingA).outcome).toBe('lease_lost')
    const final = w.store.get(j.id) as Job
    expect(final.status).toBe('completed')
    expect(final.attempts).toBe(2)
    expect((final.result as Record<string, unknown>).analyze).toBe('ok')     // el resultado es el de B, no el de A
    expect(w.calls.render).toBe(1)
  })

  it('reinicio durante un paso irreversible: el segundo ejecutor no lo repite (revisión humana)', async () => {
    const w = world({ generate: () => new Promise(() => {}) })
    const j = w.enqueue('job-restart-2'); w.approve(j, 'generate', 'spend'); w.ledger.setLimit({ ownerId: OWNER, provider: 'gen', unit: 'credits', dailyLimit: 10 })
    const reg: Registry = { pipeline: w.exec().registry.pipeline.map(s => (s.name === 'generate' ? { ...s, timeoutMs: 100_000 } : s)) }
    void runOnce({ ...w.exec('A'), registry: reg })                           // A «se cae» dentro de generate
    await new Promise(r => setTimeout(r, 5))
    w.clock.advance(5_000)
    expect(await runOnce({ ...w.exec('B'), registry: reg })).toMatchObject({ outcome: 'awaiting_approval', reason: 'uncertain_outcome' })
    expect(w.calls.generate).toBe(1)
    expect(w.spend(j)).toHaveLength(1)
  })

  it('agota intentos: tras varios fallos 500 en un paso seguro el trabajo falla sin bucle', async () => {
    const w = world({ analyze: () => { throw new StepError('boom', { httpStatus: 500 }) } })
    w.enqueue('job-max-1', 'local', { maxAttempts: 2 })
    expect((await runOnce(w.exec())).outcome).toBe('requeued')
    w.clock.advance(HOUR)
    expect(await runOnce(w.exec())).toMatchObject({ outcome: 'failed', reason: 'max_attempts_exceeded' })
    w.clock.advance(HOUR)
    expect(await runOnce(w.exec())).toEqual({ outcome: 'idle' })
    expect(w.calls.analyze).toBe(2)
  })
})

describe('4B.0 simulación: presupuesto', () => {
  it('sin presupuesto autorizado (0 por defecto) un paso de pago no llega al proveedor', async () => {
    const w = world(); const j = w.enqueue('job-budget-1'); w.approve(j, 'generate', 'spend')
    expect(await runOnce(w.exec())).toMatchObject({ outcome: 'failed', reason: 'budget_exhausted' })
    expect(w.calls.generate).toBe(0); expect(w.charged()).toBe(0); expect(w.spend(j)).toHaveLength(0)
  })

  it('precio desconocido bloquea; el límite diario se respeta entre trabajos', async () => {
    const w = world({ extra: [] })
    w.ledger.setLimit({ ownerId: OWNER, provider: 'gen', unit: 'credits', dailyLimit: 5 })
    const j1 = w.enqueue('job-budget-2'); w.approve(j1, 'generate', 'spend')
    const j2 = w.enqueue('job-budget-3'); w.approve(j2, 'generate', 'spend')
    const unknown: Registry = { pipeline: [{ name: 'generate', kind: 'irreversible', provider: 'gen', requiresApproval: 'spend', estimate: () => ({ credits: null }), run: async () => ({}) }] }
    expect(await runOnce({ ...w.exec(), registry: unknown })).toMatchObject({ outcome: 'failed', reason: 'unknown_price' })
    // j2 aún pendiente; con el registro normal: j2 cabe (5/5) y luego nada más cabe.
    expect((await runOnce({ ...w.exec(), registry: { pipeline: w.exec().registry.pipeline.slice(0, 2) } })).outcome).toBe('completed')
    const j3 = w.enqueue('job-budget-4'); w.approve(j3, 'generate', 'spend')
    expect(await runOnce({ ...w.exec(), registry: { pipeline: w.exec().registry.pipeline.slice(0, 2) } })).toMatchObject({ outcome: 'failed', reason: 'budget_exhausted' })
    expect(w.calls.generate).toBe(1)
    expect(w.ledger.used(OWNER, 'gen', 'credits', new Date(w.clock.now()))).toBe(5)
    void j1; void j2
  })

  it('la cuota gratuita y el dinero son contadores independientes', async () => {
    const w = world()
    w.ledger.setLimit({ ownerId: OWNER, provider: 'yt', unit: 'quota', dailyLimit: 100 })
    const r = w.ledger.reserve({ ownerId: OWNER, jobId: 'x', step: 's', provider: 'yt', projectId: null, cost: { quota: 50, eur: 0.01 }, keyBase: 'k1', now: new Date(w.clock.now()) })
    expect(r).toMatchObject({ ok: false, code: 'budget_exhausted', unit: 'eur' })     // quota hay, euros no: todo o nada
    expect(w.ledger.entries()).toHaveLength(0)
  })
})

describe('4B.0 simulación: errores del proveedor', () => {
  const setup = (generate: () => void) => {
    const w = world({ generate })
    const j = w.enqueue('job-err-' + Math.random().toString(36).slice(2)); w.approve(j, 'generate', 'spend')
    w.ledger.setLimit({ ownerId: OWNER, provider: 'gen', unit: 'credits', dailyLimit: 10 })
    return { w, j }
  }

  it('403 y 401: fallo permanente, sin reintento y reserva liberada', async () => {
    for (const status of [403, 401]) {
      const { w, j } = setup(() => { throw new StepError('no', { httpStatus: status }) })
      expect(await runOnce(w.exec())).toMatchObject({ outcome: 'failed' })
      w.clock.advance(HOUR)
      expect(await runOnce(w.exec())).toEqual({ outcome: 'idle' })
      expect(w.calls.generate).toBe(1); expect(w.charged()).toBe(0)
      expect(w.spend(j).every(e => e.state === 'released')).toBe(true)
      expect(w.calls.publish).toBe(0)
    }
  })

  it('429 en un paso irreversible: no se reintenta automáticamente aunque haya Retry-After', async () => {
    const { w, j } = setup(() => { throw new StepError('slow down', { httpStatus: 429, retryAfterMs: 1000 }) })
    expect(await runOnce(w.exec())).toMatchObject({ outcome: 'failed', reason: 'rate_limited' })
    w.clock.advance(HOUR)
    expect(await runOnce(w.exec())).toEqual({ outcome: 'idle' })
    expect(w.calls.generate).toBe(1)
    expect(w.spend(j).every(e => e.state === 'released')).toBe(true)
  })

  it('429 en un paso seguro autorizado: respeta Retry-After y nunca reintenta antes', async () => {
    const w = world({ analyze: n => { if (n === 1) throw new StepError('slow', { httpStatus: 429, retryAfterMs: 120_000 }) } })
    w.enqueue('job-429-safe', 'local')
    const t0 = w.clock.now()
    expect((await runOnce(w.exec())).outcome).toBe('requeued')
    w.clock.advance(119_000)
    expect(await runOnce(w.exec())).toEqual({ outcome: 'idle' })
    w.clock.advance(2_000)
    expect((await runOnce(w.exec())).outcome).toBe('completed')
    expect(w.clock.now() - t0).toBeGreaterThanOrEqual(120_000)
  })

  it('429 en un paso seguro NO autorizado a reintentar: falla', async () => {
    const w = world()
    const reg: Registry = { local: [{ name: 'analyze', kind: 'safe', run: async () => { w.calls.analyze++; throw new StepError('slow', { httpStatus: 429, retryAfterMs: 1 }) } }] }
    w.enqueue('job-429-no', 'local')
    expect(await runOnce({ ...w.exec(), registry: reg })).toMatchObject({ outcome: 'failed', reason: 'rate_limited' })
    expect(w.calls.analyze).toBe(1)
  })

  it('500 en un paso con cargo: resultado incierto, la reserva se conserva y no se reintenta', async () => {
    const { w, j } = setup(() => { throw new StepError('oops', { httpStatus: 500 }) })
    expect(await runOnce(w.exec())).toMatchObject({ outcome: 'awaiting_approval', reason: 'uncertain_outcome' })
    expect(w.spend(j)).toMatchObject([{ state: 'uncertain' }])
    w.clock.advance(HOUR)
    expect(await runOnce(w.exec())).toEqual({ outcome: 'idle' })
    expect(w.calls.generate).toBe(1)
  })

  it('tras revisar, una aprobación retry_uncertain permite repetir una sola vez con la misma clave de idempotencia', async () => {
    let n = 0
    const w = world({ generate: () => { if (++n === 1) throw new StepError('oops', { httpStatus: 500 }) } })
    const j = w.enqueue('job-retry-ok'); w.approve(j, 'generate', 'spend')
    w.ledger.setLimit({ ownerId: OWNER, provider: 'gen', unit: 'credits', dailyLimit: 10 })
    await runOnce(w.exec())
    w.approve(j, 'generate', 'retry_uncertain'); w.store.resume(j.id, OWNER, w.clock.now())
    expect((await runOnce(w.exec())).outcome).toBe('awaiting_approval')       // llega a publish sin permiso
    expect(w.calls.generate).toBe(2)
    expect(new Set(w.generateKeys).size).toBe(1)                               // misma clave → el proveedor deduplica
    expect(w.spend(j)).toHaveLength(1)                                         // una sola reserva
    expect(w.spend(j)[0].state).toBe('settled')
    expect(w.store.approvals.find(j.id, 'generate', 'retry_uncertain')?.revokedAt).not.toBeNull()   // de un solo uso
  })
})

describe('4B.0 simulación: cancelación', () => {
  it('cancelar un trabajo pendiente es inmediato y nunca se ejecuta', async () => {
    const w = world(); const j = w.enqueue('job-cancel-1', 'local')
    expect(w.store.requestCancel(j.id, OWNER, w.clock.now())).toBe(true)
    expect(await runOnce(w.exec())).toEqual({ outcome: 'idle' })
    expect((w.store.get(j.id) as Job).status).toBe('cancelled')
    expect(w.calls.analyze).toBe(0)
  })

  it('cancelación cooperativa: el paso en curso termina y los siguientes no empiezan', async () => {
    const w = world(); let id = ''
    const reg: Registry = {
      local: [
        { name: 'analyze', kind: 'safe', run: async ctx => { w.calls.analyze++; w.store.requestCancel(id, OWNER, w.clock.now()); return { result: ctx.isCancelled() } } },
        { name: 'render', kind: 'safe', run: async () => { w.calls.render++; return {} } },
      ],
    }
    id = w.enqueue('job-cancel-2', 'local').id
    expect(await runOnce({ ...w.exec(), registry: reg })).toMatchObject({ outcome: 'cancelled' })
    expect(w.calls.analyze).toBe(1); expect(w.calls.render).toBe(0)
    expect((w.store.get(id) as Job).steps[0]).toMatchObject({ name: 'analyze', status: 'completed', result: true })
    expect(await runOnce(w.exec())).toEqual({ outcome: 'idle' })
  })

  it('no se puede cancelar el trabajo de otro propietario', () => {
    const w = world(); const j = w.enqueue('job-cancel-3', 'local')
    expect(w.store.requestCancel(j.id, 'intruder', w.clock.now())).toBe(false)
    expect((w.store.get(j.id) as Job).status).toBe('pending')
  })
})

describe('4B.0 simulación: control de calidad', () => {
  it('un fallo de QC detiene la cadena: no se genera, no se renderiza, no se publica', async () => {
    const w = world()
    const qc: StepDef = {
      name: 'qc', kind: 'safe',
      run: async () => {
        w.calls.qc++
        const v = verdictOf(checkIncomplete({ provenance: { incomplete: true }, clips: [{ id: 'c1', visualAssetId: null }] }))
        if (v === 'fail') throw new StepError('QC: render incompleto', { httpStatus: 422, code: 'qc_failed' })
        return { result: v }
      },
    }
    const reg: Registry = { pipeline: [w.exec().registry.pipeline[0], qc, ...w.exec().registry.pipeline.slice(1)] }
    const j = w.enqueue('job-qc-1'); w.approve(j, 'generate', 'spend'); w.approve(j, 'publish', 'publish')
    expect(await runOnce({ ...w.exec(), registry: reg })).toMatchObject({ outcome: 'failed', reason: 'client_error' })
    expect(w.calls).toMatchObject({ qc: 1, generate: 0, render: 0, publish: 0 })
    expect(w.charged()).toBe(0)
  })
})

describe('4B.0 simulación: aprobaciones y publicación', () => {
  const ready = () => {
    const w = world(); const j = w.enqueue('job-appr-' + Math.random().toString(36).slice(2))
    w.ledger.setLimit({ ownerId: OWNER, provider: 'gen', unit: 'credits', dailyLimit: 10 })
    return { w, j }
  }

  it('sin aprobación de gasto no se llama al proveedor ni se reserva presupuesto', async () => {
    const { w, j } = ready()
    expect(await runOnce(w.exec())).toMatchObject({ outcome: 'awaiting_approval', reason: 'approval_missing' })
    expect(w.calls.generate).toBe(0); expect(w.spend(j)).toHaveLength(0)
  })

  it('aprobación invalidada (payload cambiado), revocada, caducada o insuficiente: ninguna vale', async () => {
    const cases: Array<[string, (w: ReturnType<typeof world>, j: Job) => void, string]> = [
      ['payload distinto', (w, j) => w.approve(j, 'generate', 'spend', { payloadHash: 'otro-hash' }), 'approval_invalidated'],
      ['caducada', (w, j) => w.approve(j, 'generate', 'spend', { expiresAt: w.clock.now() - 1 }), 'approval_expired'],
      ['tope menor', (w, j) => w.approve(j, 'generate', 'spend', { maxCost: { credits: 1 } }), 'approval_insufficient'],
      ['revocada', (w, j) => { w.approve(j, 'generate', 'spend'); w.store.approvals.revoke(j.id, 'generate', 'spend', w.clock.now()) }, 'approval_revoked'],
    ]
    for (const [, setup, reason] of cases) {
      const { w, j } = ready(); setup(w, j)
      expect(await runOnce(w.exec())).toMatchObject({ outcome: 'awaiting_approval', reason })
      expect(w.calls.generate).toBe(0); expect(w.charged()).toBe(0)
    }
  })

  it('con aprobación válida se gasta una vez, se concilia y la publicación sigue bloqueada sin permiso', async () => {
    const { w, j } = ready(); w.approve(j, 'generate', 'spend')
    expect(await runOnce(w.exec())).toMatchObject({ outcome: 'awaiting_approval', reason: 'approval_missing' })   // se detiene en publish
    expect(w.calls).toMatchObject({ generate: 1, render: 1, publish: 0 })
    expect(w.spend(j)).toMatchObject([{ state: 'settled', actual: 5 }])
    expect((w.store.get(j.id) as Job).steps.find(s => s.name === 'publish')?.status).toBe('pending')
  })

  it('con aprobación de publicación también, publica exactamente una vez', async () => {
    const { w, j } = ready(); w.approve(j, 'generate', 'spend'); w.approve(j, 'publish', 'publish')
    expect((await runOnce(w.exec())).outcome).toBe('completed')
    expect((await runOnce(w.exec())).outcome).toBe('idle')
    expect(w.calls).toMatchObject({ generate: 1, publish: 1 })
  })

  it('modo simulación (por defecto): nada que cueste o publique se ejecuta', async () => {
    const w = world(); const j = w.enqueue('job-dry-1', 'pipeline', { dryRun: true })
    expect((await runOnce(w.exec())).outcome).toBe('completed')
    expect(w.calls).toMatchObject({ analyze: 1, generate: 0, render: 1, publish: 0 })
    expect((w.store.get(j.id) as Job).steps.filter(s => s.status === 'skipped').map(s => s.name)).toEqual(['generate', 'publish'])
    expect(w.spend(j)).toHaveLength(0)
  })

  it('un paso irreversible sin exigir aprobación es una configuración rechazada', async () => {
    const w = world(); let ran = false
    const reg: Registry = { pipeline: [{ name: 'bad', kind: 'irreversible', run: async () => { ran = true; return {} } }] }
    w.enqueue('job-misconf-1')
    expect(await runOnce({ ...w.exec(), registry: reg })).toMatchObject({ outcome: 'failed', reason: 'misconfigured_step' })
    expect(ran).toBe(false)
  })

  it('un trabajo desconocido falla sin ejecutar nada', async () => {
    const w = world(); w.enqueue('job-unk-1', 'nope')
    expect(await runOnce(w.exec())).toMatchObject({ outcome: 'failed', reason: 'unknown_kind' })
  })
})
