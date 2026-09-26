import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { googleOAuthConfigured } from '@/lib/oauth/google'
import { publishJob, PublishError } from '@/lib/publication/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Uploads an approved job. Only ever called by the owner's explicit click. */
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!googleOAuthConfigured()) return NextResponse.json({ error: 'La conexión con YouTube no está configurada en el servidor.' }, { status: 503 })
  try {
    return NextResponse.json(await publishJob(supabase, user.id, jobId))
  } catch (error) {
    const status = error instanceof PublishError ? error.status : /approval is required/.test(String(error)) ? 403 : 500
    console.error('YouTube publish failure', { jobId, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: /approval is required/.test(String(error)) ? 'Publicación bloqueada: falta tu aprobación explícita.' : error instanceof Error ? error.message : 'La publicación falló.' }, { status })
  }
}
