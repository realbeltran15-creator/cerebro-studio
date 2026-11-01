import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OWNER_A, pgAvailable, startLocalPg, type LocalPg } from '@/lib/queue/dev/pg-local'
import { createPgRpc } from '@/lib/queue/dev/pg-rpc'
import { runOnce } from '@/lib/queue/executor'
import { createRpcLedger, createRpcStore } from '@/lib/queue/rpc-adapter'

describe.skipIf(!pgAvailable())('caída REAL del proceso (SIGKILL) y recuperación', () => {
  let pg: LocalPg
  beforeAll(async () => { pg = await startLocalPg() }, 90_000)
  afterAll(async () => { await pg?.stop() }, 30_000)

  it('un worker matado con SIGKILL a mitad de un paso: otro proceso retoma sin repetir el paso hecho', async () => {
    const root = process.cwd()
    const r = await build({ entryPoints: [path.join(root, 'scripts/queue-crash-worker.entry.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20', alias: { '@': root }, external: ['pg', 'pg-native'], logLevel: 'error',
      banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } })
    const dir = path.join(root, 'node_modules/.cache/queue-crash'); mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'worker.mjs'); writeFileSync(file, r.outputFiles[0].text)

    const pool = pg.connect('service_role'); const rpc = createPgRpc(pool)
    const store = createRpcStore(rpc), ledger = createRpcLedger(rpc)
    const { job } = await store.enqueue({ ownerId: OWNER_A, kind: 'killme', idempotencyKey: 'crash-key-0001', payload: {}, dryRun: false }, Date.now())

    const child = spawn(process.execPath, [file, pg.dir, String(pg.port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('el worker no llegó al paso b')), 20_000)
      child.stdout.on('data', d => { if (String(d).includes('IN_B')) { clearTimeout(t); res() } })
      child.on('exit', () => { clearTimeout(t); rej(new Error('el worker terminó antes de tiempo')) })
    })
    child.kill('SIGKILL')                                                   // caída real: sin cierre limpio, sin finally
    await new Promise(r2 => child.on('exit', r2))

    let row = (await pg.admin.query('select status, attempts, lease_expires_at > now() as leased, steps from job_queue where id = $1', [job.id])).rows[0]
    expect(row.status).toBe('running'); expect(row.leased).toBe(true)       // huérfano: el lease aún no caducó
    expect((await runOnce({ store, ledger, executorId: 'early', leaseMs: 5000, now: Date.now, registry: { killme: [] } })).outcome).toBe('idle')   // nadie lo roba antes de tiempo

    await pg.admin.query("update job_queue set lease_expires_at = now() - interval '1 second' where id = $1", [job.id])   // caduca el lease
    let bRuns = 0
    const out = await runOnce({ store, ledger, executorId: 'survivor', leaseMs: 5000, now: Date.now, registry: { killme: [
      { name: 'a', kind: 'safe', run: async () => { throw new Error('el paso a ya estaba completado y NO debe repetirse') } },
      { name: 'b', kind: 'safe', run: async () => { bRuns++; return { result: 'b' } } },
    ] } })
    expect(out.outcome).toBe('completed')
    row = (await pg.admin.query('select status, attempts, steps, result from job_queue where id = $1', [job.id])).rows[0]
    expect(row.status).toBe('completed'); expect(row.attempts).toBe(2); expect(bRuns).toBe(1)
    expect(row.steps.map((s: { name: string; status: string; attempts: number }) => [s.name, s.status, s.attempts])).toEqual([['a', 'completed', 1], ['b', 'completed', 2]])
    expect(row.result).toEqual({ a: 'a', b: 'b' })
  }, 90_000)
})
