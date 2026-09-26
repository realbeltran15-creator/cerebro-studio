import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { trendingYouTubeVideos, youtubeConfigured, YouTubeApiError } from '@/lib/providers/youtube-data'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) {
    return NextResponse.json({ error: 'YouTube Data API no está configurada. Añade YOUTUBE_API_KEY en las variables del servidor.', configured: false }, { status: 503 })
  }
  const params = new URL(request.url).searchParams
  const region = params.get('region')?.trim().toUpperCase() ?? ''
  const category = params.get('category')?.trim() ?? ''
  if (!/^[A-Z]{2}$/.test(region)) return NextResponse.json({ error: 'Indica un país con código de 2 letras.' }, { status: 400 })
  if (category && !/^\d{1,4}$/.test(category)) return NextResponse.json({ error: 'Categoría no válida.' }, { status: 400 })
  try {
    const results = await trendingYouTubeVideos({ regionCode: region, categoryId: category || undefined })
    return NextResponse.json({ configured: true, results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('YouTube trending failure', { status: error instanceof YouTubeApiError ? error.status : null, details: error instanceof Error ? error.message : 'unknown' })
    // YouTube answers 400/404 when a category has no trending chart in that region.
    const empty = error instanceof YouTubeApiError && (error.status === 400 || error.status === 404)
    return NextResponse.json({ error: empty ? 'YouTube no publica tendencias para esa categoría en este país.' : error instanceof YouTubeApiError ? error.message : 'No se pudo consultar YouTube.', configured: true }, { status: 502 })
  }
}
