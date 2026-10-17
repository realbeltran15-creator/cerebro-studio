import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptJson, encryptJson, tokenEncryptionConfigured } from '@/lib/security/tokens'

/**
 * Google OAuth for the owner's YouTube channel. Server-only.
 * Read-only scopes power Analytics; the upload scope is requested separately and only
 * when the user chooses to enable publishing (which still requires an explicit approval per video).
 */

export const SCOPES = {
  analytics: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'],
  publish: ['https://www.googleapis.com/auth/youtube.upload'],
} as const
export type ScopeSet = keyof typeof SCOPES

export type StoredTokens = { access_token: string; refresh_token?: string; expires_at: number; scope: string; token_type: string }

export type Connection = {
  id: string
  owner_id: string
  external_account_id: string
  external_account_name: string | null
  scopes: string[]
  status: string
  token_ciphertext: string | null
}

const clientId = () => process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? ''
const clientSecret = () => process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? ''

export const googleOAuthConfigured = () => Boolean(clientId() && clientSecret() && tokenEncryptionConfigured())

export function redirectUri(origin: string) {
  return `${origin}/api/oauth/youtube/callback`
}

export function authUrl(origin: string, state: string, scopeSet: ScopeSet) {
  const scopes = scopeSet === 'publish' ? [...SCOPES.analytics, ...SCOPES.publish] : [...SCOPES.analytics]
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri(origin), response_type: 'code', scope: scopes.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  }).toString()
  return url.toString()
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...body }), cache: 'no-store',
  })
  const json = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string; error?: string; error_description?: string }
  if (!response.ok || !json.access_token) {
    const err = new Error(json.error_description ?? json.error ?? `Google token endpoint returned ${response.status}`) as Error & { code?: string }
    err.code = json.error
    throw err
  }
  return json
}

export async function exchangeCode(origin: string, code: string): Promise<StoredTokens> {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(origin) })
  return { access_token: t.access_token!, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, scope: t.scope ?? '', token_type: t.token_type ?? 'Bearer' }
}

/** Returns a valid access token, refreshing and re-encrypting it when it is about to expire. */
export async function accessTokenFor(db: SupabaseClient, connection: Connection): Promise<string> {
  if (!connection.token_ciphertext) throw new Error('La conexión de YouTube no tiene credenciales. Vuelve a conectarla.')
  const tokens = decryptJson<StoredTokens>(connection.token_ciphertext)
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token
  if (!tokens.refresh_token) throw new Error('La sesión de YouTube caducó. Vuelve a conectar el canal.')
  try {
    const t = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: 'refresh_token' })
    const next: StoredTokens = { ...tokens, access_token: t.access_token!, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, scope: t.scope ?? tokens.scope }
    await db.from('channel_connections').update({ token_ciphertext: encryptJson(next), token_metadata: { expires_at: next.expires_at, scope: next.scope }, status: 'connected', updated_at: new Date().toISOString() }).eq('id', connection.id).eq('owner_id', connection.owner_id)
    return next.access_token
  } catch (error) {
    if ((error as { code?: string }).code === 'invalid_grant') {
      await db.from('channel_connections').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', connection.id).eq('owner_id', connection.owner_id)
      throw new Error('Google revocó el acceso al canal. Vuelve a conectarlo.')
    }
    throw error
  }
}

export async function revoke(connection: Connection) {
  if (!connection.token_ciphertext) return
  const tokens = decryptJson<StoredTokens>(connection.token_ciphertext)
  await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token ?? tokens.access_token }) }).catch(() => undefined)
}

export async function youtubeConnection(db: SupabaseClient, ownerId: string) {
  const { data } = await db.from('channel_connections').select('id,owner_id,external_account_id,external_account_name,scopes,status,token_ciphertext')
    .eq('owner_id', ownerId).eq('provider', 'youtube').eq('status', 'connected').order('updated_at', { ascending: false }).limit(1)
  return ((data ?? [])[0] as Connection | undefined) ?? null
}

export const hasScope = (c: Connection, scope: string) => c.scopes.includes(scope)
