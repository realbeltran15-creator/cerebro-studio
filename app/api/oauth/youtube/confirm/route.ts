import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { encryptJson } from '@/lib/security/tokens'
import { openPending, PENDING_COOKIE, PENDING_COOKIE_OPTIONS } from '@/lib/oauth/pending'

export const dynamic = 'force-dynamic'

/**
 * Confirms or discards the YouTube authorization waiting in the encrypted cookie (see the OAuth callback). The browser must send
 * the exact channel ID it showed to the owner: a confirmation for any other channel is refused and nothing is saved.
 * Confirming saves it as the only usable YouTube connection of this owner; any other one stops being usable and its stored
 * credentials are deleted. Nothing is revoked at Google here, because revoking one grant can also cut another grant of the
 * same Google account; the owner can remove access from their Google account settings.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { channelId?: unknown; decision?: unknown } | null
  const channelId = typeof body?.channelId === 'string' ? body.channelId : ''
  const decision = body?.decision === 'confirm' ? 'confirm' : body?.decision === 'discard' ? 'discard' : null
  if (!channelId || !decision) return NextResponse.json({ error: 'Faltan datos de la confirmación.' }, { status: 400 })
  const done = (json: Record<string, unknown>, status = 200) => { const res = NextResponse.json(json, { status }); res.cookies.set(PENDING_COOKIE, '', { ...PENDING_COOKIE_OPTIONS, maxAge: 0 }); return res }

  const p = openPending((await cookies()).get(PENDING_COOKIE)?.value, user.id)
  if (!p) return done({ error: 'No hay ninguna autorización pendiente (caduca a los 15 minutos). Vuelve a conectar el canal.' }, 404)
  if (p.channelId !== channelId) return NextResponse.json({ error: 'El canal no coincide con el que se mostró. No se ha guardado nada.' }, { status: 409 })
  if (decision === 'discard') return done({ discarded: true })

  const db = serviceRoleClient()
  if (!db) return NextResponse.json({ error: 'El servidor no puede guardar conexiones (falta su clave de servicio).' }, { status: 503 })
  const now = new Date().toISOString()
  const { error } = await db.from('channel_connections').upsert({
    owner_id: user.id, provider: 'youtube', external_account_id: p.channelId, external_account_name: p.channelName,
    scopes: p.scopes, status: 'connected', token_ciphertext: encryptJson(p.tokens),
    token_metadata: { expires_at: p.tokens.expires_at, scope: p.tokens.scope, scope_set: p.scopeSet, has_refresh_token: Boolean(p.tokens.refresh_token), handle: p.handle, confirmed_at: now },
    updated_at: now,
  }, { onConflict: 'owner_id,provider,external_account_id' })
  if (error) { console.error('YouTube connection save failed', { details: error.message }); return NextResponse.json({ error: 'No se pudo guardar la conexión.' }, { status: 500 }) }
  await db.from('channel_connections').update({ status: 'revoked', token_ciphertext: null, updated_at: now })
    .eq('owner_id', user.id).eq('provider', 'youtube').neq('external_account_id', p.channelId).in('status', ['connected', 'expired', 'error'])
  return done({ connected: true, channelId: p.channelId, channelName: p.channelName })
}
