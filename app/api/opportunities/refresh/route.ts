import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { refreshOpportunityMetrics } from '@/lib/automations/run'
import { youtubeConfigured } from '@/lib/providers/youtube-data'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Refreshes YouTube metrics for the given opportunities (or all of the owner's, up to 50). */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) return NextResponse.json({ error: 'Actualizar métricas necesita YOUTUBE_API_KEY en el servidor.' }, { status: 503 })
  const body = await request.json().catch(() => ({})) as { ids?: unknown }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)) : undefined
  try {
    return NextResponse.json(await refreshOpportunityMetrics(supabase, user.id, { ids, maxItems: 50 }))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudieron actualizar las métricas.' }, { status: 502 })
  }
}
