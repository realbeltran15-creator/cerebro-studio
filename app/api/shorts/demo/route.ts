import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runTextTask } from '@/lib/providers/text'
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
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Diagnostic: one tiny free text call, timed, so a slow or failing text provider can be told apart from the rest of the chain.
  if (new URL(request.url).searchParams.get('probe') === 'text') {
    const t0 = Date.now()
    try {
      const r = await runTextTask('analysis', { system: 'Responde solo con JSON.', user: 'Devuelve {"ok":true}.', schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } }, schemaName: 'probe', validate: v => (v && typeof v === 'object' && 'ok' in v ? v : null), requestId: randomUUID(), only: 'gemini' })
      return NextResponse.json({ ok: true, model: r.model.id, ms: Date.now() - t0 })
    } catch (e) {
      return NextResponse.json({ ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : 'error', attempts: (e as { attempts?: unknown }).attempts ?? null })
    }
  }
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
