import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { publicProviderState } from '@/lib/providers/config'

export const dynamic = 'force-dynamic'

/** Which providers are configured on the server (yes/no only). Requires a session: it describes the deployment's integrations. */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ providers: publicProviderState() }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
