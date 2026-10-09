import { NextResponse } from 'next/server'
import { readiness } from '@/lib/shorts/env'
import { requireUser } from '@/lib/shorts/server'

export const dynamic = 'force-dynamic'

/** Solo nombres y si están definidas: nunca devuelve valores. */
export async function GET() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  return NextResponse.json({ requirements: readiness() }, { headers: { 'Cache-Control': 'no-store' } })
}
