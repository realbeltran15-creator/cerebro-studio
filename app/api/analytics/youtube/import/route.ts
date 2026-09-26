import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { googleOAuthConfigured, youtubeConnection } from '@/lib/oauth/google'
import { importYouTubeAnalytics } from '@/lib/analytics/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!googleOAuthConfigured()) return NextResponse.json({ error: 'La conexión con YouTube no está configurada en el servidor.', configured: false }, { status: 503 })
  const connection = await youtubeConnection(supabase, user.id)
  if (!connection) return NextResponse.json({ error: 'Conecta primero tu canal de YouTube en Conectores.', connected: false }, { status: 409 })
  const body = await request.json().catch(() => ({})) as { days?: number }
  const days = [7, 28, 90].includes(Number(body.days)) ? Number(body.days) : 28
  try {
    const result = await importYouTubeAnalytics(supabase, user.id, connection, days)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Analytics import failure', { details: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo importar.' }, { status: 502 })
  }
}
