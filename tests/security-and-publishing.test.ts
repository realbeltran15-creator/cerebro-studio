import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptJson, encryptJson, tokenEncryptionConfigured } from '@/lib/security/tokens'
import { authUrl } from '@/lib/oauth/google'
import { publishJob } from '@/lib/publication/youtube'
import { approvalSeal, canonicalJson, verifyApprovalSeal } from '@/lib/publication/seal'

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret'
})
afterEach(() => vi.unstubAllGlobals())

describe('token encryption', () => {
  it('round-trips and rejects tampering or a different key', () => {
    const enc = encryptJson({ access_token: 'a', refresh_token: 'r' })
    expect(decryptJson(enc)).toEqual({ access_token: 'a', refresh_token: 'r' })
    const tampered = enc.slice(0, -2) + (enc.at(-2) === 'A' ? 'B' : 'A') + enc.slice(-1)
    expect(() => decryptJson(tampered)).toThrow()
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(() => decryptJson(enc)).toThrow()
    process.env.TOKEN_ENCRYPTION_KEY = 'short'
    expect(tokenEncryptionConfigured()).toBe(false)
  })
})

describe('OAuth URL', () => {
  it('asks for read-only scopes unless publishing is requested', () => {
    const read = new URL(authUrl('https://x.vercel.app', 'st', 'analytics'))
    expect(read.searchParams.get('redirect_uri')).toBe('https://x.vercel.app/api/oauth/youtube/callback')
    expect(read.searchParams.get('scope')).not.toContain('youtube.upload')
    expect(read.searchParams.get('access_type')).toBe('offline')
    expect(new URL(authUrl('https://x', 's', 'publish')).searchParams.get('scope')).toContain('youtube.upload')
  })
})

// Minimal fake of the Supabase client for publishJob.
function fakeDb(state: { job: Record<string, any>; approval: Record<string, any> | null; connection: Record<string, any> | null }) {
  return {
    storage: { from: () => ({ download: async () => ({ data: new Blob(['bytes'], { type: 'video/webm' }), error: null }) }) },
    from(table: string) {
      const q: { op: string; payload: any; filters: Record<string, unknown> } = { op: 'select', payload: null, filters: {} }
      const exec = () => {
        if (q.op === 'update') {
          if (table === 'publication_jobs' && q.payload.status === 'publishing') {
            const ok = state.job.status === 'approved'
            if (ok) state.job.status = 'publishing'
            return { data: ok ? [{ id: state.job.id }] : [], error: null }
          }
          if (table === 'publication_jobs') Object.assign(state.job, q.payload)
          return { data: null, error: null }
        }
        if (table === 'publication_jobs') return { data: state.job, error: null }
        if (table === 'approvals') return { data: state.approval, error: null }
        if (table === 'channel_connections') return { data: state.connection ? [state.connection] : [], error: null }
        if (table === 'assets') return { data: { asset_type: q.filters.id === 'thumb' ? 'thumbnail' : 'video', storage_path: (globalThis as any).__videoPath ?? VIDEO_PATH, provenance: { mimeType: 'video/webm' } }, error: null }
        return { data: null, error: null }
      }
      const chain: any = new Proxy({}, { get(_, p) {
        if (p === 'then') return (res: any, rej: any) => Promise.resolve(exec()).then(res, rej)
        if (p === 'update') return (payload: any) => { q.op = 'update'; q.payload = payload; return chain }
        if (p === 'eq') return (k: string, v: unknown) => { q.filters[k] = v; return chain }
        return () => chain
      } })
      return chain
    },
  } as any
}

const VIDEO_PATH = 'u1/p1/renders/vid.webm'
/** What the approve route stores: a seal over exactly the approved content (computed with the test's server key). */
function sealed(job: Record<string, any>, path = VIDEO_PATH) {
  return { approvalSeal: approvalSeal({ ownerId: job.owner_id, jobId: job.id, platform: job.platform, idempotencyKey: job.idempotency_key, payload: job.payload, videoStoragePath: path }) }
}

function state() {
  const job = { id: 'j1', owner_id: 'u1', project_id: 'p1', platform: 'youtube', status: 'approved', idempotency_key: 'k1', payload: { title: 'Mi vídeo', videoAssetId: 'vid', privacyStatus: 'private' }, result: null } as Record<string, any>
  job.result = sealed(job)
  return {
    job,
    approval: { owner_id: 'u1', action_type: 'publish', entity_id: 'youtube:k1', status: 'approved' } as Record<string, any> | null,
    connection: { id: 'c1', owner_id: 'u1', external_account_id: 'ch', external_account_name: 'Canal', status: 'connected', scopes: ['https://www.googleapis.com/auth/youtube.upload'],
      token_ciphertext: encryptJson({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 3600e3, scope: '', token_type: 'Bearer' }) } as Record<string, any> | null,
  }
}

