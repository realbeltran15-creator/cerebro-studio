import type { SupabaseClient } from '@supabase/supabase-js'
import { parseBible } from './bible'
import { identityReadiness, parseTraits } from './identity'
import { overall, type CheckResult } from './quality'
import { adapterById, adapterStatus, type ViJobKind } from './providers'
import { preflight } from './preflight'
import type { GeneratedAsset } from '@/lib/providers/types'

/**
 * Server-side operations of the Virtual Influencer Studio. They take a user-session client
 * (RLS applies) and re-check every rule instead of trusting the browser.
 */

export class ViError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

type Persona = { id: string; owner_id: string; project_id: string; name: string; status: string; bible: unknown; current_identity_version: number | null; budget_eur: number; spent_eur: number }

export async function loadPersona(db: SupabaseClient, ownerId: string, personaId: string) {
  const { data, error } = await db.from('vi_personas').select('id,owner_id,project_id,name,status,bible,current_identity_version,budget_eur,spent_eur').eq('id', personaId).eq('owner_id', ownerId).maybeSingle()
  if (error) throw new ViError(error.message, 500)
  if (!data) throw new ViError('Persona no encontrada.', 404)
  const p = data as Persona
  return { ...p, budget_eur: Number(p.budget_eur), spent_eur: Number(p.spent_eur) }
}

async function reportFor(db: SupabaseClient, subjectType: 'identity_version' | 'generation_job', subjectId: string) {
  const { data } = await db.from('vi_quality_reports').select('checks,overall').eq('subject_type', subjectType).eq('subject_id', subjectId).maybeSingle()
  return data as { checks: CheckResult[]; overall: string } | null
}

/** Human approval of an identity version: requires a ready bible/traits/references and a passed quality review. */
export async function approveIdentityVersion(db: SupabaseClient, ownerId: string, personaId: string, versionId: string) {
  const persona = await loadPersona(db, ownerId, personaId)
  const { data: v } = await db.from('vi_identity_versions').select('id,version,status,traits').eq('id', versionId).eq('persona_id', personaId).eq('owner_id', ownerId).maybeSingle()
  const version = v as { id: string; version: number; status: string; traits: unknown } | null
  if (!version) throw new ViError('Versión de identidad no encontrada.', 404)
  if (version.status !== 'draft') throw new ViError('Solo se aprueban versiones en borrador; las aprobadas no se modifican.', 409)
  const { data: refs } = await db.from('vi_references').select('category,approved,asset_id').eq('persona_id', personaId).eq('owner_id', ownerId)
  const references = (refs ?? []) as Array<{ category: string; approved: boolean; asset_id: string }>
  const readiness = identityReadiness({ bible: parseBible(persona.bible), traits: parseTraits(version.traits), references })
  if (!readiness.ready) throw new ViError(`La versión no está lista: ${readiness.missing.slice(0, 5).join(' ')}`, 409)
  const report = await reportFor(db, 'identity_version', version.id)
  if (!report || overall(report.checks) !== 'pass') throw new ViError('La revisión de calidad de esta versión no está superada (todos los controles deben pasar).', 409)

  const now = new Date().toISOString()
  const { error: approvalError } = await db.from('approvals').upsert({
    owner_id: ownerId, action_type: 'vi_identity', entity_type: 'vi_identity_version', entity_id: version.id, status: 'approved',
    risk_summary: `Identidad v${version.version} de ${persona.name}: ${references.filter(r => r.approved).length} referencias aprobadas; revisión de calidad superada.`, decided_at: now,
  }, { onConflict: 'owner_id,action_type,entity_type,entity_id,status' })
  if (approvalError) throw new ViError(approvalError.message, 500)
  await db.from('vi_identity_versions').update({ status: 'superseded' }).eq('persona_id', personaId).eq('owner_id', ownerId).eq('status', 'approved')
  const approvedIds = references.filter(r => r.approved && !['voice_sample', 'environment', 'wardrobe'].includes(r.category)).map(r => r.asset_id)
  const { error } = await db.from('vi_identity_versions').update({ status: 'approved', approved_at: now, reference_asset_ids: approvedIds }).eq('id', version.id).eq('owner_id', ownerId)
  if (error) throw new ViError(error.message, 500)
  await db.from('vi_personas').update({ current_identity_version: version.version, status: 'approved', updated_at: now }).eq('id', personaId).eq('owner_id', ownerId)
  return { version: version.version, approvedAt: now }
}

export type JobRequest = { kind: ViJobKind; adapterId: string; prompt: string; inputs?: Record<string, unknown>; estimatedCostEur?: number | null }

