import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { openGuardedStore, quotaErrorResponse } from '@/lib/research/guard'
import { isQuotaExceeded, lockForToday, reserveSpend } from '@/lib/research/quota'
import { UNITS } from '@/lib/research/filters'
import { searchYouTubeVideos, youtubeConfigured, YouTubeApiError, type YouTubeSearchOrder } from '@/lib/providers/youtube-data'

export const dynamic = 'force-dynamic'

const orders = new Set<YouTubeSearchOrder>(['relevance', 'viewCount', 'date', 'rating'])

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) {
    return NextResponse.json({ error: 'YouTube Data API no está configurada. Añade YOUTUBE_API_KEY en las variables del servidor.', configured: false }, { status: 503 })
  }

  const params = new URL(request.url).searchParams
  const query = params.get('q')?.trim() ?? ''
  if (!query || query.length > 200) return NextResponse.json({ error: 'Indica una búsqueda de hasta 200 caracteres.' }, { status: 400 })
  const order = params.get('order') as YouTubeSearchOrder | null
  const region = params.get('region')?.trim().toUpperCase()
  const language = params.get('lang')?.trim().toLowerCase()
  const days = Number(params.get('days'))
  const duration = params.get('duration')
  const category = params.get('category')?.trim() ?? ''
  const max = Number(params.get('max'))

  let spend: Awaited<ReturnType<typeof reserveSpend>> | null = null, store: Awaited<ReturnType<typeof openGuardedStore>> | null = null, spent = 0
  try {
    // Same two daily limits as the analyses (units AND search.list calls), reserved atomically before the call. If the counter cannot be
    // read, nothing is searched.
    store = await openGuardedStore(supabase, user.id, request)
    spend = await reserveSpend(store, 'search', UNITS.search, 1)
    const results = await searchYouTubeVideos({
      query,
      order: order && orders.has(order) ? order : 'relevance',
      regionCode: region && /^[A-Z]{2}$/.test(region) ? region : undefined,
      language: language && /^[a-z]{2}$/.test(language) ? language : undefined,
      videoDuration: duration === 'short' || duration === 'medium' || duration === 'long' ? duration : undefined,
      categoryId: /^\d{1,4}$/.test(category) ? category : undefined,
      maxResults: Number.isInteger(max) && max >= 1 && max <= 25 ? max : undefined,
      publishedWithinDays: Number.isInteger(days) && days > 0 && days <= 3650 ? days : undefined,
    })
    spent = UNITS.search
    return NextResponse.json({ configured: true, results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // A rejected request (4xx) is not charged; anything that may have reached the search engine is counted.
    if (!(error instanceof YouTubeApiError && error.status >= 400 && error.status < 500)) spent = spent || UNITS.search
    if (store && isQuotaExceeded(error)) await lockForToday(store)
    const quota = quotaErrorResponse(error); if (quota) return quota
    // Provider errors are reported as 502 so the client never confuses them with its own auth state.
    console.error('YouTube research failure', { status: error instanceof YouTubeApiError ? error.status : null, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: error instanceof YouTubeApiError ? error.message : 'No se pudo consultar YouTube.', configured: true }, { status: 502 })
  } finally { if (spend) await spend.settle(spent, spent > 0 ? 1 : 0).catch(() => undefined) }
}
