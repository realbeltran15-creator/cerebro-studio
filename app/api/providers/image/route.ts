import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { OpenAIImageProvider } from '@/lib/providers/openai-image'
import { ProviderRegistry } from '@/lib/providers/registry'
import { persistGeneratedAsset } from '@/lib/providers/persist'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { projectId?: string; prompt?: string } | null
  const projectId = body?.projectId?.trim()
  const prompt = body?.prompt?.trim()
  if (!projectId || !prompt) return NextResponse.json({ error: 'projectId and prompt are required' }, { status: 400 })

  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const requestId = crypto.randomUUID()
  const context = { ownerId: user.id, projectId, requestId }

  try {
    const registry = new ProviderRegistry<OpenAIImageProvider>().register(new OpenAIImageProvider())
    const provider = await registry.resolve('openai-image')
    const generated = await provider.generateImage(context, prompt)
    const asset = await persistGeneratedAsset(context, 'image', generated)
    return NextResponse.json({ requestId, asset }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image generation failed.'
    return NextResponse.json({ error: message, requestId }, { status: 503 })
  }
}
