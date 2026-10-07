import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkFalConnection } from '@/lib/providers/fal-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

/**
 * Connection check for a provider key, run on the server so the key never reaches the browser.
 * Only fal.ai for now. It sends an invalid body (no prompt): fal validates credentials first and then
 * rejects it with 422, so no job is queued and nothing is billed. The response never contains the key.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { provider?: string } | null
  if (body?.provider !== 'fal') return NextResponse.json({ error: 'Proveedor no soportado.' }, { status: 400 })
  return NextResponse.json(await checkFalConnection(), { headers: { 'Cache-Control': 'no-store' } })
}
