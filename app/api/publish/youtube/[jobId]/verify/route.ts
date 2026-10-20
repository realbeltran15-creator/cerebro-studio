import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { publicationWriter } from '@/lib/supabase/admin'
import { PublishError, verifyPublishedVideo } from '@/lib/publication/youtube'

export const dynamic = 'force-dynamic'

/** Checks on YouTube that the uploaded video exists, belongs to the connected channel and has the expected visibility (1 unit). */
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await verifyPublishedVideo(supabase, user.id, jobId, publicationWriter(supabase)))
  } catch (error) {
    const status = error instanceof PublishError ? error.status : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo comprobar.' }, { status })
  }
}
