import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { assetKindFor, falEndpoint, falInput, isConfigured, modelById, type GenerationOptions } from '@/lib/providers/catalog'
import { falSubmit } from '@/lib/providers/fal-queue'
import { OpenAIImageProvider } from '@/lib/providers/openai-image'
import { composeMusic, generateSoundEffect, synthesizeWithSettings, type VoiceSettings } from '@/lib/providers/elevenlabs'
import { synthesizeSteerable } from '@/lib/providers/openai-voice'
import { buildImagePrompt, isPreset, sizeForFormat } from '@/lib/providers/image-presets'
import { persistGeneratedAsset } from '@/lib/providers/persist'
import { encryptJson, tokenEncryptionConfigured } from '@/lib/security/tokens'
import type { GeneratedAsset } from '@/lib/providers/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Body = {
  projectId?: string; sceneId?: string | null; modelId?: string; prompt?: string; negative?: string; preset?: string
  options?: GenerationOptions; voice?: string; voiceSettings?: VoiceSettings; instructions?: string; context?: string
}

/**
 * Creation Studio: one explicit click = one generation. Fast providers answer here and the asset is
 * saved to the Biblioteca; queued providers (fal.ai) return an encrypted job token that the page polls
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

  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 })
  let sceneId: string | null = null
  if (body?.sceneId) {
    const { data: scene } = await supabase.from('scenes').select('id').eq('id', body.sceneId).eq('owner_id', user.id).maybeSingle()
    if (!scene) return NextResponse.json({ error: 'Escena no encontrada.' }, { status: 404 })
    sceneId = scene.id
  }

  const options: GenerationOptions = body?.options ?? {}
  const format = options.format ?? '16:9'
  const preset = model.modality === 'image' && isPreset(body?.preset) ? body.preset : null
  const finalPrompt = preset ? buildImagePrompt({ subject: prompt, preset, format, context: body?.context ?? null }) : prompt
  const estimateUsd = Math.round(model.estimateUsd(options) * 1000) / 1000
  const trace = { catalogModel: model.id, originalPrompt: prompt, finalPrompt: finalPrompt.slice(0, 4000), preset, sceneId, options, estimateUsd, estimateNote: 'Precio de lista estimado; la factura del proveedor es la referencia.' }

  // ---------- Queued (fal.ai) ----------
  if (!model.sync) {
    if (!tokenEncryptionConfigured()) return NextResponse.json({ error: 'Falta TOKEN_ENCRYPTION_KEY para seguir trabajos largos.' }, { status: 503 })
    try {
      const endpoint = falEndpoint(model)
      const job = await falSubmit(endpoint, falInput(model, finalPrompt, options, body?.negative))
      const token = encryptJson({ v: 1, ownerId: user.id, projectId, modelId: model.id, job, trace, createdAt: Date.now() })
      return NextResponse.json({ job: { token, requestId: job.requestId, modelId: model.id, estimateUsd } }, { status: 202 })
    } catch (error) {
      console.error('Studio queue submit failed', { model: model.id, details: error instanceof Error ? error.message : 'unknown' })
      return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo enviar el trabajo.' }, { status: 502 })
    }
  }

  // ---------- Immediate ----------
  const requestId = crypto.randomUUID()
  const context = { ownerId: user.id, projectId, requestId }
  let generated: GeneratedAsset
  try {
    switch (model.id) {
      case 'openai:gpt-image-1':
        generated = await new OpenAIImageProvider().generateImage(context, finalPrompt, { size: sizeForFormat(format), quality: options.quality === 'high' ? 'high' : 'medium' })
        break
      case 'elevenlabs:eleven_multilingual_v2': {
        const voice = body?.voice?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() || ''
        generated = await synthesizeWithSettings(context, prompt, voice, body?.voiceSettings)
        break
      }
      case 'openai:gpt-4o-mini-tts':
        generated = await synthesizeSteerable(context, prompt, body?.voice ?? 'onyx', body?.instructions)
        break
      case 'elevenlabs:music_v1':
        generated = await composeMusic(context, finalPrompt, options.durationSeconds ?? 30, options.instrumental !== false)
        break
      case 'elevenlabs:sound-generation':
        generated = await generateSoundEffect(context, finalPrompt, options.durationSeconds)
        break
      default:
        return NextResponse.json({ error: 'Modelo sin adaptador.' }, { status: 400 })
    }
  } catch (error) {
    const details = error instanceof Error ? error.message : 'unknown'
    console.error('Studio generation failed', { model: model.id, requestId, details })
    const code = Number(details.match(/\((\d{3})\)/)?.[1]) || null
    const message = code === 401 ? 'El proveedor rechazó la clave API.'
      : code === 402 || code === 429 ? 'El proveedor indica límite de uso o saldo insuficiente.'
      : code === 400 || code === 422 ? 'El proveedor rechazó los parámetros o el texto.'
      : details.includes('no válida') ? details
      : 'El proveedor no pudo completar la generación.'
    return NextResponse.json({ error: message, providerStatus: code, requestId }, { status: 502 })
  }
  generated.metadata = { ...(generated.metadata ?? {}), ...trace }
  try {
    const asset = await persistGeneratedAsset(context, assetKindFor[model.modality], generated)
    return NextResponse.json({ assets: [asset], estimateUsd }, { status: 201 })
  } catch (error) {
    console.error('Studio persistence failed', { requestId, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: 'Se generó, pero no se pudo guardar en la Biblioteca. No repitas la generación.', requestId }, { status: 500 })
  }
}
