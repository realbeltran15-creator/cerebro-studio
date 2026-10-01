import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { assetKindFor, isConfigured, modelById, type GenerationOptions } from '@/lib/providers/catalog'
import { providerById } from '@/lib/providers/directory'
import { startGeneration } from '@/lib/providers/adapters'
import type { VoiceSettings } from '@/lib/providers/elevenlabs'
import { buildImagePrompt, isPreset } from '@/lib/providers/image-presets'
import { persistGeneratedAsset } from '@/lib/providers/persist'
import { encryptJson, tokenEncryptionConfigured } from '@/lib/security/tokens'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Body = {
  projectId?: string; sceneId?: string | null; modelId?: string; prompt?: string; negative?: string; preset?: string
  options?: GenerationOptions; voice?: string; voiceSettings?: VoiceSettings; instructions?: string; context?: string; language?: string
  /** How the model was chosen (manual or a strategy), recorded for traceability. */
  selection?: string; confirmedEstimateUsd?: number
}

/**
 * Creation Studio: one explicit click = one generation. Providers that answer at once are saved
 * to the Biblioteca here; queued providers return an encrypted job token that the page polls
 * through /api/studio/job. Nothing is retried automatically, so a failure never charges twice.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as Body | null
  const model = modelById(body?.modelId ?? '')
  const prompt = body?.prompt?.trim()
  const projectId = body?.projectId?.trim()
  if (!model || !projectId || !prompt || prompt.length > 4000) return NextResponse.json({ error: 'Elige proyecto, modelo y escribe un prompt (máx. 4000 caracteres).' }, { status: 400 })
  if (!isConfigured(model, process.env)) return NextResponse.json({ error: `${model.label} no está configurado en el servidor.` }, { status: 503 })

  const options: GenerationOptions = body?.options ?? {}
  const estimateUsd = Math.round(model.estimateUsd(options) * 1000) / 1000
  // A paid generation must carry the estimate the user confirmed; a bigger one is refused.
  if (model.tier === 'paid' && !(typeof body?.confirmedEstimateUsd === 'number' && body.confirmedEstimateUsd + 1e-6 >= estimateUsd)) {
    return NextResponse.json({ error: 'Falta confirmar el coste estimado antes de generar.' }, { status: 409 })
  }

  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 })
  let sceneId: string | null = null
  if (body?.sceneId) {
    const { data: scene } = await supabase.from('scenes').select('id').eq('id', body.sceneId).eq('owner_id', user.id).maybeSingle()
    if (!scene) return NextResponse.json({ error: 'Escena no encontrada.' }, { status: 404 })
    sceneId = scene.id
  }

  const format = options.format ?? '16:9'
  const preset = model.modality === 'image' && isPreset(body?.preset) ? body.preset : null
  const finalPrompt = preset ? buildImagePrompt({ subject: prompt, preset, format, context: body?.context ?? null }) : prompt
  const provider = providerById(model.provider)
  const trace = {
    catalogModel: model.id, providerName: provider?.name ?? model.provider, costTier: model.tier,
    originalPrompt: prompt, finalPrompt: finalPrompt.slice(0, 4000), negativePrompt: body?.negative?.trim() || null, preset, sceneId, options,
    voice: body?.voice ?? null, instructions: body?.instructions?.trim().slice(0, 500) || null, selection: body?.selection ?? 'manual',
    estimateUsd, priceConfirmed: model.priceConfirmed, estimateNote: 'Precio de lista estimado; la factura del proveedor es la referencia.',
  }
  const requestId = crypto.randomUUID()
  const context = { ownerId: user.id, projectId, requestId }

  let result
  try {
    if (!model.sync && !tokenEncryptionConfigured()) return NextResponse.json({ error: 'Falta TOKEN_ENCRYPTION_KEY para seguir trabajos largos.' }, { status: 503 })
    result = await startGeneration({ model, prompt, finalPrompt, negative: body?.negative, options, voice: body?.voice, voiceSettings: body?.voiceSettings, instructions: body?.instructions, language: body?.language, context })
  } catch (error) {
    const details = error instanceof Error ? error.message : 'unknown'
    console.error('Studio generation failed', { model: model.id, requestId, details })
    const code = Number(details.match(/\((\d{3})\)/)?.[1]) || null
    const message = code === 401 || code === 403 ? 'El proveedor rechazó la clave API o el acceso al modelo.'
      : code === 402 || code === 429 ? 'El proveedor indica límite de uso, cupo gratuito agotado o saldo insuficiente.'
      : code === 400 || code === 422 ? 'El proveedor rechazó los parámetros o el texto.'
      : /no válid|rechazó/.test(details) ? details
      : 'El proveedor no pudo completar la generación.'
    return NextResponse.json({ error: message, providerStatus: code, requestId }, { status: 502 })
  }

  if (result.kind === 'job') {
    const token = encryptJson({ v: 2, ownerId: user.id, projectId, modelId: model.id, job: result.job, trace, createdAt: Date.now() })
    return NextResponse.json({ job: { token, requestId: result.externalId, modelId: model.id, estimateUsd } }, { status: 202 })
  }
  try {
    const assets = []
    for (const [i, generated] of result.assets.entries()) {
      generated.metadata = { ...(generated.metadata ?? {}), ...trace }
      assets.push(await persistGeneratedAsset(i === 0 ? context : { ...context, requestId: `${requestId}-${i}` }, assetKindFor[model.modality], generated))
    }
    return NextResponse.json({ assets, estimateUsd }, { status: 201 })
  } catch (error) {
    console.error('Studio persistence failed', { requestId, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: 'Se generó, pero no se pudo guardar en la Biblioteca. No repitas la generación.', requestId }, { status: 500 })
  }
}
