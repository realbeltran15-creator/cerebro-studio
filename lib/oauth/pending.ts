import { decryptJson, encryptJson } from '@/lib/security/tokens'
import type { StoredTokens } from '@/lib/oauth/google'

/**
 * A new YouTube authorization is NOT saved in the database until the owner confirms the exact channel (name and ID).
 * Until then it lives only in this encrypted (AES-256-GCM, server key), httpOnly cookie, scoped to /api/oauth/youtube and
 * valid for 15 minutes. The browser can neither read nor forge it; the server shows the channel through /pending.
 */
export const PENDING_COOKIE = 'yt_pending'
export const PENDING_MAX_AGE_S = 15 * 60
export const PENDING_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/api/oauth/youtube', maxAge: PENDING_MAX_AGE_S }

export type PendingConnection = {
  ownerId: string
  channelId: string
  channelName: string | null
  handle: string | null
  scopes: string[]
  scopeSet: string
  tokens: StoredTokens
  createdAt: number
}

export const sealPending = (p: PendingConnection) => encryptJson(p)

/** The pending authorization of this owner, or null if absent, tampered with, of another user or older than 15 minutes. */
export function openPending(cookie: string | undefined, ownerId: string, now = Date.now()): PendingConnection | null {
  if (!cookie) return null
  try {
    const p = decryptJson<PendingConnection>(cookie)
    if (p.ownerId !== ownerId || !/^UC[\w-]{22}$/.test(p.channelId) || now - p.createdAt > PENDING_MAX_AGE_S * 1000) return null
    return p
  } catch { return null }
}
