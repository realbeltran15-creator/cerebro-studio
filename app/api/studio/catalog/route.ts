import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { catalog, isConfigured, openAiVoices } from '@/lib/providers/catalog'
import { textConfigured } from '@/lib/providers/openai-text'
import { tokenEncryptionConfigured } from '@/lib/security/tokens'

export const dynamic = 'force-dynamic'

/** Models of the Creation Studio with their real availability (env names only, never values). */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const jobsReady = tokenEncryptionConfigured()
  const models = catalog.map(m => {
    const ready = isConfigured(m, process.env) && (m.sync || jobsReady)
    return {
      id: m.id, modality: m.modality, provider: m.provider, label: m.label, strength: m.strength, price: m.price,
      sync: m.sync, formats: m.formats ?? null, durations: m.durations ?? null, maxVariants: m.maxVariants ?? 1, negative: Boolean(m.negative),
      ready, missing: ready ? [] : [...m.env.filter(n => !process.env[n]?.trim()), ...(!m.sync && !jobsReady ? ['TOKEN_ENCRYPTION_KEY'] : [])],
    }
  })
  return NextResponse.json({ models, openAiVoices, textReady: textConfigured() }, { headers: { 'Cache-Control': 'no-store' } })
}
