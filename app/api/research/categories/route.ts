import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { youtubeCategories, youtubeConfigured, YouTubeApiError } from '@/lib/providers/youtube-data'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) return NextResponse.json({ error: 'YouTube Data API no está configurada.', configured: false }, { status: 503 })
  const region = new URL(request.url).searchParams.get('region')?.trim().toUpperCase() ?? ''
  if (!/^[A-Z]{2}$/.test(region)) return NextResponse.json({ error: 'Indica un país con código de 2 letras.' }, { status: 400 })
  try {
    const categories = await youtubeCategories(region)
    return NextResponse.json({ configured: true, categories }, { headers: { 'Cache-Control': 'private, max-age=3600' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof YouTubeApiError ? error.message : 'No se pudo consultar YouTube.', configured: true }, { status: 502 })
  }
}
