import type { SupabaseClient } from '@supabase/supabase-js'
import { approvalSeal, verifyApprovalSeal, type SealInput } from './seal'

/** Fields of a publication job that the approval seal covers. */
export type SealableJob = { id: string; owner_id: string; platform: string; idempotency_key: string | null; payload: { videoAssetId?: string }; result: Record<string, unknown> | null }

export async function videoStoragePath(db: SupabaseClient, ownerId: string, assetId: string | undefined): Promise<string | null> {
  if (!assetId) return null
  const { data } = await db.from('assets').select('storage_path').eq('id', assetId).eq('owner_id', ownerId).maybeSingle()
  const path = (data as { storage_path?: unknown } | null)?.storage_path
  return typeof path === 'string' ? path : null
}

export async function sealInputFor(db: SupabaseClient, job: SealableJob): Promise<SealInput> {
  return { ownerId: job.owner_id, jobId: job.id, platform: job.platform, idempotencyKey: job.idempotency_key ?? '', payload: job.payload, videoStoragePath: await videoStoragePath(db, job.owner_id, job.payload.videoAssetId) }
}

/** Seal to store with the job when the owner approves it (server only). */
export async function sealFor(db: SupabaseClient, job: SealableJob) {
  return { approvalSeal: approvalSeal(await sealInputFor(db, job)), approvalSealedAt: new Date().toISOString() }
}

/** True when the job's stored seal matches what is in the job right now. */
export async function approvalStillValid(db: SupabaseClient, job: SealableJob) {
  return verifyApprovalSeal(await sealInputFor(db, job), job.result?.approvalSeal)
}

export const STALE_APPROVAL_MESSAGE = 'La aprobación no corresponde al contenido actual de este trabajo (se cambió después de aprobarlo o se aprobó antes de esta protección). Revisa el borrador y vuelve a aprobarlo.'
