import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { socialAuthUrl, socialConfigured, socialPlatforms, type SocialPlatform } from '@/lib/oauth/social'

export const dynamic = 'force-dynamic'

/** Starts Instagram / TikTok OAuth. YouTube keeps its own route (/api/oauth/youtube). */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  const url = new URL(request.url)
  if (!socialPlatforms.includes(platform as SocialPlatform)) return NextResponse.redirect(new URL('/social', url.origin))
  const p = platform as SocialPlatform
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', url.origin))
  if (!socialConfigured(p)) return NextResponse.redirect(new URL(`/social?${p}=not_configured`, url.origin))
  const nonce = randomBytes(24).toString('base64url')
  const response = NextResponse.redirect(socialAuthUrl(p, url.origin, nonce))
  response.cookies.set(`${p}_oauth_state`, `${nonce}.${user.id}`, { httpOnly: true, secure: true, sameSite: 'lax', path: `/api/oauth/${p}`, maxAge: 600 })
  return response
}
