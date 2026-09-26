import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { revoke, type Connection } from '@/lib/oauth/google'

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await supabase.from('channel_connections').select('id,owner_id,external_account_id,external_account_name,scopes,status,token_ciphertext').eq('owner_id', user.id).eq('provider', 'youtube')
  for (const c of (data ?? []) as Connection[]) {
    try { await revoke(c) } catch { /* revoke is best effort; tokens are deleted below either way */ }
    await supabase.from('channel_connections').update({ status: 'revoked', token_ciphertext: null, updated_at: new Date().toISOString() }).eq('id', c.id).eq('owner_id', user.id)
  }
  return NextResponse.json({ disconnected: (data ?? []).length })
}
