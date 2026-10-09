import { NextResponse } from 'next/server'
import { prepareDailyShort } from '@/lib/shorts/pipeline'
import { requireUser, serviceClient } from '@/lib/shorts/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** «Preparar ahora»: misma lógica que el cron, para el usuario autenticado. Con force reintenta un día descartado. */
export async function POST(request: Request) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const body = await request.json().catch(() => ({})) as { force?: boolean }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ status: 'blocked', missing: ['SUPABASE_SERVICE_ROLE_KEY'] }, { status: 503 })
  const result = await prepareDailyShort(serviceClient(), auth.user.id, { force: Boolean(body.force) })
  return NextResponse.json(result, { status: result.status === 'blocked' ? 503 : 200 })
}
