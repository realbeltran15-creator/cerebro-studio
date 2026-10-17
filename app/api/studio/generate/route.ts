import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { assetKindFor, catalog, evidenceOf, isConfigured, modelById, rightsOf, type GenerationOptions } from '@/lib/providers/catalog'
import { providerById } from '@/lib/providers/directory'
import { startGeneration } from '@/lib/providers/adapters'
import type { VoiceSettings } from '@/lib/providers/elevenlabs'
import { buildImageRequest, isPreset } from '@/lib/providers/image-presets'
import { fits } from '@/lib/providers/allowance'
import { buildAvailability, loadPoolStatuses } from '@/lib/providers/availability'
import { loadReferenceImages } from '@/lib/providers/references'
import { recommendAlternatives } from '@/lib/providers/router'
import { persistGeneratedAsset } from '@/lib/providers/persist'
import { encryptJson, tokenEncryptionConfigured } from '@/lib/security/tokens'
import { thumbnailPrompt, validThumbnail } from '@/lib/providers/thumbnail-prompt'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Body = {
  projectId?: string; sceneId?: string | null; modelId?: string; prompt?: string; negative?: string; preset?: string
  options?: GenerationOptions; voice?: string; voiceSettings?: VoiceSettings; instructions?: string; context?: string; language?: string
  /** How the model was chosen (manual or a strategy), recorded for traceability. */
  selection?: string; confirmedEstimateUsd?: number
  /** 'thumbnail': a 16:9 YouTube thumbnail saved as asset_type thumbnail (Miniaturas page). */
  purpose?: string; thumbnail?: { concept?: string; overlayText?: string; style?: string }
  /** Image assets of the same project used as identity references (consistent characters). */
  referenceAssetIds?: string[]
  /** Locked description of a recurring character, repeated in every scene. */
  identity?: string
  /** Only used to explain alternatives when the chosen provider is out of credits. */
  needsCommercial?: boolean
}

