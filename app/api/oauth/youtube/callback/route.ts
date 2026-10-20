import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { exchangeCode, googleOAuthConfigured } from '@/lib/oauth/google'
import { PENDING_COOKIE, PENDING_COOKIE_OPTIONS, sealPending } from '@/lib/oauth/pending'

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
    const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50', { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: 'no-store' })
    const channelJson = await channelRes.json() as { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> }
    const channel = channelJson.items?.[0]
    if (!channel) return back('no_channel')
    const scopes = tokens.scope.split(' ').filter(Boolean)
    // Not saved yet: the authorization waits in an encrypted httpOnly cookie until the owner confirms this exact channel
    // (name and ID) in Conectores. Nothing can read or upload with it before that.
    const res = back('pending')
    res.cookies.set(PENDING_COOKIE, sealPending({ ownerId: user.id, channelId: channel.id, channelName: channel.snippet?.title ?? null, handle: channel.snippet?.customUrl ?? null, scopes, scopeSet: scopeSet ?? 'analytics', tokens, createdAt: Date.now() }), PENDING_COOKIE_OPTIONS)
    return res
  } catch (error) {
    console.error('YouTube OAuth failure', { details: error instanceof Error ? error.message : 'unknown' })
    return back('exchange_failed')
  }
}
