import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptJson, encryptJson, tokenEncryptionConfigured } from '@/lib/security/tokens'
import { authUrl } from '@/lib/oauth/google'
import { publishJob } from '@/lib/publication/youtube'

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
        if (table === 'assets') return { data: { asset_type: q.filters.id === 'thumb' ? 'thumbnail' : 'video', storage_path: 'u1/p1/renders/vid.webm', provenance: { mimeType: 'video/webm' } }, error: null }
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

function state() {
  return {
    job: { id: 'j1', owner_id: 'u1', project_id: 'p1', platform: 'youtube', status: 'approved', idempotency_key: 'k1', payload: { title: 'Mi vídeo', videoAssetId: 'vid', privacyStatus: 'private' }, result: null } as Record<string, any>,
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
})
