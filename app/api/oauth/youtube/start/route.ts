import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { authUrl, googleOAuthConfigured, type ScopeSet } from '@/lib/oauth/google'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', url.origin))
  if (!googleOAuthConfigured()) return NextResponse.redirect(new URL('/connectors?youtube=not_configured', url.origin))
  const scopeSet: ScopeSet = url.searchParams.get('scope') === 'publish' ? 'publish' : 'analytics'
  const nonce = randomBytes(24).toString('base64url')
  const response = NextResponse.redirect(authUrl(url.origin, nonce, scopeSet))
  // Bound to this browser and user; checked in the callback to prevent CSRF / account mix-ups.
  response.cookies.set('yt_oauth_state', `${nonce}.${scopeSet}.${user.id}`, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/oauth/youtube', maxAge: 600 })
  return response
}
