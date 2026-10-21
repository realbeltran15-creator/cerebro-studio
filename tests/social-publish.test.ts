import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptJson } from '@/lib/security/tokens'
import { approvalSeal } from '@/lib/publication/seal'
import { publishSocialJob } from '@/lib/publication/social'

const PATH = 'u1/p1/renders/v.mp4'
beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64'); process.env.TIKTOK_CLIENT_KEY = 'k'; process.env.TIKTOK_CLIENT_SECRET = 's' })
afterEach(() => vi.unstubAllGlobals())

function state(payload: Record<string, unknown>) {
  const job: Record<string, any> = { id: 'j1', owner_id: 'u1', project_id: 'p1', platform: 'tiktok', status: 'approved', idempotency_key: 'k1', payload: { videoAssetId: 'vid', caption: 'hola', ...payload }, result: null, updated_at: new Date().toISOString() }
  job.result = { approvalSeal: approvalSeal({ ownerId: 'u1', jobId: 'j1', platform: 'tiktok', idempotencyKey: 'k1', payload: job.payload, videoStoragePath: PATH }) }
  return {
    job,
    approval: { owner_id: 'u1', action_type: 'publish', entity_id: 'tiktok:k1', status: 'approved' },
    connection: { id: 'c1', owner_id: 'u1', provider: 'tiktok', external_account_id: 'open-1', external_account_name: 'umbral', status: 'connected', scopes: ['user.info.basic', 'video.publish'],
      token_ciphertext: encryptJson({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 3600e3, scope: '', account_id: 'open-1' }) },
  }
}
function fakeDb(s: ReturnType<typeof state>) {
  return {
    storage: { from: () => ({ download: async () => ({ data: new Blob(['bytes'], { type: 'video/mp4' }), error: null }) }) },
    from(table: string) {
      const q: { op: string; payload: any } = { op: 'select', payload: null }
      const exec = () => {
        if (q.op === 'update' && table === 'publication_jobs') {
          if (q.payload.status === 'publishing') { const ok = s.job.status === 'approved'; if (ok) s.job.status = 'publishing'; return { data: ok ? [{ id: 'j1' }] : [], error: null } }
          Object.assign(s.job, q.payload); return { data: null, error: null }
        }
        if (q.op === 'update') return { data: null, error: null }
        if (table === 'publication_jobs') return { data: s.job, error: null }
        if (table === 'approvals') return { data: s.approval, error: null }
        if (table === 'channel_connections') return { data: [s.connection], error: null }
        if (table === 'assets') return { data: { asset_type: 'video', storage_path: PATH, provenance: { mimeType: 'video/mp4', durationMs: 30_000 } }, error: null }
        return { data: null, error: null }
      }
      const chain: any = new Proxy({}, { get(_, p) {
        if (p === 'then') return (res: any, rej: any) => Promise.resolve(exec()).then(res, rej)
        if (p === 'update') return (payload: any) => { q.op = 'update'; q.payload = payload; return chain }
        return () => chain
      } })
      return chain
    },
  } as any
}
function tiktok(creator: Record<string, unknown>) {
  const inits: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input)
    const ok = (data: unknown) => new Response(JSON.stringify({ data, error: { code: 'ok' } }), { status: 200 })
    if (url.endsWith('/creator_info/query/')) return ok({ creator_nickname: 'Umbral', privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600, ...creator })
    if (url.endsWith('/video/init/')) { inits.push(JSON.parse(String(init?.body))); return ok({ publish_id: 'pub1', upload_url: 'https://upload.tiktok.test/u' }) }
    if (url === 'https://upload.tiktok.test/u') return new Response('', { status: 201 })
    if (url.endsWith('/status/fetch/')) return ok({ status: 'PUBLISH_COMPLETE' })
    throw new Error(`unexpected ${url}`)
  }))
  return inits
}

describe('TikTok Direct Post follows the Content Sharing Guidelines', () => {
  it('keeps interactions off unless allowed, and the creator settings always win', async () => {
    const inits = tiktok({ comment_disabled: true })
    const s = state({ privacyLevel: 'SELF_ONLY', disableComment: false, disableDuet: false })
    await publishSocialJob(fakeDb(s), 'u1', 'j1', undefined, 'open-1')
    expect(inits[0].post_info).toMatchObject({ privacy_level: 'SELF_ONLY', disable_comment: true, disable_duet: false, disable_stitch: true, brand_content_toggle: false, brand_organic_toggle: false })
    expect(s.job.status).toBe('published')
  })
  it('refuses a privacy the creator does not allow, a video longer than allowed, or another account — before uploading', async () => {
    let inits = tiktok({})
    await expect(publishSocialJob(fakeDb(state({ privacyLevel: 'PUBLIC_TO_EVERYONE' })), 'u1', 'j1', undefined, 'open-1')).rejects.toThrow(/Privacidad no permitida/)
    inits = tiktok({ max_video_post_duration_sec: 15 })
    await expect(publishSocialJob(fakeDb(state({ privacyLevel: 'SELF_ONLY' })), 'u1', 'j1', undefined, 'open-1')).rejects.toThrow(/como máximo 15 s/)
    const s = state({ privacyLevel: 'SELF_ONLY' })
    await expect(publishSocialJob(fakeDb(s), 'u1', 'j1', undefined, 'otra-cuenta')).rejects.toThrow(/no es la que confirmaste/)
    expect(inits).toHaveLength(0)
    expect(s.job.status).toBe('approved')
  })
})
