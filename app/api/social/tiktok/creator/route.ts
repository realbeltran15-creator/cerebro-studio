import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { socialAccessToken, socialConnection } from '@/lib/oauth/social'
import { tiktokCreatorInfo } from '@/lib/publication/social'

export const dynamic = 'force-dynamic'

/** Latest creator info for the post form (TikTok requires reading it when the post page is shown). Read-only; posts nothing. */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const connection = await socialConnection(supabase, user.id, 'tiktok')
  if (!connection) return NextResponse.json({ error: 'Conecta tu cuenta de TikTok.' }, { status: 409 })
  try {
    const info = await tiktokCreatorInfo(await socialAccessToken(supabase, connection))
    return NextResponse.json({ ...info, accountId: connection.external_account_id }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo leer la cuenta de TikTok.', canPost: false }, { status: 502 })
  }
}
