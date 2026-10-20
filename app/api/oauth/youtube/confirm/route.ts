import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { serviceRoleClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Confirms or discards a YouTube authorization that is waiting in «pending_confirmation» (see the OAuth callback).
 * The browser must send the exact channel ID it showed to the owner: a confirmation for a different channel is refused.
 * Confirming makes it the only usable YouTube connection of this owner; any other one stops being usable and its stored
 * credentials are deleted. Nothing is revoked at Google here, because revoking one grant can also cut another grant
 * of the same Google account; the owner can remove access from their Google account settings.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { id?: unknown; channelId?: unknown; decision?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const channelId = typeof body?.channelId === 'string' ? body.channelId : ''
  const decision = body?.decision === 'confirm' ? 'confirm' : body?.decision === 'discard' ? 'discard' : null
  if (!id || !channelId || !decision) return NextResponse.json({ error: 'Faltan datos de la confirmación.' }, { status: 400 })

  const db = serviceRoleClient() ?? supabase
  const { data } = await db.from('channel_connections').select('id,external_account_id,status').eq('id', id).eq('owner_id', user.id).eq('provider', 'youtube').maybeSingle()
  const row = data as { id: string; external_account_id: string; status: string } | null
  if (!row || row.status !== 'pending_confirmation') return NextResponse.json({ error: 'No hay ninguna conexión pendiente de confirmar.' }, { status: 404 })
  if (row.external_account_id !== channelId) return NextResponse.json({ error: 'El canal no coincide con el que se mostró. No se ha cambiado nada.' }, { status: 409 })
  const now = new Date().toISOString()

  if (decision === 'discard') {
    const { error } = await db.from('channel_connections').update({ status: 'discarded', token_ciphertext: null, updated_at: now }).eq('id', row.id).eq('owner_id', user.id)
    if (error) return NextResponse.json({ error: 'No se pudo descartar.' }, { status: 500 })
    return NextResponse.json({ discarded: true })
  }

  const { error: othersError } = await db.from('channel_connections').update({ status: 'replaced', token_ciphertext: null, updated_at: now })
    .eq('owner_id', user.id).eq('provider', 'youtube').neq('id', row.id).in('status', ['connected', 'expired', 'pending_confirmation'])
  if (othersError) return NextResponse.json({ error: 'No se pudo retirar la conexión anterior; no se ha cambiado nada.' }, { status: 500 })
  const { error } = await db.from('channel_connections').update({ status: 'connected', updated_at: now }).eq('id', row.id).eq('owner_id', user.id).eq('status', 'pending_confirmation')
  if (error) return NextResponse.json({ error: 'No se pudo confirmar.' }, { status: 500 })
  return NextResponse.json({ connected: true, channelId: row.external_account_id })
}
