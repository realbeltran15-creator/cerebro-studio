import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { enhancePrompt, TextProviderError, type PromptModality } from '@/lib/providers/openai-text'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const modalities: PromptModality[] = ['image', 'video', 'voice', 'music', 'sfx', 'ambient']

/** "Mejorar con ChatGPT": rewrites an idea into a provider prompt. Nothing is saved. */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { modality?: string; idea?: string; projectId?: string; sceneContext?: string } | null
  const modality = modalities.find(m => m === body?.modality)
  const idea = body?.idea?.trim()
  if (!modality || !idea || idea.length > 3000) return NextResponse.json({ error: 'Escribe una idea (máx. 3000 caracteres).' }, { status: 400 })
  let context = body?.sceneContext?.slice(0, 1200) ?? ''
  if (body?.projectId) {
    const { data: p } = await supabase.from('projects').select('name,description').eq('id', body.projectId).eq('owner_id', user.id).maybeSingle()
    if (p) context = `Proyecto: ${p.name}. ${p.description ?? ''}\n${context}`
  }
  try {
    return NextResponse.json(await enhancePrompt(modality, idea, context, crypto.randomUUID()))
  } catch (error) {
    const status = error instanceof TextProviderError && error.status === 429 ? 429 : 503
    return NextResponse.json({ error: error instanceof TextProviderError && error.status === null ? error.message : 'ChatGPT no pudo mejorar el prompt ahora. Inténtalo de nuevo.' }, { status })
  }
}
