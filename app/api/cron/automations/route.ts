import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { executeAutomation, type Automation } from '@/lib/automations/run'
import { youtubeConfigured } from '@/lib/providers/youtube-data'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Daily scheduler (Vercel Cron). Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * Uses the service role because no user session exists; the runner filters by owner itself.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!secret || !serviceKey || !url) return NextResponse.json({ error: 'Scheduler not configured (CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY).' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!youtubeConfigured()) return NextResponse.json({ error: 'YOUTUBE_API_KEY missing.' }, { status: 503 })

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const dueBefore = new Date(Date.now() - 20 * 3600000).toISOString()
  const { data, error } = await db.from('automations').select('id,owner_id,kind,name,enabled,schedule,config,last_run_at')
    .eq('enabled', true).eq('schedule', 'daily').or(`last_run_at.is.null,last_run_at.lt.${dueBefore}`).order('last_run_at', { ascending: true, nullsFirst: true }).limit(25)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = []
  for (const automation of (data ?? []) as Automation[]) {
    const r = await executeAutomation(db, automation, 'schedule')
    results.push({ id: automation.id, ok: r.ok })
  }
  return NextResponse.json({ ran: results.length, succeeded: results.filter(r => r.ok).length }, { headers: { 'Cache-Control': 'no-store' } })
}
