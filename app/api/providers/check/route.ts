import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkable, runCheck, type CheckProvider } from '@/lib/providers/check'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

/**
 * Connection check for a provider key, run on the server so the key never reaches the browser.
 * fal.ai, Cloudflare, Gemini and TopMediai (see lib/providers/check.ts). None of them generates anything or
 * spends credits: fal gets an invalid body it rejects with 422, the others call their own read-only credential
 * endpoints. The response never contains a key.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { provider?: string } | null
  const provider = checkable.find(p => p === body?.provider) as CheckProvider | undefined
  if (!provider) return NextResponse.json({ error: 'Proveedor no soportado.' }, { status: 400 })
  return NextResponse.json(await runCheck(provider), { headers: { 'Cache-Control': 'no-store' } })
}
