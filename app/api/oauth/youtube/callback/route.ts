import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { exchangeCode, googleOAuthConfigured } from '@/lib/oauth/google'
import { encryptJson } from '@/lib/security/tokens'

export const dynamic = 'force-dynamic'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function GET(request: Request) {
  const url = new URL(request.url)
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/connectors?youtube=${status}`, url.origin))
    res.cookies.set('yt_oauth_state', '', { path: '/api/oauth/youtube', maxAge: 0 })
    return res
  }
  if (!googleOAuthConfigured()) return back('not_configured')
  if (url.searchParams.get('error')) return back('denied')

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', url.origin))

  const [nonce, scopeSet, uid] = ((await cookies()).get('yt_oauth_state')?.value ?? '').split('.')
  const state = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code') ?? ''
  if (!nonce || !state || !same(nonce, state) || uid !== user.id || !code) return back('invalid_state')

  try {
    const tokens = await exchangeCode(url.origin, code)
    const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: 'no-store' })
    const channelJson = await channelRes.json() as { items?: Array<{ id: string; snippet?: { title?: string } }> }
    const channel = channelJson.items?.[0]
    if (!channel) return back('no_channel')
    const scopes = tokens.scope.split(' ').filter(Boolean)
    const { error } = await supabase.from('channel_connections').upsert({
      owner_id: user.id, provider: 'youtube', external_account_id: channel.id, external_account_name: channel.snippet?.title ?? null,
      scopes, status: 'connected', token_ciphertext: encryptJson(tokens),
      token_metadata: { expires_at: tokens.expires_at, scope: tokens.scope, scope_set: scopeSet, has_refresh_token: Boolean(tokens.refresh_token) },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,provider,external_account_id' })
    if (error) { console.error('YouTube connection save failed', { details: error.message }); return back('save_failed') }
    return back('connected')
  } catch (error) {
    console.error('YouTube OAuth failure', { details: error instanceof Error ? error.message : 'unknown' })
    return back('exchange_failed')
  }
}
