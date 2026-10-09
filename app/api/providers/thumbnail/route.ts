import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { OpenAIImageProvider } from '@/lib/providers/openai-image'
import { HttpImageProvider } from '@/lib/providers/http-adapters'
import { ProviderRegistry } from '@/lib/providers/registry'
import { persistGeneratedAsset } from '@/lib/providers/persist'
import type { ImageGenerationProvider } from '@/lib/providers/types'

export const dynamic = 'force-dynamic'

const styles = {
  documentary: 'authentic documentary photography look, natural dramatic light, grounded realistic details',
  cinematic: 'cinematic film still, dramatic lighting, rich depth, premium color grading',
  illustration: 'bold editorial illustration, clean shapes, strong silhouettes',
  minimal: 'minimalist composition, one strong subject, generous negative space, clean background',
} as const
type Style = keyof typeof styles

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { projectId?: string; concept?: string; overlayText?: string; style?: string } | null
  const projectId = body?.projectId?.trim(), concept = body?.concept?.trim(), overlayText = body?.overlayText?.trim() ?? ''
  if (!projectId || !concept || concept.length > 1500 || overlayText.length > 40) {
    return NextResponse.json({ error: 'Indica el proyecto, un concepto (máx. 1500 caracteres) y un texto opcional de hasta 40 caracteres.' }, { status: 400 })
  }
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const style: Style = body?.style && body.style in styles ? body.style as Style : 'documentary'
  const textRule = overlayText
    ? `Include only this exact text, large, bold and legible, with strong contrast: "${overlayText}". No other text.`
    : 'No text, letters, logos or watermarks anywhere in the image.'
  const prompt = `YouTube video thumbnail, 16:9 landscape. Concept: ${concept}\n\nVisual direction: ${styles[style]}. One clear focal subject readable at small size, high contrast, uncluttered background, strong emotional clarity without exaggerated or misleading elements. ${textRule} Original image; do not imitate real people's likeness or brand marks.`

  const requestId = crypto.randomUUID(), context = { ownerId: user.id, projectId, requestId }
  const registry = new ProviderRegistry<ImageGenerationProvider>().register(new OpenAIImageProvider()).register(new HttpImageProvider())
  let generated
  try {
    generated = await registry.execute(['openai-image', 'image-fallback'], p => p.generateImage(context, prompt, { size: '1536x1024' }))
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown provider error'
    console.error('Thumbnail provider failure', { requestId, details })
    const code = Number(details.match(/OpenAI image generation failed \((\d{3})\)/)?.[1]) || null
    const message = details.includes('unavailable') && !code ? 'No hay proveedor de imágenes configurado (OPENAI_API_KEY).'
      : code === 401 ? 'OpenAI rechazó la clave API.'
      : code === 429 ? 'OpenAI alcanzó un límite de uso o de facturación.'
      : code === 400 ? 'OpenAI rechazó el concepto o los parámetros.'
      : 'El proveedor de imágenes no pudo generar la miniatura.'
    return NextResponse.json({ error: message, stage: 'provider', requestId }, { status: 503 })
  }

  generated.metadata = { ...(generated.metadata ?? {}), purpose: 'thumbnail', concept, overlayText: overlayText || null, style, selected: false }
  try {
    const asset = await persistGeneratedAsset(context, 'thumbnail', generated)
    return NextResponse.json({ requestId, asset }, { status: 201 })
  } catch (error) {
    console.error('Thumbnail persistence failure', { requestId, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: 'La miniatura se generó, pero no se pudo guardar. No repitas la generación.', stage: 'storage', requestId }, { status: 500 })
  }
}
