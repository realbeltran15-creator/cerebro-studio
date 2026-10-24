import type { SupabaseClient } from '@supabase/supabase-js'
import { storageDriver } from './server'

/**
 * Space check shared by every upload route: sizes come from each asset's recorded size. Default quota keeps the account inside the free
 * allowance (R2: 9 of the 10 GB-month free; Supabase Free: 0.95 of 1 GB, leaving room for the database's own files). STORAGE_QUOTA_GB overrides it.
 */
export async function checkQuota(db: SupabaseClient, ownerId: string, incomingBytes: number) {
  const quotaBytes = Math.max(0.1, Number(process.env.STORAGE_QUOTA_GB) || (storageDriver() === 'r2' ? 9 : 0.95)) * 1024 ** 3
  const { data: rows } = await db.from('assets').select('bytes:provenance->bytes').eq('owner_id', ownerId).limit(20000)
  const usedBytes = (rows ?? []).reduce((a, r) => a + (Number((r as { bytes?: unknown }).bytes) || 0), 0)
  const gb = (n: number) => (n / 1024 ** 3).toFixed(2)
  const ok = usedBytes + Math.max(0, incomingBytes) <= quotaBytes
  return { ok, usedBytes, quotaBytes, error: ok ? '' : `Espacio en la nube lleno: usas ${gb(usedBytes)} GB de ${gb(quotaBytes)} GB. Borra archivos que no necesites en la Biblioteca o sube el límite (STORAGE_QUOTA_GB).` }
}
