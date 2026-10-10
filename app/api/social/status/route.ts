import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { socialConfigured, socialEnv, socialPlatforms } from '@/lib/oauth/social'

export const dynamic = 'force-dynamic'

/** Which social integrations the server is configured for (never returns secrets). */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ platforms: socialPlatforms.map(p => ({ platform: p, configured: socialConfigured(p), env: socialEnv[p] })) })
}
