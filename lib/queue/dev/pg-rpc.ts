/** SOLO DESARROLLO/TESTS: ejecuta Rpc contra un PostgreSQL local con `pg`. No importar desde rutas de la app. */
import { Pool, type PoolConfig } from 'pg'
import type { Rpc } from '../rpc-adapter'

/** Pool cuyas conexiones se degradan a `service_role` (el mismo rol que usara la app): demuestra minimo privilegio. */
export function createServicePool(cfg: PoolConfig, role = 'service_role'): Pool {
  if (!/^[a-z_]+$/.test(role)) throw new Error('rol no valido')
  return new Pool({ max: 12, options: `-c role=${role}`, ...cfg })   // el rol se fija en el arranque de cada conexion
}

export function createPgRpc(pool: Pool): Rpc {
  return async (fn, args) => {
    if (!/^[a-z_]+$/.test(fn)) throw new Error('nombre de funcion no valido')
    const keys = Object.keys(args)
    if (keys.some(k => !/^p_[a-z_]+$/.test(k))) throw new Error('nombre de argumento no valido')
    const sql = `select to_jsonb(public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})) as r`
    const vals = keys.map(k => { const v = args[k]; return Array.isArray(v) && v.every(x => typeof x === 'string') ? v : v !== null && typeof v === 'object' ? JSON.stringify(v) : v })
    const { rows } = await pool.query(sql, vals)
    return rows[0]?.r ?? null
  }
}
