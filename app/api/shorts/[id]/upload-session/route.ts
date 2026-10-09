import { NextResponse } from 'next/server'
import { assertShortApproved } from '@/lib/shorts/approval'
import { requireUser, serviceClient } from '@/lib/shorts/server'
import { UPLOAD_SCOPE, accessToken, connectionWithScope, initPrivateUpload } from '@/lib/shorts/youtube'

export const dynamic = 'force-dynamic'
const MAX_BYTES = 256 * 1024 * 1024

/** Abre la subida reanudable PRIVADA. Solo si existe la aprobación explícita; el token no sale del servidor. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const { supabase, user } = auth
  const body = await request.json().catch(() => ({})) as { size?: number; type?: string }
  if (!body.size || body.size > MAX_BYTES || !/^video\/(mp4|webm)/.test(body.type ?? '')) return NextResponse.json({ error: 'Archivo de vídeo no válido' }, { status: 400 })

  const { data: short } = await supabase.from('shorts').select('id,status,title,description,tags').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (!short) return NextResponse.json({ error: 'Short no encontrado' }, { status: 404 })
  if (!['approved', 'upload_failed'].includes(short.status)) return NextResponse.json({ error: `Estado ${short.status}: solo se sube un Short aprobado` }, { status: 409 })

  const { data: approval } = await supabase.from('approvals').select('owner_id,action_type,entity_type,entity_id,status').eq('owner_id', user.id).eq('entity_type', 'short').eq('entity_id', id).eq('action_type', 'publish').eq('status', 'approved').limit(1).maybeSingle()
  try { assertShortApproved(user.id, id, approval) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 403 }) }

  try {
    const db = serviceClient()
    const conn = await connectionWithScope(db, user.id, UPLOAD_SCOPE)
    if (!conn) return NextResponse.json({ error: 'Falta conectar YouTube con permiso de subida (Conectores → permiso de publicación).' }, { status: 412 })
    const token = await accessToken(db, conn)
    const origin = request.headers.get('origin') ?? new URL(request.url).origin
    const uploadUrl = await initPrivateUpload(token, { title: short.title ?? 'Short', description: short.description ?? '', tags: short.tags ?? [] }, { size: body.size, type: body.type! }, origin)
    await supabase.from('shorts').update({ status: 'uploading', error: null, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id)
    return NextResponse.json({ uploadUrl })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error al iniciar la subida'
    await supabase.from('shorts').update({ status: 'upload_failed', error: message, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
