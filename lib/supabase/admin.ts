import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-only client with the service role. Used ONLY to write the publication state (approvals and publication_jobs status/result)
 * after the route has authenticated the user and every query is filtered by that user's owner_id.
 *
 * Why: the prepared migration 20261018120000_server_owned_security.sql removes the browser's ability to write approvals and to move a
 * publication job past «awaiting_approval». Once it is applied, only this client can record an approval or a publication result.
 * Before it is applied (or if SUPABASE_SERVICE_ROLE_KEY is missing) the routes fall back to the user's session client, exactly as today.
 */
let cached: SupabaseClient | null | undefined

export function serviceRoleClient(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  cached = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  return cached
}

/** The client that writes publication state: service role when configured, otherwise the session client (pre-migration behaviour). */
export const publicationWriter = (session: SupabaseClient): SupabaseClient => serviceRoleClient() ?? session

export const _resetServiceRoleClient = () => { cached = undefined }
