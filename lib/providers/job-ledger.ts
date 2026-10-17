/**
 * Server-side record of queued AI generations, so a paid job is never lost because the browser that started it was closed, cleared
 * or replaced by another device. Stored in the owner's `connector_configs` row (provider 'cerebro-studio', capability
 * 'generation_jobs'; RLS: owner only) — an existing table, so no migration is needed. A dedicated table is the cleaner long-term home.
 *
 * Each entry keeps the encrypted job token (already AES-GCM sealed, readable only by the server), so any page of the same owner can
 * resume polling it. Entries expire after 48 h (the job route refuses older tokens too) and finished ones are pruned after 7 days.
 * Writes are optimistic (compare-and-swap on updated_at, 3 attempts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type LedgerState = 'pending' | 'done' | 'failed' | 'expired'
export type LedgerJob = {
  id: string; token: string; modelId: string; label: string; modality: string; prompt: string; projectId: string
  estimateUsd: number; tier: string; createdAt: string; updatedAt: string; state: LedgerState; assetIds?: string[]; error?: string
}

const KEY = { provider: 'cerebro-studio', capability: 'generation_jobs' } as const
const MAX_JOBS = 100
export const JOB_TTL_MS = 48 * 3600e3
const KEEP_FINISHED_MS = 7 * 24 * 3600e3

export function prune(jobs: LedgerJob[], now = Date.now()): LedgerJob[] {
  return jobs
    .map(j => (j.state === 'pending' && now - Date.parse(j.createdAt) > JOB_TTL_MS ? { ...j, state: 'expired' as const, updatedAt: new Date(now).toISOString() } : j))
    .filter(j => j.state === 'pending' || now - Date.parse(j.updatedAt) < KEEP_FINISHED_MS)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_JOBS)
}

async function read(db: SupabaseClient, ownerId: string) {
  const { data } = await db.from('connector_configs').select('config,updated_at').eq('owner_id', ownerId).eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  const row = data as { config?: { jobs?: LedgerJob[] } | null; updated_at?: string } | null
  return { jobs: Array.isArray(row?.config?.jobs) ? row!.config!.jobs! : [], updatedAt: row?.updated_at ?? null, exists: Boolean(row) }
}

async function mutate(db: SupabaseClient, ownerId: string, change: (jobs: LedgerJob[]) => LedgerJob[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await read(db, ownerId)
    const jobs = prune(change(cur.jobs))
    const stamp = new Date().toISOString()
    if (!cur.exists) {
      const { error } = await db.from('connector_configs').insert({ owner_id: ownerId, ...KEY, enabled: true, priority: 0, config: { jobs }, updated_at: stamp })
      if (!error) return jobs
      continue   // another request created the row first: retry as an update
    }
    let q = db.from('connector_configs').update({ config: { jobs }, updated_at: stamp }).eq('owner_id', ownerId).eq('provider', KEY.provider).eq('capability', KEY.capability)
    if (cur.updatedAt) q = q.eq('updated_at', cur.updatedAt)
    const { data, error } = await q.select('owner_id')
    if (!error && data?.length) return jobs
  }
  throw new Error('No se pudo registrar el trabajo en el servidor (conflicto de escritura).')
}

export async function recordJob(db: SupabaseClient, ownerId: string, job: Omit<LedgerJob, 'state' | 'updatedAt'>) {
  const entry: LedgerJob = { ...job, state: 'pending', updatedAt: job.createdAt }
  await mutate(db, ownerId, jobs => [entry, ...jobs.filter(j => j.id !== entry.id)])
}

export async function markJob(db: SupabaseClient, ownerId: string, token: string, state: Exclude<LedgerState, 'pending'>, extra: { assetIds?: string[]; error?: string } = {}) {
  await mutate(db, ownerId, jobs => jobs.map(j => (j.token === token && j.state === 'pending' ? { ...j, state, ...extra, updatedAt: new Date().toISOString() } : j)))
}

export async function listJobs(db: SupabaseClient, ownerId: string): Promise<LedgerJob[]> {
  return prune((await read(db, ownerId)).jobs)
}