const suggestion = (r: ReturnType<typeof recommendAlternatives>) => ({
  message: r.message,
  free: r.free.slice(0, 4).map(x => ({ id: x.model.id, label: x.model.label, quality: x.model.quality, evidence: x.evidence, warnings: x.warnings })),
  // Paid options are information only: using one still needs the explicit cost confirmation.
  paid: r.paid.slice(0, 3).map(x => ({ id: x.model.id, label: x.model.label, estimateUsd: x.estimateUsd, requiresAuthorization: true })),
})

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
  if ((model.tier === 'paid' || model.confirm) && !(typeof body?.confirmedEstimateUsd === 'number' && body.confirmedEstimateUsd + 1e-6 >= estimateUsd)) {
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

  // ---------- References and free-allowance guard ----------
  const referenceIds = Array.isArray(body?.referenceAssetIds) ? body!.referenceAssetIds!.slice(0, 14).map(String) : []
  if (referenceIds.length && !model.references) return NextResponse.json({ error: `${model.label} no admite imágenes de referencia. Elige un modelo con referencias.` }, { status: 400 })
  let references: Awaited<ReturnType<typeof loadReferenceImages>> = []
  try { references = referenceIds.length ? await loadReferenceImages(supabase, user.id, projectId, referenceIds, model.references!.max) : [] }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudieron leer las referencias.' }, { status: 400 }) }
  options.references = references.length

  const pools = await loadPoolStatuses(supabase, user.id, catalog, process.env)
  const alternativesFor = (failed: string, exhaustedProviders: string[]) => suggestion(recommendAlternatives(catalog, {
    modality: model.modality, strategy: 'free_only', options, format: options.format, durationSeconds: options.durationSeconds,
    minQuality: Math.max(2, model.quality - 1), references: references.length || undefined, needsCommercial: Boolean(body?.needsCommercial),
  }, buildAvailability(catalog, process.env, pools, { jobsReady: tokenEncryptionConfigured(), exhaustedProviders }), failed))
  const allowanceUnits = model.allowanceUnits?.(options) ?? 0
  // A free-allowance model is never sent when Cerebro's own counter says the allowance is gone: some providers
  // (e.g. Alibaba with a verified account) would start charging. The user gets free alternatives, never an automatic paid switch.
  if (model.allowance && !fits(pools[model.allowance.pool], allowanceUnits)) {
    return NextResponse.json({ error: `Cupo gratuito agotado en ${model.label}: quedan ${Math.floor(pools[model.allowance.pool]?.remaining ?? 0)} ${model.allowance.unit} y esta generación necesita ${Math.ceil(allowanceUnits)}. No se ha enviado nada.`, exhausted: true, recommendation: alternativesFor(model.id, [model.provider]) }, { status: 409 })
  }

  const thumb = body?.purpose === 'thumbnail' ? validThumbnail(body.thumbnail) : null
  if (body?.purpose === 'thumbnail' && (!thumb || model.modality !== 'image')) return NextResponse.json({ error: 'Miniatura no válida: elige un modelo de imagen, un concepto (máx. 1500) y un texto de hasta 40 caracteres.' }, { status: 400 })
  if (thumb) options.format = '16:9'
  const format = options.format ?? '16:9'
  const preset = !thumb && model.modality === 'image' && isPreset(body?.preset) ? body.preset : null
  const built = !thumb && preset ? buildImageRequest({
    subject: prompt, preset, format, context: body?.context ?? null, identity: body?.identity ?? null,
    references: references.length ? { count: references.length, role: 'identity' } : undefined, nativeNegative: Boolean(model.negative), extraNegative: body?.negative ?? null,
  }) : null
  const finalPrompt = thumb ? thumbnailPrompt(thumb) : built ? built.prompt : prompt
  const negativePrompt = built?.negative ?? body?.negative
  const provider = providerById(model.provider)
  const trace = {
    catalogModel: model.id, providerName: provider?.name ?? model.provider, costTier: model.tier,
    originalPrompt: prompt, finalPrompt: finalPrompt.slice(0, 4000), negativePrompt: negativePrompt?.trim() || null, preset, sceneId, options,
    references: references.map(r => r.assetId), identity: body?.identity?.trim().slice(0, 600) || null,
    evidence: evidenceOf(model), rights: rightsOf(model),
    // What this generation took from the model's free allowance, so remaining credit can be tracked.
    ...(model.allowance ? { allowancePool: model.allowance.pool, allowanceUnits } : {}),
    voice: body?.voice ?? null, instructions: body?.instructions?.trim().slice(0, 500) || null, selection: body?.selection ?? 'manual',
    estimateUsd, priceConfirmed: model.priceConfirmed, estimateNote: 'Precio de lista estimado; la factura del proveedor es la referencia.',
    ...(thumb ? { purpose: 'thumbnail', concept: thumb.concept, overlayText: thumb.overlayText, style: thumb.style, selected: false } : {}),
  }
  const requestId = crypto.randomUUID()
  const context = { ownerId: user.id, projectId, requestId }

  let result
  try {
    if (!model.sync && !tokenEncryptionConfigured()) return NextResponse.json({ error: 'Falta TOKEN_ENCRYPTION_KEY para seguir trabajos largos.' }, { status: 503 })
    result = await startGeneration({ model, prompt, finalPrompt, negative: negativePrompt, references, options, voice: body?.voice, voiceSettings: body?.voiceSettings, instructions: body?.instructions, language: body?.language, context })
  } catch (error) {
    const details = error instanceof Error ? error.message : 'unknown'
    console.error('Studio generation failed', { model: model.id, requestId, details })
    const code = Number(details.match(/\((\d{3})\)/)?.[1]) || null
    const message = code === 401 || code === 403 ? 'El proveedor rechazó la clave API o el acceso al modelo.'
      : code === 402 || code === 429 ? 'El proveedor indica límite de uso, cupo gratuito agotado o saldo insuficiente.'
      : code === 400 || code === 422 ? 'El proveedor rechazó los parámetros o el texto.'
      : /no válid|rechazó/.test(details) ? details
      : 'El proveedor no pudo completar la generación.'
    // Out of credits / no balance: suggest free alternatives (never switches by itself, never picks a paid model).
    const recommendation = code === 429 || code === 402 ? alternativesFor(model.id, [model.provider]) : code === 403 ? alternativesFor(model.id, []) : undefined
    return NextResponse.json({ error: message, providerStatus: code, requestId, ...(recommendation ? { recommendation } : {}) }, { status: 502 })
  }

  if (result.kind === 'job') {
    const token = encryptJson({ v: 2, ownerId: user.id, projectId, modelId: model.id, job: result.job, trace, createdAt: Date.now() })
    return NextResponse.json({ job: { token, requestId: result.externalId, modelId: model.id, estimateUsd } }, { status: 202 })
  }
  try {
    const assets = []
    for (const [i, generated] of result.assets.entries()) {
      generated.metadata = { ...(generated.metadata ?? {}), ...trace }
      assets.push(await persistGeneratedAsset(i === 0 ? context : { ...context, requestId: `${requestId}-${i}` }, thumb ? 'thumbnail' : assetKindFor[model.modality], generated))
    }
    return NextResponse.json({ assets, estimateUsd }, { status: 201 })
  } catch (error) {
    console.error('Studio persistence failed', { requestId, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: 'Se generó, pero no se pudo guardar en la Biblioteca. No repitas la generación.', requestId }, { status: 500 })
  }
}
