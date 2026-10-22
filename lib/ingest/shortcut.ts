import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * iPhone «Compartir» through Apple Shortcuts (no native app needed): the owner creates a personal token in Cerebro Studio and pastes it
 * into a Shortcut that appears in the Share sheet. Only the SHA-256 of the token is stored (connector_configs, provider cerebro-ios,
 * capability share_token, owner RLS); regenerating replaces it and revoking deletes it. The token can only start an upload into the
 * owner's own folder and register it: it cannot read, list or delete anything.
 */
export const SHORTCUT_KEY = { provider: 'cerebro-ios', capability: 'share_token' } as const
export type ShortcutConfig = { hash: string; createdAt: string; destination: string; lastUsedAt?: string | null; uploads?: number }

export const newToken = () => `cs_${randomBytes(24).toString('base64url')}`
export const hashToken = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
export const looksLikeToken = (t: string) => /^cs_[A-Za-z0-9_-]{32}$/.test(t)

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim())
  return m && looksLikeToken(m[1]) ? m[1] : null
}

/** Owner of a token (service role: the token is the only credential). Constant-time comparison of the stored hash. */
export async function ownerOfToken(admin: SupabaseClient, token: string): Promise<{ ownerId: string; config: ShortcutConfig; rowId: string } | null> {
  const h = hashToken(token)
  const { data } = await admin.from('connector_configs').select('id,owner_id,config').eq('provider', SHORTCUT_KEY.provider).eq('capability', SHORTCUT_KEY.capability).eq('config->>hash', h).limit(1)
  const row = (data?.[0] ?? null) as { id: string; owner_id: string; config: ShortcutConfig } | null
  if (!row || typeof row.config?.hash !== 'string' || row.config.hash.length !== h.length || !timingSafeEqual(Buffer.from(row.config.hash), Buffer.from(h))) return null
  return { ownerId: row.owner_id, config: row.config, rowId: row.id }
}

/** Paths the shortcut may finish: its own folder, the upload folder and the name the start step produced. */
export function shortcutPathOk(path: string, ownerId: string) {
  return new RegExp(`^${ownerId}/(library|[0-9a-f-]{36})/uploads/ios-[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`).test(path)
}

/** Plain text the Shortcut shows as a notification. */
export const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
