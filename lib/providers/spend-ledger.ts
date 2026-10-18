import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceRoleClient } from '@/lib/supabase/admin'
import type { PendingSpend } from './spend'

/**
 * Server-owned spend ledger (table public.generation_spend, migration 20261018120000_server_owned_security.sql).
 * One append-only row per paid generation sent to a provider, written ONLY with the service role. The owner can read it (RLS select) but
 * cannot insert, update or delete, so deleting generated files no longer lowers the spend counted by the caps.
 * Before the migration is applied the table does not exist: reads return null and writes are skipped; the cap then works as before.
 */
export type SpendEntry = { ownerId: string; requestId: string; provider: string; model: string; tier: string; estimateUsd: number }

const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /generation_spend/.test(e.message ?? '') && /does not exist|not find/i.test(e.message ?? ''))

/** Ledger rows of the owner since `sinceIso`. null = ledger not available (table missing or unreadable). */
export async function ledgerSpend(db: SupabaseClient, ownerId: string, sinceIso: string): Promise<PendingSpend[] | null> {
  const reader = serviceRoleClient() ?? db
  const { data, error } = await reader.from('generation_spend').select('created_at,estimate_usd,tier').eq('owner_id', ownerId).gte('created_at', sinceIso).limit(10000)
  if (error) return null
  return ((data ?? []) as Array<{ created_at: string; estimate_usd: number | string; tier: string }>).map(r => ({ createdAt: r.created_at, estimateUsd: Number(r.estimate_usd), tier: r.tier }))
}

/**
 * Books a paid generation BEFORE it is sent (the provider may charge even if the job later fails).
 * Returns 'recorded', 'unavailable' (no service role or table not migrated yet: pre-migration behaviour) or 'failed' (the caller refuses).
 */
export async function recordSpend(e: SpendEntry): Promise<'recorded' | 'unavailable' | 'failed'> {
  const admin = serviceRoleClient()
  if (!admin) return 'unavailable'
  const { error } = await admin.from('generation_spend').insert({ owner_id: e.ownerId, request_id: e.requestId, provider: e.provider, model: e.model, tier: e.tier, estimate_usd: e.estimateUsd })
  if (!error) return 'recorded'
  return missingTable(error) ? 'unavailable' : 'failed'
}
