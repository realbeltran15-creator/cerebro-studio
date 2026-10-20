import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { publicationWriter } from '@/lib/supabase/admin'
import { googleOAuthConfigured } from '@/lib/oauth/google'
import { publishJob, PublishError } from '@/lib/publication/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Uploads an approved job. Only ever called by the owner's explicit click. */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!googleOAuthConfigured()) return NextResponse.json({ error: 'La conexión con YouTube no está configurada en el servidor.' }, { status: 503 })
  // The owner confirms the exact destination channel (name and ID shown on screen) on every upload.
  const body = await request.json().catch(() => null) as { channelId?: unknown } | null
  const channelId = typeof body?.channelId === 'string' ? body.channelId.trim() : ''
  if (!/^UC[\w-]{22}$/.test(channelId)) return NextResponse.json({ error: 'Confirma el canal de destino (nombre e ID) antes de subir.' }, { status: 400 })
  try {
    return NextResponse.json(await publishJob(supabase, user.id, jobId, publicationWriter(supabase), channelId))
  } catch (error) {
    const status = error instanceof PublishError ? error.status : /approval is required/.test(String(error)) ? 403 : 500
    console.error('YouTube publish failure', { jobId, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: /approval is required/.test(String(error)) ? 'Publicación bloqueada: falta tu aprobación explícita.' : error instanceof Error ? error.message : 'La publicación falló.' }, { status })
  }
}
