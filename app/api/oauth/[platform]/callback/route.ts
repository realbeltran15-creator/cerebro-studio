import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { encryptJson, exchangeSocialCode, socialConfigured, socialPlatforms, type SocialPlatform } from '@/lib/oauth/social'

export const dynamic = 'force-dynamic'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  const url = new URL(request.url)
  if (!socialPlatforms.includes(platform as SocialPlatform)) return NextResponse.redirect(new URL('/social', url.origin))
  const p = platform as SocialPlatform
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/social?${p}=${status}`, url.origin))
    res.cookies.set(`${p}_oauth_state`, '', { path: `/api/oauth/${p}`, maxAge: 0 })
    return res
  }
  if (!socialConfigured(p)) return back('not_configured')
  if (url.searchParams.get('error')) return back('denied')
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', url.origin))
  const [nonce, uid] = ((await cookies()).get(`${p}_oauth_state`)?.value ?? '').split('.')
  const state = url.searchParams.get('state') ?? ''
  // Instagram may append "#_" to the code; it is not part of the code.
  const code = (url.searchParams.get('code') ?? '').replace(/#_$/, '')
  if (!nonce || !state || !same(nonce, state) || uid !== user.id || !code) return back('invalid_state')
  try {
    const { tokens, account } = await exchangeSocialCode(p, url.origin, code)
    const scopes = tokens.scope.split(/[ ,]+/).filter(Boolean)
    const { error } = await supabase.from('channel_connections').upsert({
      owner_id: user.id, provider: p, external_account_id: account.id, external_account_name: account.name, scopes, status: 'connected',
      token_ciphertext: encryptJson(tokens), token_metadata: { expires_at: tokens.expires_at, scope: tokens.scope }, updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,provider,external_account_id' })
    if (error) { console.error(`${p} connection save failed`, { details: error.message }); return back('save_failed') }
    return back('connected')
  } catch (error) {
    console.error(`${p} OAuth failure`, { details: error instanceof Error ? error.message : 'unknown' })
    return back('exchange_failed')
  }
}
