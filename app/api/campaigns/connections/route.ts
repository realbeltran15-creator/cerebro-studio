import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readiness } from '@/lib/campaigns/connections'

export const dynamic = 'force-dynamic'

/** Which ad APIs could be connected from this deployment. Only booleans and messages: no credential value ever leaves the server. */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ networks: readiness(process.env) }, { headers: { 'Cache-Control': 'no-store' } })
}