describe('YouTube publishing gate', () => {
  let uploads = 0
  beforeEach(() => {
    uploads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('uploadType=resumable')) return new Response('', { status: 200, headers: { location: 'https://upload.example/s1' } })
      if (url === 'https://upload.example/s1') { uploads++; return new Response(JSON.stringify({ id: 'VID123' }), { status: 200 }) }
      throw new Error(`unexpected ${url}`)
    }))
  })

  it('refuses jobs that are not approved', async () => {
    const s = state(); s.job.status = 'draft'
    await expect(publishJob(fakeDb(s), 'u1', 'j1')).rejects.toThrow('no está aprobado')
  })

  it('refuses without an approval record for this exact job', async () => {
    const s = state(); s.approval = null
    await expect(publishJob(fakeDb(s), 'u1', 'j1')).rejects.toThrow(/approval is required/)
    const other = state(); other.approval!.entity_id = 'youtube:other'
    await expect(publishJob(fakeDb(other), 'u1', 'j1')).rejects.toThrow(/approval is required/)
  })

  it('refuses without the upload scope', async () => {
    const s = state(); s.connection!.scopes = []
    await expect(publishJob(fakeDb(s), 'u1', 'j1')).rejects.toThrow('permiso de subida')
    expect(uploads).toBe(0)
  })

  it('uploads once as private and is idempotent afterwards', async () => {
    const s = state()
    const first = await publishJob(fakeDb(s), 'u1', 'j1')
    expect(first).toMatchObject({ videoId: 'VID123', alreadyPublished: false })
    expect(s.job.status).toBe('published')
    expect(s.job.result.privacyStatus).toBe('private')
    const again = await publishJob(fakeDb(s), 'u1', 'j1')
    expect(again.alreadyPublished).toBe(true)
    expect(uploads).toBe(1)
  })

  it('refuses an approval written directly to the database (no server seal)', async () => {
    const s = state(); s.job.result = null   // approvals row + status 'approved' forged through RLS, no seal
    await expect(publishJob(fakeDb(s), 'u1', 'j1')).rejects.toThrow(/no corresponde al contenido actual/)
    expect(uploads).toBe(0)
  })

  it('refuses when the payload was changed after approving (e.g. private → public)', async () => {
    const s = state(); s.job.payload = { ...s.job.payload, privacyStatus: 'public' }
    await expect(publishJob(fakeDb(s), 'u1', 'j1')).rejects.toThrow(/no corresponde al contenido actual/)
    expect(uploads).toBe(0)
  })

  it('refuses when the file behind the approved asset was swapped', async () => {
    const s = state(); (globalThis as any).__videoPath = 'u1/p1/renders/other.webm'
    try { await expect(publishJob(fakeDb(s), 'u1', 'j1')).rejects.toThrow(/no corresponde al contenido actual/) } finally { delete (globalThis as any).__videoPath }
    expect(uploads).toBe(0)
  })

  it('a failed upload keeps the seal so the owner can retry the same approved content', async () => {
    const s = state()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    await expect(publishJob(fakeDb(s), 'u1', 'j1')).rejects.toThrow()
    expect(s.job.status).toBe('approved')
    expect(s.job.result.approvalSeal).toBeTruthy()
    expect(s.job.result.lastError).toBeTruthy()
  })
})

describe('approval seal', () => {
  const base = { ownerId: 'u', jobId: 'j', platform: 'youtube', idempotencyKey: 'k', payload: { b: 1, a: [1, { y: 2, x: 1 }] }, videoStoragePath: 'p' }
  it('is stable regardless of key order and changes with any field', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    const seal = approvalSeal(base)
    expect(verifyApprovalSeal({ ...base, payload: { a: [1, { x: 1, y: 2 }], b: 1 } }, seal)).toBe(true)
    for (const changed of [{ ownerId: 'v' }, { jobId: 'j2' }, { platform: 'tiktok' }, { idempotencyKey: 'k2' }, { videoStoragePath: 'q' }, { payload: { b: 2, a: [1, { y: 2, x: 1 }] } }]) {
      expect(verifyApprovalSeal({ ...base, ...changed }, seal)).toBe(false)
    }
  })
  it('cannot be produced without the server key', () => {
    const seal = approvalSeal(base)
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(verifyApprovalSeal(base, seal)).toBe(false)
    expect(verifyApprovalSeal(base, 'v1.forged')).toBe(false)
    expect(verifyApprovalSeal(base, undefined)).toBe(false)
  })
})
