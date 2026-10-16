import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { youtubeConfigured, YouTubeApiError } from '@/lib/providers/youtube-data'
import { openGuardedStore, quotaErrorResponse } from '@/lib/research/guard'
import { InProgressError, NoBaseAnalysisError, getGrowth, getTopicAnalysis } from '@/lib/research/sample'

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
  const days = Number(p.get('days'))
  if (region && !/^[A-Z]{2}$/.test(region)) return NextResponse.json({ error: 'País no válido.' }, { status: 400 })
  if (lang && !/^[a-z]{2}$/.test(lang)) return NextResponse.json({ error: 'Idioma no válido.' }, { status: 400 })
  try {
    const store = await openGuardedStore(supabase, user.id, request)
    if (p.get('growth') === '1') {
      const grown = await getGrowth({ topic, region, language: lang, recentDays: Number.isFinite(days) && days > 0 ? days : undefined }, { store, owner: user.id })
      return NextResponse.json({ configured: true, ...grown }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const result = await getTopicAnalysis({ topic, region, language: lang, recentDays: Number.isFinite(days) && days > 0 ? days : undefined, refresh: p.get('refresh') === '1', cacheOnly: p.get('cacheOnly') === '1' }, { store, owner: user.id })
    return NextResponse.json({ configured: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof NoBaseAnalysisError) return NextResponse.json({ error: error.message, needsAnalysis: true, configured: true }, { status: 422 })
    if (error instanceof InProgressError) return NextResponse.json({ error: error.message, retry: true, configured: true }, { status: 409 })
    const quota = quotaErrorResponse(error); if (quota) return quota
    console.error('Topic analysis failure', { status: error instanceof YouTubeApiError ? error.status : null, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: error instanceof YouTubeApiError ? error.message : 'No se pudo analizar el tema.', configured: true }, { status: 502 })
  }
}

/**
 * Measures growth for an analysis the browser already holds. The analysis travels in the body because the server cache may be another
 * instance's memory (or empty after a deploy): it is validated (same research, current engine, numbers present) before it is used.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) return NextResponse.json({ error: 'YouTube Data API no está configurada. Añade YOUTUBE_API_KEY en las variables del servidor.', configured: false }, { status: 503 })
  if (Number(request.headers.get('content-length') ?? 0) > 600_000) return NextResponse.json({ error: 'Petición demasiado grande.' }, { status: 413 })
  let body: { topic?: unknown; region?: unknown; lang?: unknown; days?: unknown; analysis?: unknown } | null = null
  try { body = await request.json() } catch { /* handled below */ }
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : ''
  const region = typeof body?.region === 'string' && /^[A-Z]{2}$/.test(body.region) ? body.region : null
  const lang = typeof body?.lang === 'string' && /^[a-z]{2}$/.test(body.lang) ? body.lang : null
  const days = Number(body?.days)
  if (topic.length < 2 || topic.length > 120) return NextResponse.json({ error: 'Indica un tema de 2 a 120 caracteres.' }, { status: 400 })
  try {
    const store = await openGuardedStore(supabase, user.id, request)
    const grown = await getGrowth({ topic, region, language: lang, recentDays: Number.isFinite(days) && days > 0 ? days : undefined, analysis: body?.analysis }, { store, owner: user.id })
    return NextResponse.json({ configured: true, ...grown }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof NoBaseAnalysisError) return NextResponse.json({ error: error.message, needsAnalysis: true, configured: true }, { status: 422 })
    if (error instanceof InProgressError) return NextResponse.json({ error: error.message, retry: true, configured: true }, { status: 409 })
    const quota = quotaErrorResponse(error); if (quota) return quota
    console.error('Growth failure', { status: error instanceof YouTubeApiError ? error.status : null, details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: error instanceof YouTubeApiError ? error.message : 'No se pudo medir el crecimiento.', configured: true }, { status: 502 })
  }
}
