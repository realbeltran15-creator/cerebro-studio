import { NextResponse } from 'next/server'
import { missingFor } from '@/lib/shorts/env'
import { prepareDailyShort } from '@/lib/shorts/pipeline'
import { cronAuthorized, serviceClient } from '@/lib/shorts/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Vercel Cron: prepara el Short del día en servidor. No renderiza, no sube y no publica nada. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const owner = process.env.SHORTS_OWNER_ID?.trim()
  const missing = missingFor('blocking').map(m => m.name)
  if (!owner || missing.length) return NextResponse.json({ status: 'blocked', missing }, { status: 503 })
  const result = await prepareDailyShort(serviceClient(), owner)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
