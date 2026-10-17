import type { SupabaseClient } from '@supabase/supabase-js'
import type { EditStyle } from './style'

/** Learned edit styles live in the owner's connector_configs row (provider cerebro-editor, capability edit_styles). RLS: owner only. */
const KEY = { provider: 'cerebro-editor', capability: 'edit_styles' } as const
export const EDITOR_CONFIG_PROVIDER = KEY.provider

export async function loadStyles(supabase: SupabaseClient): Promise<EditStyle[]> {
  const { data } = await supabase.from('connector_configs').select('config').eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  const styles = (data?.config as { styles?: EditStyle[] } | null)?.styles
  return Array.isArray(styles) ? styles.filter(s => s?.version === 1) : []
}

export async function saveStyles(supabase: SupabaseClient, styles: EditStyle[]) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const { error } = await supabase.from('connector_configs').upsert({ owner_id: user.id, ...KEY, enabled: true, priority: 0, config: { styles: styles.slice(0, 20) }, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,provider,capability' })
  if (error) throw new Error(`No se pudo guardar el estilo: ${error.message}`)
}
