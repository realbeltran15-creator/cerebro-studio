import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRpcLedger, createRpcStore } from '@/lib/queue/rpc-adapter'
import { createPgRpc } from '@/lib/queue/dev/pg-rpc'
import { OWNER_A, OWNER_B, PROJECT_A, PROJECT_B, pgAvailable, startLocalPg, type LocalPg } from '@/lib/queue/dev/pg-local'
import { runOnce, type ExecutorDeps, type Registry, type StepDef } from '@/lib/queue/executor'
import { StepError } from '@/lib/queue/policy'
import type { Job } from '@/lib/queue/types'

/** Estas pruebas usan un PostgreSQL local DESECHABLE (socket unix, sin red). Se omiten si no hay binarios de postgres. */
describe.skipIf(!pgAvailable())('cola + presupuesto sobre PostgreSQL local (adaptador RPC, rol service_role)', () => {
  let pg: LocalPg, pool: Pool
  let store: ReturnType<typeof createRpcStore>, ledger: ReturnType<typeof createRpcLedger>, rpc: ReturnType<typeof createPgRpc>
  let n = 0
  const key = (p = 'k') => `${p}-${Date.now()}-${++n}-key`
  const row = async (id: string) => (await pg.admin.query('select * from job_queue where id = $1', [id])).rows[0]
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  beforeAll(async () => {
    pg = await startLocalPg()
    pool = pg.connect('service_role')
    rpc = createPgRpc(pool); store = createRpcStore(rpc); ledger = createRpcLedger(rpc)
  }, 90_000)
  afterAll(async () => { await pg?.stop() }, 30_000)

  const calls = { a: 0, b: 0, gen: 0, publish: 0 }
  let genCharges = 0
  const reset = () => { calls.a = calls.b = calls.gen = calls.publish = 0; genCharges = 0 }
  const mkSteps = (o: { a?: (n: number) => Promise<unknown> | void; gen?: (n: number) => Promise<unknown> | void; provider?: string } = {}): StepDef[] => [
    { name: 'a', kind: 'safe', timeoutMs: 400, retryOn429: true, run: async () => { calls.a++; await o.a?.(calls.a); return { result: 'a' } } },
    { name: 'gen', kind: 'irreversible', provider: o.provider ?? 'gen', requiresApproval: 'spend', timeoutMs: 400, estimate: () => ({ credits: 5 }),
      run: async () => { calls.gen++; await o.gen?.(calls.gen); genCharges += 5; return { result: 'g', actualCost: { credits: 5 } } } },
    { name: 'b', kind: 'safe', run: async () => { calls.b++; return { result: 'b' } } },
    { name: 'publish', kind: 'irreversible', provider: 'yt', requiresApproval: 'publish', run: async () => { calls.publish++; return { result: 'published' } } },
  ]
  const deps = (registry: Registry, id = 'ex-1', leaseMs = 2000): ExecutorDeps => ({ store, ledger, registry, executorId: id, leaseMs, now: Date.now })
  const enqueue = async (kind: string, extra: { owner?: string; dryRun?: boolean; payload?: Record<string, unknown>; project?: string | null; maxAttempts?: number } = {}) =>
    (await store.enqueue({ ownerId: extra.owner ?? OWNER_A, projectId: extra.project ?? null, kind, idempotencyKey: key(), payload: extra.payload ?? { v: 1 }, dryRun: extra.dryRun ?? false, maxAttempts: extra.maxAttempts }, Date.now())).job
  const approve = async (j: Job, step: string, action: 'spend' | 'publish' | 'retry_uncertain', over: { expiresAt?: number; payloadHash?: string; maxCost?: Record<string, number> } = {}) =>
    void await store.approvals.grant({ jobId: j.id, step, action, payloadHash: over.payloadHash ?? j.payloadHash, expiresAt: over.expiresAt ?? Date.now() + 3_600_000, revokedAt: null, maxCost: over.maxCost })
  const limit = async (provider: string, credits: number, owner = OWNER_A) => void await ledger.setLimit({ ownerId: owner, provider, unit: 'credits', dailyLimit: credits })
  const entries = async (jobId: string) => (await pg.admin.query('select state, reserved, actual, idempotency_key from budget_entries where job_id = $1 order by created_at', [jobId])).rows

  it('el adaptador trabaja con el rol service_role (mínimo privilegio)', async () => {
    expect((await pool.query('select current_user as u')).rows[0].u).toBe('service_role')
  })

  it('encolar es idempotente por propietario/tipo/clave; otro payload se detecta; otro propietario no choca; proyecto ajeno rechazado', async () => {
    const k = key('idem')
    const a = await store.enqueue({ ownerId: OWNER_A, projectId: PROJECT_A, kind: 'k1', idempotencyKey: k, payload: { x: 1 } }, Date.now())
    const b = await store.enqueue({ ownerId: OWNER_A, projectId: PROJECT_A, kind: 'k1', idempotencyKey: k, payload: { x: 1 } }, Date.now())
    const c = await store.enqueue({ ownerId: OWNER_A, projectId: PROJECT_A, kind: 'k1', idempotencyKey: k, payload: { x: 2 } }, Date.now())
    const d = await store.enqueue({ ownerId: OWNER_B, projectId: PROJECT_B, kind: 'k1', idempotencyKey: k, payload: { x: 1 } }, Date.now())
    expect([a.created, b.created, c.created, d.created]).toEqual([true, false, false, true])
    expect([a.payloadMismatch, b.payloadMismatch, c.payloadMismatch]).toEqual([false, false, true])
    expect(b.job.id).toBe(a.job.id); expect(c.job.id).toBe(a.job.id); expect(d.job.id).not.toBe(a.job.id)
    expect(a.job.dryRun).toBe(true)                                     // simulación por defecto
    await expect(store.enqueue({ ownerId: OWNER_A, projectId: PROJECT_B, kind: 'k1', idempotencyKey: key(), payload: {} }, Date.now())).rejects.toThrow(/no pertenece/)
    expect((await pg.admin.query('select count(*)::int c from job_queue where idempotency_key = $1', [k])).rows[0].c).toBe(2)
  })

  it('10 peticiones simultáneas con la misma clave crean un solo trabajo', async () => {
    const k = key('burst')
    const out = await Promise.all(Array.from({ length: 10 }, () => store.enqueue({ ownerId: OWNER_A, kind: 'burst', idempotencyKey: k, payload: { z: 1 } }, Date.now())))
    expect(out.filter(o => o.created)).toHaveLength(1)
    expect(new Set(out.map(o => o.job.id)).size).toBe(1)
  })

  it('tres trabajos concurrentes (3 ejecutores + 1 sobrante): cada uno se ejecuta una vez y su estado se persiste', async () => {
    reset()
    const reg: Registry = { three: mkSteps().filter(s => s.kind === 'safe') }
    const jobs = await Promise.all([1, 2, 3].map(() => enqueue('three')))
    const out = await Promise.all(['e1', 'e2', 'e3', 'e4'].map(id => runOnce(deps(reg, id))))
    expect(out.filter(o => o.outcome === 'completed')).toHaveLength(3)
    expect(out.filter(o => o.outcome === 'idle')).toHaveLength(1)
    expect(calls).toMatchObject({ a: 3, b: 3 })
    for (const j of jobs) {
      const r = await row(j.id)
      expect(r.status).toBe('completed'); expect(r.attempts).toBe(1); expect(r.claim_token).toBeNull()
      expect(r.steps.map((s: { status: string }) => s.status)).toEqual(['completed', 'completed'])
      expect(r.result).toEqual({ a: 'a', b: 'b' })
    }
  })

  it('interrupción del proceso: otro ejecutor retoma, no repite pasos completados y el antiguo no puede escribir', async () => {
    reset()
    let release!: () => void; const gate = new Promise<void>(r => { release = r })
    const slow: Registry = { crash: [mkSteps()[0], { name: 'b', kind: 'safe', timeoutMs: 20_000, run: async () => { calls.b++; if (calls.b === 1) await gate; return { result: 'b' } } }] }
    const j = await enqueue('crash')
    const A = runOnce(deps(slow, 'A'))
    await sleep(300)                                                      // A completó 'a' y se «cae» dentro de 'b'
    await pg.admin.query("update job_queue set lease_expires_at = now() - interval '1 second' where id = $1", [j.id])
    const poolB = pg.connect('service_role')
    const storeB = createRpcStore(createPgRpc(poolB)), ledgerB = createRpcLedger(createPgRpc(poolB))   // «proceso nuevo»
    const B = await runOnce({ ...deps(slow, 'B'), store: storeB, ledger: ledgerB })
    expect(B.outcome).toBe('completed')
    release()
    expect((await A).outcome).toBe('lease_lost')
    const r = await row(j.id)
    expect(r.status).toBe('completed'); expect(r.attempts).toBe(2)
    expect(calls.a).toBe(1)                                               // el paso ya completado NO se repitió
    expect(calls.b).toBe(2)                                               // el paso a medias (seguro) sí
  }, 30_000)

  it('timeout en paso seguro: vuelve a la cola con espera y se reanuda sin repetir lo hecho', async () => {
    reset()
    const reg: Registry = { to: mkSteps({ a: n2 => (n2 === 1 ? new Promise(() => {}) : undefined) }).filter(s => s.kind === 'safe') }
    const j = await enqueue('to')
    expect(await runOnce(deps(reg))).toMatchObject({ outcome: 'requeued', reason: 'timeout' })
    expect((await row(j.id)).status).toBe('pending')
    expect(await runOnce(deps(reg))).toEqual({ outcome: 'idle' })         // aún en espera (backoff)
    await pg.admin.query("update job_queue set available_at = now() where id = $1", [j.id])
    expect((await runOnce(deps(reg))).outcome).toBe('completed')
    expect(calls).toMatchObject({ a: 2, b: 1 })
  })

  it('cancelación: pendiente = inmediata; en curso = cooperativa (el paso actual termina y los siguientes no empiezan)', async () => {
    reset()
    const p = await enqueue('cx')
    expect(await store.requestCancel(p.id, OWNER_A, Date.now())).toBe(true)
    expect((await row(p.id)).status).toBe('cancelled')
    expect(await store.requestCancel(p.id, OWNER_A, Date.now())).toBe(false)     // terminal: no se puede tocar de nuevo
    expect(await store.resume(p.id, OWNER_A, Date.now())).toBe(false)
    let id = ''
    const reg: Registry = { cx2: [{ name: 'a', kind: 'safe', run: async () => { calls.a++; await store.requestCancel(id, OWNER_A, Date.now()); return {} } }, mkSteps()[2]] }
    id = (await enqueue('cx2')).id
    expect(await runOnce(deps(reg))).toMatchObject({ outcome: 'cancelled' })
    expect(calls).toMatchObject({ a: 1, b: 0 })
    expect(await store.requestCancel(id, OWNER_B, Date.now())).toBe(false)       // otro propietario no cancela
  })

  it('presupuesto: 4 trabajos concurrentes de 5 créditos con límite 10 → solo 2 gastan; nunca se supera el límite', async () => {
    reset(); const prov = 'budget-' + n
    await limit(prov, 10)
    const reg: Registry = { pay: mkSteps({ provider: prov }).slice(0, 3) }
    const jobs = await Promise.all([1, 2, 3, 4].map(() => enqueue('pay')))
    for (const j of jobs) await approve(j, 'gen', 'spend')
    const out = await Promise.all(['p1', 'p2', 'p3', 'p4'].map(id => runOnce(deps(reg, id))))
    expect(out.filter(o => o.outcome === 'completed')).toHaveLength(2)
    expect(out.filter(o => o.outcome === 'failed' && o.reason === 'budget_exhausted')).toHaveLength(2)
    expect(calls.gen).toBe(2); expect(genCharges).toBe(10)
    expect(await ledger.used(OWNER_A, prov, 'credits', new Date())).toBe(10)
    const states = (await Promise.all(jobs.map(j => entries(j.id)))).flat().map(e => e.state)
    expect(states.sort()).toEqual(['settled', 'settled'])
  })

  it('sin límite configurado (0 por defecto) nada de pago llega al proveedor', async () => {
    reset()
    const reg: Registry = { pay0: mkSteps({ provider: 'sin-limite-' + n }).slice(0, 3) }
    const j = await enqueue('pay0'); await approve(j, 'gen', 'spend')
    expect(await runOnce(deps(reg))).toMatchObject({ outcome: 'failed', reason: 'budget_exhausted' })
    expect(calls.gen).toBe(0); expect(await entries(j.id)).toEqual([])
  })

  it('resultado incierto: 500 en paso con cargo → la reserva queda «uncertain», no se libera ni tras un fallo posterior', async () => {
    reset(); const prov = 'unc-' + n
    await limit(prov, 10)
    let fail: StepError | null = new StepError('oops', { httpStatus: 500 })
    const reg: Registry = { unc: mkSteps({ provider: prov, gen: () => { if (fail) throw fail } }).slice(0, 3) }
    const j = await enqueue('unc'); await approve(j, 'gen', 'spend')
    expect(await runOnce(deps(reg))).toMatchObject({ outcome: 'awaiting_approval', reason: 'uncertain_outcome' })
    expect((await entries(j.id)).map(e => e.state)).toEqual(['uncertain'])
    expect(await ledger.used(OWNER_A, prov, 'credits', new Date())).toBe(5)       // sigue ocupando presupuesto
    // Sin aprobación de reintento no se vuelve a llamar al proveedor.
    await store.resume(j.id, OWNER_A, Date.now())
    expect(await runOnce(deps(reg))).toMatchObject({ outcome: 'awaiting_approval', reason: 'uncertain_outcome' })
    expect(calls.gen).toBe(1)
    // Con aprobación humana se reintenta UNA vez; si falla con 403 la reserva incierta NO se libera sola.
    fail = new StepError('forbidden', { httpStatus: 403 })
    await approve(j, 'gen', 'retry_uncertain'); await store.resume(j.id, OWNER_A, Date.now())
    expect(await runOnce(deps(reg))).toMatchObject({ outcome: 'failed', reason: 'forbidden' })
    expect(calls.gen).toBe(2)
    expect((await entries(j.id)).map(e => e.state)).toEqual(['uncertain'])
    expect(await ledger.used(OWNER_A, prov, 'credits', new Date())).toBe(5)
    // Una persona resuelve: no se cobró → se libera y el hueco vuelve.
    await ledger.resolveUncertain(`${j.id}:gen`, OWNER_A, { charged: false })
    expect(await ledger.used(OWNER_A, prov, 'credits', new Date())).toBe(0)
  })

  it('aprobaciones: ausente, caducada, de otro payload, revocada o insuficiente bloquean y coinciden con check_approval de SQL', async () => {
    const cases: Array<[string, (j: Job) => Promise<void>, string]> = [
      ['ausente', async () => {}, 'approval_missing'],
      ['caducada', j => approve(j, 'gen', 'spend', { expiresAt: Date.now() - 1000 }), 'approval_expired'],
      ['otro payload', j => approve(j, 'gen', 'spend', { payloadHash: 'otro' }), 'approval_invalidated'],
      ['revocada', async j => { await approve(j, 'gen', 'spend'); await store.approvals.revoke(j.id, 'gen', 'spend', Date.now()) }, 'approval_revoked'],
      ['tope menor', j => approve(j, 'gen', 'spend', { maxCost: { credits: 1 } }), 'approval_insufficient'],
    ]
    for (const [name, setup, reason] of cases) {
      reset(); const prov = 'appr-' + n; await limit(prov, 100)
      const reg: Registry = { ap: mkSteps({ provider: prov }).slice(0, 3) }
      const j = await enqueue('ap'); await setup(j)
      expect(await runOnce(deps(reg)), name).toMatchObject({ outcome: 'awaiting_approval', reason })
      expect(calls.gen, name).toBe(0); expect(await entries(j.id), name).toEqual([])
      if (reason !== 'approval_insufficient') expect(await rpc('check_approval', { p_job: j.id, p_step: 'gen', p_action: 'spend' }), name).toBe(reason)
    }
  })

  it('publicar sin permiso: la cadena se detiene en «publish» y el proveedor nunca se llama; con permiso, exactamente una vez', async () => {
    reset(); const prov = 'pub-' + n; await limit(prov, 100)
    const reg: Registry = { pub: mkSteps({ provider: prov }) }
    const j = await enqueue('pub'); await approve(j, 'gen', 'spend')
    expect(await runOnce(deps(reg))).toMatchObject({ outcome: 'awaiting_approval', reason: 'approval_missing' })
    expect(calls.publish).toBe(0)
    await approve(j, 'publish', 'publish'); await store.resume(j.id, OWNER_A, Date.now())
    expect((await runOnce(deps(reg))).outcome).toBe('completed')
    expect((await runOnce(deps(reg))).outcome).toBe('idle')
    expect(calls).toMatchObject({ a: 1, gen: 1, b: 1, publish: 1 })        // nada se repitió al reanudar
  })

  it('modo simulación (dry_run) en PostgreSQL: lo que cuesta o publica se salta y queda registrado', async () => {
    reset()
    const reg: Registry = { dry: mkSteps() }
    const j = await enqueue('dry', { dryRun: true })
    expect((await runOnce(deps(reg))).outcome).toBe('completed')
    expect(calls).toMatchObject({ a: 1, gen: 0, b: 1, publish: 0 })
    expect((await row(j.id)).steps.map((s: { status: string }) => s.status)).toEqual(['completed', 'skipped', 'completed', 'skipped'])
    expect(await entries(j.id)).toEqual([])
  })

  it('aislamiento: un ejecutor no puede terminar ni escribir con un token que no es suyo', async () => {
    const j = await enqueue('iso')
    const claimed = await store.claim('ex-iso', 5000, Date.now(), ['iso'])
    expect(claimed?.id).toBe(j.id)
    expect(await store.finish(j.id, '00000000-0000-0000-0000-000000000000', { status: 'completed' }, Date.now())).toBe(false)
    expect(await store.saveSteps(j.id, '00000000-0000-0000-0000-000000000000', [], null, Date.now())).toBe(false)
    expect(await store.finish(j.id, claimed!.claimToken!, { status: 'failed', error: { code: 'x', message: 'x', retryable: false } }, Date.now())).toBe(true)
  })
})
