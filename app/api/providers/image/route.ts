import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { OpenAIImageProvider } from '@/lib/providers/openai-image'
import { HttpImageProvider } from '@/lib/providers/http-adapters'
import { ProviderRegistry } from '@/lib/providers/registry'
import { persistGeneratedAsset } from '@/lib/providers/persist'
import { buildImagePrompt, presetFrom, sizeForFormat, type ImageQuality } from '@/lib/providers/image-presets'
import type { ImageGenerationProvider } from '@/lib/providers/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Generates one image for a project. The final prompt, preset, size and quality are stored in the
 * asset provenance so every result can be traced and reproduced.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { projectId?: string; prompt?: string; style?: string; preset?: string; format?: string; quality?: string; context?: string } | null
  const projectId = body?.projectId?.trim(), prompt = body?.prompt?.trim()
  if (!projectId || !prompt || prompt.length > 4000) return NextResponse.json({ error: 'Valid projectId and prompt are required' }, { status: 400 })
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const preset = presetFrom(body?.preset ?? body?.style)
  const format = body?.format === '9:16' || body?.format === '1:1' ? body.format : '16:9'
  // Medium is the default (cheaper than the provider's automatic setting); high is an explicit choice.
  const quality: ImageQuality = body?.quality === 'high' ? 'high' : 'medium'
  const size = sizeForFormat(format)
  const finalPrompt = buildImagePrompt({ subject: prompt, preset, format, context: body?.context ?? null })
  const requestId = crypto.randomUUID(), context = { ownerId: user.id, projectId, requestId }

  let generated
  try {
    const registry = new ProviderRegistry<ImageGenerationProvider>().register(new OpenAIImageProvider()).register(new HttpImageProvider())
    generated = await registry.execute(['openai-image', 'image-fallback'], p => p.generateImage(context, finalPrompt, { size, quality }))
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown provider error'
    console.error('Image provider failure', { requestId, details })
    const code = Number(details.match(/OpenAI image generation failed \((\d{3})\)/)?.[1]) || null
    const message = code === 401 ? 'OpenAI rechazó la clave API.'
      : code === 403 ? 'OpenAI rechazó el acceso al modelo o al proyecto.'
      : code === 429 ? 'OpenAI alcanzó un límite de uso o de facturación.'
      : code === 400 ? 'OpenAI rechazó los parámetros de generación.'
      : code && code >= 500 ? 'El servicio de imágenes de OpenAI no está disponible.'
      : 'El proveedor de imágenes no pudo completar la generación.'
    return NextResponse.json({ error: message, stage: 'provider', providerStatus: code, requestId }, { status: 503 })
  }
  generated.metadata = { ...(generated.metadata ?? {}), preset, style: preset, format, originalPrompt: prompt, finalPrompt }
  try {
    const asset = await persistGeneratedAsset(context, 'image', generated)
    return NextResponse.json({ requestId, preset, size, quality, provider: generated.provider, asset }, { status: 201 })
  } catch (error) {
    console.error('Image persistence failure', { requestId, details: error instanceof Error ? error.message : 'Unknown persistence error' })
    return NextResponse.json({ error: 'La imagen se generó, pero no se pudo guardar en la Biblioteca. No repitas la generación.', stage: 'storage', requestId }, { status: 500 })
  }
}
