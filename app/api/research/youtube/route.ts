import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { openStore, recordUsage, startOfUtcDay } from '@/lib/research/cache'
import { dailyCap } from '@/lib/research/sample'
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

  try {
    // Same daily budget as the analyses: a free-text search costs about 102 units and is counted with them.
    const store = await openStore(supabase as never, user.id)
    const used = await store.unitsSince(startOfUtcDay()), cap = dailyCap()
    if (used + UNITS.search > cap) return NextResponse.json({ error: `Presupuesto diario de Investigación agotado: ${used} de ${cap} unidades usadas hoy. Vuelve mañana.`, budget: { used, cap }, configured: true }, { status: 429 })
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
    await recordUsage(store, 'search', UNITS.search)
    return NextResponse.json({ configured: true, results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // Provider errors are reported as 502 so the client never confuses them with its own auth state.
    console.error('YouTube research failure', { status: error instanceof YouTubeApiError ? error.status : null, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: error instanceof YouTubeApiError ? error.message : 'No se pudo consultar YouTube.', configured: true }, { status: 502 })
  }
}
