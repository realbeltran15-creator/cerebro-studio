import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ViError } from './server'

/** Shared wrapper for the influencer API routes: session required, ViError mapped to its status. */
export async function withUser(handler: (ctx: { db: Awaited<ReturnType<typeof createServerSupabaseClient>>; userId: string }) => Promise<unknown>) {
  const db = await createServerSupabaseClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await handler({ db, userId: user.id }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const status = e instanceof ViError ? e.status : 500
    if (status >= 500) console.error('Influencer API failure', { details: e instanceof Error ? e.message : 'unknown' })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error inesperado.' }, { status })
  }
}
