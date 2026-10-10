import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { assetKindFor, modelById, type GenerationOptions } from '@/lib/providers/catalog'
import { pollGeneration, type JobRef } from '@/lib/providers/adapters'
import type { FalJob } from '@/lib/providers/fal-queue'
import { persistGeneratedAsset } from '@/lib/providers/persist'
import { decryptJson } from '@/lib/security/tokens'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Trace = Record<string, unknown> & { options?: GenerationOptions }
/** v1 tokens (fal only) are still accepted so jobs started before this version can finish. */
type Token = { v: 2; ownerId: string; projectId: string; modelId: string; job: JobRef; trace: Trace; createdAt: number }
  | { v: 1; ownerId: string; projectId: string; modelId: string; job: FalJob; trace: Trace; createdAt: number }
const MAX_AGE_MS = 48 * 3600 * 1000

/**
 * Polls a queued generation. When the provider reports it done, every output is saved to the
 * Biblioteca once: a repeated poll finds the saved asset by its external id instead of storing a duplicate.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { token?: string } | null
  let t: Token
  try { t = decryptJson<Token>(body?.token ?? '') } catch { return NextResponse.json({ error: 'Trabajo no válido.' }, { status: 400 }) }
  if ((t.v !== 1 && t.v !== 2) || t.ownerId !== user.id) return NextResponse.json({ error: 'Trabajo no válido.' }, { status: 403 })
  if (Date.now() - t.createdAt > MAX_AGE_MS) return NextResponse.json({ state: 'expired', error: 'El trabajo es demasiado antiguo; el proveedor puede haber borrado el resultado.' }, { status: 410 })
  const model = modelById(t.modelId)
  if (!model) return NextResponse.json({ error: 'Modelo desconocido.' }, { status: 400 })
  const job: JobRef = t.v === 1 ? { provider: 'fal', fal: t.job } : t.job

  let result
  try { result = await pollGeneration(model, job) }
  catch (error) { return NextResponse.json({ state: 'unknown', error: error instanceof Error ? error.message : 'No se pudo consultar el proveedor; se volverá a intentar.' }) }
  if (result.state === 'failed') return NextResponse.json(result, { status: 502 })
  if (result.state !== 'done') return NextResponse.json(result)
  const outputs = result.media

  const assets = []
  for (const [i, media] of outputs.entries()) {
    const { data: existing } = await supabase.from('assets').select('id,owner_id,project_id,asset_type,storage_path,source_provider,provenance,created_at')
      .eq('owner_id', user.id).eq('provenance->>externalId', media.externalId).maybeSingle()
    if (existing) { assets.push(existing); continue }
    const requestId = `${job.provider}-${media.externalId.replace(/[^A-Za-z0-9-]/g, '')}-${i}`
    try {
      assets.push(await persistGeneratedAsset({ ownerId: user.id, projectId: t.projectId, requestId }, t.trace.purpose === 'thumbnail' && model.modality === 'image' ? 'thumbnail' : assetKindFor[model.modality], {
        provider: `${model.provider}:${model.label}`, externalId: media.externalId, uri: media.uri, mimeType: media.mimeType,
        metadata: { ...t.trace, model: model.id.slice(model.provider.length + 1), variant: i + 1, variants: outputs.length },
      }))
    } catch (error) {
      console.error('Studio job persistence failed', { requestId, details: error instanceof Error ? error.message : 'unknown' })
      return NextResponse.json({ state: 'failed', error: 'Se generó, pero no se pudo guardar en la Biblioteca. No repitas la generación; vuelve a comprobar en un momento.', assets }, { status: 500 })
    }
  }
  return NextResponse.json({ state: 'done', assets })
}
