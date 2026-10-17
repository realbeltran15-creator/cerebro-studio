import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { revokeSocial, socialPlatforms, type SocialConnection, type SocialPlatform } from '@/lib/oauth/social'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  if (!socialPlatforms.includes(platform as SocialPlatform)) return NextResponse.json({ error: 'Plataforma no válida.' }, { status: 400 })
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await supabase.from('channel_connections').select('id,owner_id,provider,external_account_id,external_account_name,scopes,status,token_ciphertext').eq('owner_id', user.id).eq('provider', platform)
  for (const c of (data ?? []) as SocialConnection[]) {
    try { await revokeSocial(c) } catch { /* best effort */ }
    await supabase.from('channel_connections').update({ status: 'revoked', token_ciphertext: null, updated_at: new Date().toISOString() }).eq('id', c.id).eq('owner_id', user.id)
  }
  return NextResponse.json({ disconnected: (data ?? []).length })
}
