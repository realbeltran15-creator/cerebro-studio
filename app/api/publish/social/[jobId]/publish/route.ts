import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { publishSocialJob, SocialPublishError } from '@/lib/publication/social'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Publishes an approved Instagram/TikTok job. Only ever called by the owner's explicit click. */
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await publishSocialJob(supabase, user.id, jobId))
  } catch (error) {
    const blocked = /approval is required/.test(String(error))
    const status = error instanceof SocialPublishError ? error.status : blocked ? 403 : 500
    console.error('Social publish failure', { jobId, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: blocked ? 'Publicación bloqueada: falta tu aprobación explícita.' : error instanceof Error ? error.message : 'La publicación falló.', pending: status === 202 }, { status })
  }
}
