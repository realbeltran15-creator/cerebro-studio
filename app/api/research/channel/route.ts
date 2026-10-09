import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { analyzeChannel, youtubeConfigured, YouTubeApiError } from '@/lib/providers/youtube-data'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) return NextResponse.json({ error: 'YouTube Data API no está configurada. Añade YOUTUBE_API_KEY en las variables del servidor.', configured: false }, { status: 503 })
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (!q || q.length > 300) return NextResponse.json({ error: 'Indica la URL del canal, su @handle o su id.' }, { status: 400 })
  try {
    return NextResponse.json({ configured: true, analysis: await analyzeChannel(q) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const known = error instanceof YouTubeApiError
    return NextResponse.json({ error: known ? error.message : 'No se pudo analizar el canal.', configured: true }, { status: known && (error.status === 400 || error.status === 404) ? error.status : 502 })
  }
}
