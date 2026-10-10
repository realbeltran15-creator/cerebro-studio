import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptJson, encryptJson, tokenEncryptionConfigured } from '@/lib/security/tokens'

/**
 * OAuth for Instagram (Business Login for Instagram) and TikTok (Login Kit for Web). Server-only.
 * Endpoints per the official docs (checked 2026-10-01):
 *  Instagram: www.instagram.com/oauth/authorize → api.instagram.com/oauth/access_token (short-lived)
 *             → graph.instagram.com/access_token?grant_type=ig_exchange_token (60 days) → refresh_access_token.
 *  TikTok:    www.tiktok.com/v2/auth/authorize/ → open.tiktokapis.com/v2/oauth/token/ (24 h access, 365 d refresh).
 * Tokens are stored encrypted (AES-GCM) in channel_connections; nothing is published from here.
 */

export type SocialPlatform = 'instagram' | 'tiktok'
export const socialPlatforms: SocialPlatform[] = ['instagram', 'tiktok']

export const SOCIAL_SCOPES: Record<SocialPlatform, string[]> = {
  instagram: ['instagram_business_basic', 'instagram_business_content_publish'],
  tiktok: ['user.info.basic', 'video.publish'],
}

const env = {
  instagram: { id: () => process.env.INSTAGRAM_APP_ID?.trim() ?? '', secret: () => process.env.INSTAGRAM_APP_SECRET?.trim() ?? '' },
  tiktok: { id: () => process.env.TIKTOK_CLIENT_KEY?.trim() ?? '', secret: () => process.env.TIKTOK_CLIENT_SECRET?.trim() ?? '' },
}
export const socialEnv: Record<SocialPlatform, string[]> = { instagram: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'], tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'] }
export const socialConfigured = (p: SocialPlatform) => Boolean(env[p].id() && env[p].secret() && tokenEncryptionConfigured())

export const redirectUri = (origin: string, p: SocialPlatform) => `${origin}/api/oauth/${p}/callback`

export function socialAuthUrl(p: SocialPlatform, origin: string, state: string) {
  if (p === 'instagram') {
    const u = new URL('https://www.instagram.com/oauth/authorize')
    u.search = new URLSearchParams({ client_id: env.instagram.id(), redirect_uri: redirectUri(origin, p), response_type: 'code', scope: SOCIAL_SCOPES.instagram.join(','), state }).toString()
    return u.toString()
  }
  const u = new URL('https://www.tiktok.com/v2/auth/authorize/')
  u.search = new URLSearchParams({ client_key: env.tiktok.id(), redirect_uri: redirectUri(origin, p), response_type: 'code', scope: SOCIAL_SCOPES.tiktok.join(','), state }).toString()
  return u.toString()
}

export type SocialTokens = { access_token: string; refresh_token?: string; expires_at: number; refresh_expires_at?: number; scope: string; account_id: string }
export type SocialAccount = { id: string; name: string | null }

async function json(r: Response) {
  const j = await r.json().catch(() => ({})) as Record<string, unknown>
  if (!r.ok) {
    const e = (j.error && typeof j.error === 'object' ? j.error : j) as Record<string, unknown>
    throw Object.assign(new Error(String(e.error_message ?? e.message ?? e.error_description ?? e.error ?? `HTTP ${r.status}`)), { code: e.code ?? e.error, status: r.status })
  }
  return j
}

