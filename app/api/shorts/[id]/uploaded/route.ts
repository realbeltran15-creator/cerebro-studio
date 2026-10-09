import { NextResponse } from 'next/server'
import { requireUser, serviceClient } from '@/lib/shorts/server'
import { UPLOAD_SCOPE, accessToken, connectionWithScope, getVideo } from '@/lib/shorts/youtube'

export const dynamic = 'force-dynamic'

/** El navegador informa del videoId; el servidor lo comprueba en YouTube (privado + contenido sintético) antes de registrarlo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const { supabase, user } = auth
  const body = await request.json().catch(() => ({})) as { videoId?: string; failed?: string }

  const { data: short } = await supabase.from('shorts').select('id,status,publication_job_id').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (!short) return NextResponse.json({ error: 'Short no encontrado' }, { status: 404 })
  if (short.status !== 'uploading') return NextResponse.json({ error: `Estado ${short.status}` }, { status: 409 })

  if (body.failed) {
    await supabase.from('shorts').update({ status: 'upload_failed', error: String(body.failed).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id)
    return NextResponse.json({ status: 'upload_failed' })
  }
  if (!body.videoId || !/^[\w-]{6,20}$/.test(body.videoId)) return NextResponse.json({ error: 'videoId no válido' }, { status: 400 })

  const db = serviceClient()
  const conn = await connectionWithScope(db, user.id, UPLOAD_SCOPE)
  if (!conn) return NextResponse.json({ error: 'Sin conexión de YouTube' }, { status: 412 })
  const video = await getVideo(await accessToken(db, conn), body.videoId)
  if (!video) return NextResponse.json({ error: 'YouTube no encuentra ese vídeo en tu canal' }, { status: 404 })
  if (video.privacyStatus !== 'private') return NextResponse.json({ error: `Privacidad inesperada: ${video.privacyStatus}` }, { status: 409 })

  const now = new Date().toISOString()
  await supabase.from('shorts').update({ status: 'uploaded_private', video_id: body.videoId, privacy_status: video.privacyStatus, uploaded_at: now, error: null, updated_at: now }).eq('id', id).eq('owner_id', user.id)
  if (short.publication_job_id) await supabase.from('publication_jobs').update({ result: { uploaded_private: true, video_id: body.videoId, contains_synthetic_media: video.containsSyntheticMedia ?? true }, updated_at: now }).eq('id', short.publication_job_id).eq('owner_id', user.id)
  return NextResponse.json({ status: 'uploaded_private', videoId: body.videoId, containsSyntheticMedia: video.containsSyntheticMedia ?? null })
}
