import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { openPending, PENDING_COOKIE } from '@/lib/oauth/pending'
import { SCOPES } from '@/lib/oauth/google'

export const dynamic = 'force-dynamic'

/** What the owner must confirm: the channel behind the authorization waiting in the encrypted cookie. Never the tokens. */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const p = openPending((await cookies()).get(PENDING_COOKIE)?.value, user.id)
  if (!p) return NextResponse.json({ pending: null }, { headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json({ pending: { channelId: p.channelId, channelName: p.channelName, handle: p.handle, canUpload: p.scopes.includes(SCOPES.publish[0]), expiresAt: p.createdAt + 15 * 60_000 } }, { headers: { 'Cache-Control': 'no-store' } })
}
