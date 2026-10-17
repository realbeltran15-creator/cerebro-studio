import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Server-side seal of a publication approval.
 *
 * Row-level security lets the owner's own session write `approvals` and `publication_jobs` directly (policies are `for all`), so a
 * forged `approvals.status='approved'` row or a `payload` edited after approving (e.g. `privacyStatus: 'public'`, another video) must
 * not be enough to publish. The approve routes compute an HMAC over exactly what was approved — owner, job, platform, idempotency key,
 * the canonical payload and the storage path of the video file — with a key only the server knows. The publish step recomputes it over
 * the CURRENT job and refuses on any difference. The seal can be stored anywhere the client can write: it cannot be forged, and copying
 * an old seal only works for the identical, genuinely approved content.
 *
 * Key: PUBLICATION_SEAL_KEY (base64, ≥ 32 bytes) or, if absent, a key derived from TOKEN_ENCRYPTION_KEY (already required for OAuth).
 */

export type SealInput = {
  ownerId: string
  jobId: string
  platform: string
  idempotencyKey: string
  payload: unknown
  /** Storage path of the file that will be uploaded: swapping the file behind the same asset id breaks the seal. */
  videoStoragePath: string | null
}

const VERSION = 'v1'

function sealKey(): Buffer {
  const raw = process.env.PUBLICATION_SEAL_KEY?.trim() || process.env.TOKEN_ENCRYPTION_KEY?.trim()
  if (!raw) throw new Error('PUBLICATION_SEAL_KEY or TOKEN_ENCRYPTION_KEY must be configured to approve publications.')
  const base = Buffer.from(raw, 'base64')
  if (base.length < 32) throw new Error('The publication seal key must decode to at least 32 bytes.')
  // Domain separation: never reuse the raw token-encryption key for a different purpose.
  return createHmac('sha256', base).update('cerebro-studio:publication-approval:v1').digest()
}

export const sealConfigured = () => { try { sealKey(); return true } catch { return false } }

/** JSON with sorted keys and without undefined values, so the same content always gives the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

function material(i: SealInput) {
  return [VERSION, i.ownerId, i.jobId, i.platform, i.idempotencyKey, i.videoStoragePath ?? '', canonicalJson(i.payload)].join('\n')
}

export function approvalSeal(input: SealInput): string {
  return `${VERSION}.${createHmac('sha256', sealKey()).update(material(input)).digest('base64url')}`
}

export function verifyApprovalSeal(input: SealInput, seal: unknown): boolean {
  if (typeof seal !== 'string' || !seal.startsWith(`${VERSION}.`)) return false
  let expected: string
  try { expected = approvalSeal(input) } catch { return false }
  const a = Buffer.from(seal), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
