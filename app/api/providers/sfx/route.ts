import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { elevenLabsConfigured, generateSoundEffect } from '@/lib/providers/elevenlabs'
import { persistGeneratedAsset } from '@/lib/providers/persist'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!elevenLabsConfigured()) return NextResponse.json({ error: 'La generación de efectos necesita ELEVENLABS_API_KEY en el servidor.', configured: false }, { status: 503 })
  const body = await request.json().catch(() => null) as { projectId?: string; prompt?: string; durationSeconds?: number } | null
  const projectId = body?.projectId?.trim(), prompt = body?.prompt?.trim()
  if (!projectId || !prompt || prompt.length > 450) return NextResponse.json({ error: 'Indica el proyecto y una descripción del sonido (máx. 450 caracteres).' }, { status: 400 })
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const requestId = crypto.randomUUID(), context = { ownerId: user.id, projectId, requestId }
  try {
    const generated = await generateSoundEffect(context, prompt, Number(body?.durationSeconds) || undefined)
    generated.metadata = { ...(generated.metadata ?? {}), title: prompt.slice(0, 80) }
    const asset = await persistGeneratedAsset(context, 'sfx', generated)
    return NextResponse.json({ requestId, asset }, { status: 201 })
  } catch (error) {
    console.error('SFX generation failure', { requestId, details: error instanceof Error ? error.message : 'unknown' })
    const code = Number(String(error).match(/\((\d{3})\)/)?.[1]) || null
    return NextResponse.json({ error: code === 401 ? 'ElevenLabs rechazó la clave API.' : code === 429 ? 'ElevenLabs alcanzó un límite de uso.' : 'No se pudo generar el efecto.', requestId }, { status: 503 })
  }
}