/** Creates a job after server-side preflight. Blocked jobs are stored with their reasons; nothing is spent. */
export async function createJob(db: SupabaseClient, ownerId: string, personaId: string, req: JobRequest, env: Record<string, string | undefined> = process.env) {
  const persona = await loadPersona(db, ownerId, personaId)
  const adapter = adapterById(req.adapterId)
  if (!adapter || adapter.kind !== req.kind) throw new ViError('Proveedor no válido para este tipo de trabajo.')
  const { count } = await db.from('vi_references').select('id', { count: 'exact', head: true }).eq('persona_id', personaId).eq('owner_id', ownerId).eq('approved', true)
  let voiceProfileApproved: boolean | undefined
  const voiceProfileId = typeof req.inputs?.voiceProfileId === 'string' ? req.inputs.voiceProfileId : null
  if (req.kind === 'voice') {
    const { data } = voiceProfileId ? await db.from('vi_voice_profiles').select('status').eq('id', voiceProfileId).eq('owner_id', ownerId).maybeSingle() : { data: null }
    voiceProfileApproved = (data as { status: string } | null)?.status === 'approved'
  }
  const estimate = typeof req.estimatedCostEur === 'number' && Number.isFinite(req.estimatedCostEur) && req.estimatedCostEur >= 0 ? Math.round(req.estimatedCostEur * 10000) / 10000 : null
  const reasons = preflight({
    adapter, adapterStatus: adapterStatus(adapter, env), budgetEur: persona.budget_eur, spentEur: persona.spent_eur, estimatedCostEur: estimate,
    identityApproved: persona.current_identity_version !== null, approvedReferenceCount: count ?? 0, prompt: req.prompt ?? '', voiceProfileApproved,
  })
  const { data, error } = await db.from('vi_generation_jobs').insert({
    owner_id: ownerId, persona_id: personaId, identity_version: persona.current_identity_version, kind: req.kind, provider: adapter.id,
    status: reasons.length ? 'blocked' : 'queued', blocked_reasons: reasons, prompt: (req.prompt ?? '').slice(0, 4000),
    inputs: req.inputs ?? {}, estimated_cost_eur: estimate,
  }).select('id,status,blocked_reasons').single()
  if (error) throw new ViError(error.message, 500)
  return data as { id: string; status: string; blocked_reasons: string[] }
}

export type Generate = (job: { id: string; kind: ViJobKind; provider: string; prompt: string; inputs: Record<string, unknown> }) => Promise<GeneratedAsset>
export type Persist = (asset: GeneratedAsset) => Promise<{ id: string }>

/**
 * Runs one queued job with an injected generator (real adapter or a test mock). The estimated cost
 * is reserved against the budget before calling the provider; the job ends in needs_review, never approved.
 */
export async function dispatchJob(db: SupabaseClient, ownerId: string, jobId: string, generate: Generate, persist: Persist) {
  const { data } = await db.from('vi_generation_jobs').select('id,persona_id,kind,provider,status,prompt,inputs,estimated_cost_eur').eq('id', jobId).eq('owner_id', ownerId).maybeSingle()
  const job = data as { id: string; persona_id: string; kind: ViJobKind; provider: string; status: string; prompt: string | null; inputs: Record<string, unknown>; estimated_cost_eur: number | null } | null
  if (!job) throw new ViError('Trabajo no encontrado.', 404)
  // Claim the job atomically so two requests cannot run (and pay for) it twice.
  const { data: claimed } = await db.from('vi_generation_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', jobId).eq('owner_id', ownerId).eq('status', 'queued').select('id')
  if (!claimed?.length) throw new ViError('El trabajo no está en cola (ya se ejecutó o está bloqueado).', 409)
  const persona = await loadPersona(db, ownerId, job.persona_id)
  const reserve = Number(job.estimated_cost_eur ?? 0)
  if (reserve > 0) await db.from('vi_personas').update({ spent_eur: Math.round((persona.spent_eur + reserve) * 100) / 100, updated_at: new Date().toISOString() }).eq('id', persona.id).eq('owner_id', ownerId)
  try {
    const asset = await generate({ id: job.id, kind: job.kind, provider: job.provider, prompt: job.prompt ?? '', inputs: job.inputs ?? {} })
    const saved = await persist(asset)
    const cost = asset.metadata?.cost as { amount?: number; currency?: string; reported?: boolean } | undefined
    await db.from('vi_generation_jobs').update({
      status: 'needs_review', output_asset_id: saved.id, updated_at: new Date().toISOString(),
      actual_cost_eur: cost?.reported && cost.currency === 'EUR' ? cost.amount ?? null : null, cost_reported: Boolean(cost?.reported && cost.currency === 'EUR'),
    }).eq('id', job.id).eq('owner_id', ownerId)
    return { status: 'needs_review' as const, assetId: saved.id }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'La generación falló.'
    await db.from('vi_generation_jobs').update({ status: 'failed', error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId)
    return { status: 'failed' as const, error: message }
  }
}

/** Human review of a generated result. Approval requires a passed quality report and explicit confirmation. */
export async function reviewJob(db: SupabaseClient, ownerId: string, jobId: string, decision: 'approved' | 'rejected', note: string | null) {
  const { data } = await db.from('vi_generation_jobs').select('id,persona_id,status,output_asset_id').eq('id', jobId).eq('owner_id', ownerId).maybeSingle()
  const job = data as { id: string; persona_id: string; status: string; output_asset_id: string | null } | null
  if (!job) throw new ViError('Trabajo no encontrado.', 404)
  if (job.status !== 'needs_review') throw new ViError('Solo se revisan resultados pendientes de revisión.', 409)
  if (decision === 'approved') {
    const report = await reportFor(db, 'generation_job', job.id)
    if (!report || overall(report.checks) !== 'pass') throw new ViError('La revisión de calidad no está superada.', 409)
  }
  const now = new Date().toISOString()
  const { error: approvalError } = await db.from('approvals').upsert({
    owner_id: ownerId, action_type: 'vi_output', entity_type: 'vi_generation_job', entity_id: job.id, status: decision,
    risk_summary: note?.slice(0, 1000) || null, decided_at: now,
  }, { onConflict: 'owner_id,action_type,entity_type,entity_id,status' })
  if (approvalError) throw new ViError(approvalError.message, 500)
  await db.from('vi_generation_jobs').update({ status: decision, updated_at: now }).eq('id', job.id).eq('owner_id', ownerId)
  return { status: decision }
}
