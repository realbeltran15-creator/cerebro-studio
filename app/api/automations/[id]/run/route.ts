import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { executeAutomation, type Automation } from '@/lib/automations/run'
import { youtubeConfigured } from '@/lib/providers/youtube-data'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) return NextResponse.json({ error: 'Las automatizaciones necesitan YOUTUBE_API_KEY en el servidor.' }, { status: 503 })
  const { data: automation } = await supabase.from('automations').select('id,owner_id,kind,name,enabled,schedule,config,last_run_at').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (!automation) return NextResponse.json({ error: 'Automatización no encontrada.' }, { status: 404 })
  // Throttle manual runs so a double click cannot spend quota twice.
  const { data: recent } = await supabase.from('automation_runs').select('id').eq('automation_id', id).eq('status', 'running').gte('started_at', new Date(Date.now() - 2 * 60000).toISOString()).limit(1)
  if (recent?.length) return NextResponse.json({ error: 'Ya hay una ejecución en curso.' }, { status: 409 })
  const result = await executeAutomation(supabase, automation as Automation, 'manual')
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
