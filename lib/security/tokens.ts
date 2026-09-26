import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM encryption for OAuth tokens at rest (channel_connections.token_ciphertext).
 * TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64-encoded. Server-only.
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */

function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim()
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not configured.')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes.')
  return buf
}

export const tokenEncryptionConfigured = () => {
  try { key(); return true } catch { return false }
}

export function encryptJson(value: unknown) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

export function decryptJson<T>(payload: string): T {
  const [version, iv, tag, data] = payload.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported token format.')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  const text = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  return JSON.parse(text) as T
}
