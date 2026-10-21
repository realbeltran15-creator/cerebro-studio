import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Meta «signed_request» (deauthorize and data deletion callbacks): base64url(signature).base64url(payload), where the signature
 * is HMAC-SHA256 of the payload part with the app secret. Returns the payload only when the signature is valid.
 */
export function parseSignedRequest(signed: string, secret: string): { user_id?: string; algorithm?: string; issued_at?: number } | null {
  if (!secret || typeof signed !== 'string') return null
  const [sig, payload] = signed.split('.')
  if (!sig || !payload) return null
  const expected = createHmac('sha256', secret).update(payload).digest()
  const given = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { user_id?: unknown; algorithm?: unknown; issued_at?: unknown }
    if (String(data.algorithm ?? '').toUpperCase() !== 'HMAC-SHA256') return null
    return { user_id: data.user_id === undefined ? undefined : String(data.user_id), algorithm: String(data.algorithm), issued_at: typeof data.issued_at === 'number' ? data.issued_at : undefined }
  } catch { return null }
}

export const confirmationCode = () => randomBytes(9).toString('base64url')
