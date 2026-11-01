/** SOLO PRUEBAS: worker que se queda colgado dentro de un paso para que el test lo mate con SIGKILL (caída real del proceso). */
import { Pool } from 'pg'
import { createRpcLedger, createRpcStore } from '@/lib/queue/rpc-adapter'
import { createPgRpc } from '@/lib/queue/dev/pg-rpc'
import { runOnce } from '@/lib/queue/executor'

const [dir, port] = process.argv.slice(2)
const pool = new Pool({ host: dir, port: Number(port), user: 'postgres', database: 't', options: '-c role=service_role' })
const rpc = createPgRpc(pool)
const out = await runOnce({
  store: createRpcStore(rpc), ledger: createRpcLedger(rpc), executorId: 'doomed-worker', leaseMs: 5000, now: Date.now,
  registry: { killme: [
    { name: 'a', kind: 'safe', run: async () => ({ result: 'a' }) },
    { name: 'b', kind: 'safe', timeoutMs: 600_000, run: async () => { console.log('IN_B'); await new Promise(() => {}); return {} } },
  ] },
})
console.log('UNEXPECTED_END', JSON.stringify(out))
