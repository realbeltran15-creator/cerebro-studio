import { NextResponse } from 'next/server'
import { syncRetention } from '@/lib/shorts/metrics'
import { cronAuthorized, serviceClient } from '@/lib/shorts/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Vercel Cron: guarda la retención media a 7 días (observada) de los Shorts que ya cerraron ventana. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const owner = process.env.SHORTS_OWNER_ID?.trim()
  if (!owner || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ status: 'blocked', missing: ['SHORTS_OWNER_ID', 'SUPABASE_SERVICE_ROLE_KEY'] }, { status: 503 })
  const results = await syncRetention(serviceClient(), owner)
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
}
