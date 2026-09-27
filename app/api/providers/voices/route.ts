import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { listVoices } from '@/lib/providers/elevenlabs'

export const dynamic = 'force-dynamic'

/** Voices available to the configured ElevenLabs account (names and ids only). */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ voices: await listVoices() }, { headers: { 'Cache-Control': 'private, max-age=600' } }) }
  catch { return NextResponse.json({ voices: [], error: 'No se pudieron leer las voces de ElevenLabs.' }, { status: 502 }) }
}
