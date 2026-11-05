import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { socialAuthUrl, socialConfigured, socialPlatforms, type SocialPlatform, type SocialScopeSet } from '@/lib/oauth/social'
import { previewBlock } from '@/lib/security/preview-guard'

export const dynamic = 'force-dynamic'

/** Same-site redirect with a relative Location: it keeps the host the person is actually using (no localhost/127.0.0.1 mix-ups behind proxies). */
const stay = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } })

/** Starts Instagram / TikTok OAuth. YouTube keeps its own route (/api/oauth/youtube). */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const blocked = previewBlock('privileged'); if (blocked) return blocked
  const { platform } = await params
  const url = new URL(request.url)
  if (!socialPlatforms.includes(platform as SocialPlatform)) return stay('/social')
  const p = platform as SocialPlatform
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return stay('/login')
  if (!socialConfigured(p)) return stay(`/social?${p}=not_configured`)
  const nonce = randomBytes(24).toString('base64url')
  const set: SocialScopeSet = url.searchParams.get('scope') === 'read' ? 'read' : 'publish'
  const response = NextResponse.redirect(socialAuthUrl(p, url.origin, nonce, set))
  response.cookies.set(`${p}_oauth_state`, `${nonce}.${user.id}`, { httpOnly: true, secure: true, sameSite: 'lax', path: `/api/oauth/${p}`, maxAge: 600 })
  return response
}
