import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { catalog, evidenceOf, isConfigured, openAiVoices, rightsOf } from '@/lib/providers/catalog'
import { statusLabel } from '@/lib/providers/allowance'
import { loadPoolStatuses } from '@/lib/providers/availability'
import { providers } from '@/lib/providers/directory'
import { geminiVoices } from '@/lib/providers/gemini'
import { textConfigured } from '@/lib/providers/openai-text'
import { elevenLabsBalance } from '@/lib/providers/elevenlabs'
import { tokenEncryptionConfigured } from '@/lib/security/tokens'
import { taskQuality, textConfiguredFor, textModels } from '@/lib/providers/text'
import { sttConfigured, sttModels } from '@/lib/providers/transcribe'
import { storageDriver } from '@/lib/storage/server'

export const dynamic = 'force-dynamic'

/** Models with their real availability (env names only, never values) plus live credit balances when the provider exposes them. */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const jobsReady = tokenEncryptionConfigured()
  const eleven = await elevenLabsBalance().catch(() => null)
  const pools = await loadPoolStatuses(supabase, user.id, catalog, process.env)
  const models = catalog.map(m => {
    const ready = isConfigured(m, process.env) && (m.sync || jobsReady)
    const pool = m.allowance ? pools[m.allowance.pool] : undefined
    const creditsExhausted = (m.provider === 'elevenlabs' && eleven ? eleven.remaining <= 0 : false) || Boolean(pool?.exhausted)
    return {
      id: m.id, modality: m.modality, provider: m.provider, label: m.label, strength: m.strength, price: m.price, priceConfirmed: m.priceConfirmed,
      tier: m.tier, quality: m.quality, speed: m.speed, limits: m.limits ?? null, capabilities: m.capabilities,
      sync: m.sync, formats: m.formats ?? null, durations: m.durations ?? null, maxVariants: m.maxVariants ?? 1, negative: Boolean(m.negative),
      evidence: evidenceOf(m), evidenceNote: m.evidenceNote ?? null, rights: rightsOf(m), rightsNote: m.rightsNote ?? null,
      maxResolution: m.maxResolution ?? null, maxShortSidePx: m.maxShortSidePx ?? null, references: m.references ?? null, confirm: Boolean(m.confirm),
      allowance: m.allowance ? { pool: m.allowance.pool, kind: m.allowance.kind, unit: m.allowance.unit, note: m.allowance.note, remaining: pool?.remaining ?? null, amount: m.allowance.amount, endsAt: pool?.endsAt ?? null, label: pool ? statusLabel(pool) : null, unitsPerGeneration: m.allowanceUnits?.({}) ?? null } : null,
      ready, creditsExhausted, missing: ready ? [] : [...m.env.filter(n => !process.env[n]?.trim()), ...(!m.sync && !jobsReady ? ['TOKEN_ENCRYPTION_KEY'] : [])],
    }
  })
  const directory = providers.map(p => ({ ...p, configured: p.env.length > 0 && p.env.every(n => Boolean(process.env[n]?.trim())) }))
  return NextResponse.json({
    models, pools: Object.values(pools), providers: directory, openAiVoices, geminiVoices, textReady: textConfigured(),
    balances: { elevenlabs: eleven },
    text: {
      models: textModels.map(m => ({ id: m.id, label: m.label, provider: m.provider, model: m.model(), tier: m.tier, quality: m.quality, priceNote: m.priceNote, configured: textConfiguredFor(m) })),
      tasks: Object.entries(taskQuality).map(([task, q]) => ({ task, label: q.label, minQuality: q.min })),
    },
    storage: storageDriver() === 'r2'
      ? { driver: 'r2', label: 'Cloudflare R2', note: '10 GB gratis al mes, descargas gratis, archivos de hasta ~5 TB.' }
      : { driver: 'supabase', label: 'Supabase Storage', note: 'Plan gratuito: 50 MB por archivo y 1 GB en total. Configura Cloudflare R2 para vídeo.' },
    transcription: sttModels.map(m => ({ id: m.id, label: m.label, tier: m.tier, quality: m.quality, note: m.note, configured: sttConfigured(m) })),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