export async function exchangeSocialCode(p: SocialPlatform, origin: string, code: string): Promise<{ tokens: SocialTokens; account: SocialAccount }> {
  if (p === 'instagram') {
    const short = await json(await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, cache: 'no-store',
      body: new URLSearchParams({ client_id: env.instagram.id(), client_secret: env.instagram.secret(), grant_type: 'authorization_code', redirect_uri: redirectUri(origin, p), code }),
    }))
    const shortToken = String(short.access_token ?? '')
    if (!shortToken) throw new Error('Instagram no devolvió un token.')
    const long = await json(await fetch(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: env.instagram.secret(), access_token: shortToken })}`, { cache: 'no-store' }))
    const token = String(long.access_token ?? shortToken)
    const me = await json(await fetch(`https://graph.instagram.com/me?${new URLSearchParams({ fields: 'user_id,username', access_token: token })}`, { cache: 'no-store' }))
    const accountId = String(me.user_id ?? short.user_id ?? '')
    if (!accountId) throw new Error('No se pudo identificar la cuenta de Instagram.')
    const permissions = Array.isArray(short.permissions) ? (short.permissions as string[]).join(',') : String(short.permissions ?? SOCIAL_SCOPES.instagram.join(','))
    return { tokens: { access_token: token, expires_at: Date.now() + Number(long.expires_in ?? 3600) * 1000, scope: permissions, account_id: accountId }, account: { id: accountId, name: typeof me.username === 'string' ? me.username : null } }
  }
  const t = await json(await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, cache: 'no-store',
    body: new URLSearchParams({ client_key: env.tiktok.id(), client_secret: env.tiktok.secret(), code, grant_type: 'authorization_code', redirect_uri: redirectUri(origin, p) }),
  }))
  const access = String(t.access_token ?? '')
  if (!access) throw new Error('TikTok no devolvió un token.')
  const info = await json(await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', { headers: { Authorization: `Bearer ${access}` }, cache: 'no-store' })).catch(() => ({} as Record<string, unknown>))
  const user = ((info.data as Record<string, unknown> | undefined)?.user ?? {}) as Record<string, unknown>
  const openId = String(t.open_id ?? user.open_id ?? '')
  return {
    tokens: { access_token: access, refresh_token: String(t.refresh_token ?? ''), expires_at: Date.now() + Number(t.expires_in ?? 86400) * 1000, refresh_expires_at: Date.now() + Number(t.refresh_expires_in ?? 0) * 1000, scope: String(t.scope ?? ''), account_id: openId },
    account: { id: openId, name: typeof user.display_name === 'string' ? user.display_name : null },
  }
}

export type SocialConnection = { id: string; owner_id: string; provider: string; external_account_id: string; external_account_name: string | null; scopes: string[]; status: string; token_ciphertext: string | null }

export async function socialConnection(db: SupabaseClient, ownerId: string, p: SocialPlatform) {
  const { data } = await db.from('channel_connections').select('id,owner_id,provider,external_account_id,external_account_name,scopes,status,token_ciphertext')
    .eq('owner_id', ownerId).eq('provider', p).eq('status', 'connected').order('updated_at', { ascending: false }).limit(1)
  return ((data ?? [])[0] as SocialConnection | undefined) ?? null
}

/** Valid access token for a connection, refreshing it when needed (Instagram: long-lived refresh; TikTok: refresh_token grant). */
export async function socialAccessToken(db: SupabaseClient, c: SocialConnection): Promise<string> {
  if (!c.token_ciphertext) throw new Error('La conexión no tiene credenciales. Vuelve a conectarla.')
  const t = decryptJson<SocialTokens>(c.token_ciphertext)
  const p = c.provider as SocialPlatform
  // Instagram long-lived tokens are refreshed when less than 7 days remain; TikTok access tokens 1 minute before expiry.
  const margin = p === 'instagram' ? 7 * 864e5 : 60_000
  if (t.expires_at > Date.now() + margin) return t.access_token
  try {
    let next: SocialTokens
    if (p === 'instagram') {
      const r = await json(await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: t.access_token })}`, { cache: 'no-store' }))
      next = { ...t, access_token: String(r.access_token ?? t.access_token), expires_at: Date.now() + Number(r.expires_in ?? 5184000) * 1000 }
    } else {
      if (!t.refresh_token) throw new Error('Sin refresh token.')
      const r = await json(await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, cache: 'no-store',
        body: new URLSearchParams({ client_key: env.tiktok.id(), client_secret: env.tiktok.secret(), grant_type: 'refresh_token', refresh_token: t.refresh_token }),
      }))
      next = { ...t, access_token: String(r.access_token), refresh_token: String(r.refresh_token ?? t.refresh_token), expires_at: Date.now() + Number(r.expires_in ?? 86400) * 1000 }
    }
    await db.from('channel_connections').update({ token_ciphertext: encryptJson(next), token_metadata: { expires_at: next.expires_at, scope: next.scope }, updated_at: new Date().toISOString() }).eq('id', c.id).eq('owner_id', c.owner_id)
    return next.access_token
  } catch {
    if (t.expires_at > Date.now()) return t.access_token
    await db.from('channel_connections').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', c.id).eq('owner_id', c.owner_id)
    throw new Error('La sesión caducó. Vuelve a conectar la cuenta en Redes sociales.')
  }
}

export async function revokeSocial(c: SocialConnection) {
  if (!c.token_ciphertext || c.provider !== 'tiktok') return // Instagram tokens are removed by deleting them; the user can also remove the app in Instagram settings.
  const t = decryptJson<SocialTokens>(c.token_ciphertext)
  await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: env.tiktok.id(), client_secret: env.tiktok.secret(), token: t.access_token }) }).catch(() => undefined)
}

export { encryptJson }
