import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { openGuardedStore, quotaErrorResponse } from '@/lib/research/guard'
import { isQuotaExceeded, lockForToday, reserveSpend } from '@/lib/research/quota'
import { UNITS } from '@/lib/research/filters'
import { youtubeCategories, youtubeConfigured, YouTubeApiError } from '@/lib/providers/youtube-data'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) return NextResponse.json({ error: 'YouTube Data API no está configurada.', configured: false }, { status: 503 })
  const region = new URL(request.url).searchParams.get('region')?.trim().toUpperCase() ?? ''
  if (!/^[A-Z]{2}$/.test(region)) return NextResponse.json({ error: 'Indica un país con código de 2 letras.' }, { status: 400 })
  let spend: Awaited<ReturnType<typeof reserveSpend>> | null = null, store: Awaited<ReturnType<typeof openGuardedStore>> | null = null, spent = 0
  try {
    store = await openGuardedStore(supabase, user.id, request)
    spend = await reserveSpend(store, 'categories', UNITS.categories, 0)
    const categories = await youtubeCategories(region); spent = UNITS.categories
    return NextResponse.json({ configured: true, categories }, { headers: { 'Cache-Control': 'private, max-age=3600' } })
  } catch (error) {
    if (store && isQuotaExceeded(error)) await lockForToday(store)
    const quota = quotaErrorResponse(error); if (quota) return quota
    return NextResponse.json({ error: error instanceof YouTubeApiError ? error.message : 'No se pudo consultar YouTube.', configured: true }, { status: 502 })
  }
  finally { if (spend) await spend.settle(spent, 0).catch(() => undefined) }
}
