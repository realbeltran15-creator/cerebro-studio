import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { youtubeConfigured, YouTubeApiError } from '@/lib/providers/youtube-data'
import { openStore } from '@/lib/research/cache'
import { BudgetError, getTopicAnalysis } from '@/lib/research/sample'

export const dynamic = 'force-dynamic'

/** Demand/supply/competition analysis of one topic in one market. Costs ~204 YouTube quota units unless cached. */
export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) return NextResponse.json({ error: 'YouTube Data API no está configurada. Añade YOUTUBE_API_KEY en las variables del servidor.', configured: false }, { status: 503 })
  const p = new URL(request.url).searchParams
  const topic = p.get('q')?.trim() ?? ''
  if (topic.length < 2 || topic.length > 120) return NextResponse.json({ error: 'Indica un tema de 2 a 120 caracteres.' }, { status: 400 })
  const region = p.get('region')?.trim().toUpperCase() || null
  const lang = p.get('lang')?.trim().toLowerCase() || null
  if (region && !/^[A-Z]{2}$/.test(region)) return NextResponse.json({ error: 'País no válido.' }, { status: 400 })
  if (lang && !/^[a-z]{2}$/.test(lang)) return NextResponse.json({ error: 'Idioma no válido.' }, { status: 400 })
  try {
    const store = await openStore(supabase as never, user.id)
    const result = await getTopicAnalysis({ topic, region, language: lang, refresh: p.get('refresh') === '1', cacheOnly: p.get('cacheOnly') === '1' }, { store })
    return NextResponse.json({ configured: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof BudgetError) return NextResponse.json({ error: error.message, budget: { used: error.used, cap: error.cap }, configured: true }, { status: 429 })
    console.error('Topic analysis failure', { status: error instanceof YouTubeApiError ? error.status : null, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: error instanceof YouTubeApiError ? error.message : 'No se pudo analizar el tema.', configured: true }, { status: 502 })
  }
}
