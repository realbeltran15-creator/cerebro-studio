import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { openStore, quotaDayStart } from '@/lib/research/cache'
import { dailyCap } from '@/lib/research/sample'

export const dynamic = 'force-dynamic'

/** Units spent today by Investigación, so the screen can show the budget before any paid query. Free: no YouTube call. */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const store = await openStore(supabase as never, user.id)
  const cap = dailyCap(), usedToday = await store.unitsSince(quotaDayStart())
  return NextResponse.json({ usedToday, cap, remaining: Math.max(cap - usedToday, 0), persistent: store.persistent }, { headers: { 'Cache-Control': 'no-store' } })
}
