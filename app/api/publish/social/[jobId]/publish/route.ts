import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { publicationWriter } from '@/lib/supabase/admin'
import { publishSocialJob, SocialPublishError } from '@/lib/publication/social'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Publishes an approved Instagram/TikTok job. Only ever called by the owner's explicit click. */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // The owner confirms the exact destination account (name and ID shown on screen) on every publication.
  const body = await request.json().catch(() => null) as { accountId?: unknown } | null
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : ''
  if (!accountId || accountId.length > 128) return NextResponse.json({ error: 'Confirma la cuenta de destino antes de publicar.' }, { status: 400 })
  try {
    return NextResponse.json(await publishSocialJob(supabase, user.id, jobId, publicationWriter(supabase), accountId))
  } catch (error) {
    const blocked = /approval is required/.test(String(error))
    const status = error instanceof SocialPublishError ? error.status : blocked ? 403 : 500
    console.error('Social publish failure', { jobId, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: blocked ? 'Publicación bloqueada: falta tu aprobación explícita.' : error instanceof Error ? error.message : 'La publicación falló.', pending: status === 202 }, { status })
  }
}
