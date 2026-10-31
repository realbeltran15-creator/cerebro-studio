import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { defaultShortsConfig, shortsConfig } from '@/lib/shorts/config'
import { prepareDailyShort } from '@/lib/shorts/factory'
import { liveDeps } from '@/lib/shorts/live'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Free test Short: one per call, owner only, free models only (same router rules as the daily run), no Radar data needed.
 * It never publishes and never turns on the daily automation.
 */
export async function POST() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: automation } = await supabase.from('automations').select('config').eq('owner_id', user.id).eq('kind', 'shorts_factory').limit(1).maybeSingle()
  const cfg = automation ? shortsConfig((automation as { config?: Record<string, unknown> }).config ?? {}) : defaultShortsConfig
  try {
    const deps = await liveDeps(supabase, user.id, cfg, null)
    const { outcome, log, textCalls } = await prepareDailyShort(cfg, deps, { demo: true })
    return NextResponse.json({ ok: outcome.status === 'prepared', outcome, log, textCalls, spendUsd: 0 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'La generación falló.' }, { status: 500 })
  }
}
