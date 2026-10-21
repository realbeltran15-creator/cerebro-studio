import type { SupabaseClient } from '@supabase/supabase-js'
import { fromLegacyStyle, parseProfile, type EditProfile } from './profile'
import { loadStyles } from './styles-store'

/**
 * Edit profiles live in ONE connector_configs row per owner (provider cerebro-editor, capability edit_profiles; owner RLS): no migration.
 * Saving is conditional on the row's updated_at, so two open tabs never silently overwrite each other's styles.
 */
const KEY = { provider: 'cerebro-editor', capability: 'edit_profiles' } as const
export const MAX_PROFILES = 30

export class ProfilesConflictError extends Error {
  constructor() { super('Tus estilos cambiaron en otra pestaña o dispositivo. Recarga para ver la versión actual antes de guardar.') }
}

export type ProfilesState = { profiles: EditProfile[]; updatedAt: string | null; /** Styles of the first «Aprende de mí» version, shown converted until the owner saves. */ legacy: boolean }

export async function loadProfiles(db: SupabaseClient): Promise<ProfilesState> {
  const { data, error } = await db.from('connector_configs').select('config,updated_at').eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as { config?: { profiles?: unknown[] }; updated_at?: string } | null
  const profiles = (row?.config?.profiles ?? []).flatMap(p => { const x = parseProfile(p); return x ? [x] : [] })
  if (row) return { profiles, updatedAt: row.updated_at ?? null, legacy: false }
  const old = await loadStyles(db).catch(() => [])
  return { profiles: old.map(fromLegacyStyle), updatedAt: null, legacy: old.length > 0 }
}

export async function saveProfiles(db: SupabaseClient, profiles: EditProfile[], prevUpdatedAt: string | null): Promise<string> {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const config = { profiles: profiles.slice(0, MAX_PROFILES) }
  const at = new Date().toISOString()
  if (prevUpdatedAt) {
    const { data, error } = await db.from('connector_configs').update({ config, updated_at: at }).eq('provider', KEY.provider).eq('capability', KEY.capability).eq('owner_id', user.id).eq('updated_at', prevUpdatedAt).select('updated_at')
    if (error) throw new Error(`No se pudieron guardar los estilos: ${error.message}`)
    if (!data?.length) throw new ProfilesConflictError()
    return (data[0] as { updated_at: string }).updated_at
  }
  const { data, error } = await db.from('connector_configs').insert({ owner_id: user.id, ...KEY, enabled: true, priority: 0, config, updated_at: at }).select('updated_at')
  if (error) throw (error as { code?: string }).code === '23505' ? new ProfilesConflictError() : new Error(`No se pudieron guardar los estilos: ${error.message}`)
  return (data?.[0] as { updated_at: string } | undefined)?.updated_at ?? at
}
