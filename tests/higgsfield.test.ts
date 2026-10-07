import { afterEach, describe, expect, it, vi } from 'vitest'
import { modelById } from '@/lib/providers/catalog'
import { startGeneration, pollGeneration } from '@/lib/providers/adapters'
import { checkModelPath, higgsfieldInput } from '@/lib/providers/higgsfield'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const RID = '3f1c2b9e-1111-4a2b-9c3d-123456789abc'

describe('Higgsfield official API adapter', () => {
  it('submits with Key auth and an idempotency key, then reads the documented status shape', async () => {
    vi.stubEnv('HIGGSFIELD_API_KEY_ID', 'kid'); vi.stubEnv('HIGGSFIELD_API_KEY_SECRET', 'ksec')
    const calls: Array<{ url: string; init: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url, init })
      if (url.endsWith('/status')) return new Response(JSON.stringify({ status: 'completed', request_id: RID, images: [{ url: 'https://cdn.higgsfield.ai/a.png' }, { url: 'https://cdn.higgsfield.ai/b.png' }] }))
      return new Response(JSON.stringify({ status: 'queued', request_id: RID, status_url: `https://api.higgsfield.ai/requests/${RID}/status` }))
    }))
    const model = modelById('higgsfield:higgsfield-ai/soul/standard')!
    const start = await startGeneration({ model, prompt: 'lago', finalPrompt: 'lago al amanecer', options: { format: '9:16', variants: 2 }, context: { ownerId: 'u', projectId: 'p', requestId: 'req-1' } })
    expect(calls[0].url).toBe('https://api.higgsfield.ai/higgsfield-ai/soul/standard')
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Key kid:ksec', 'Idempotency-Key': 'req-1' })
    expect(JSON.parse(calls[0].init.body)).toEqual({ prompt: 'lago al amanecer', num_images: 2, resolution: '2K', aspect_ratio: '9:16' })
    expect(start.kind).toBe('job')
    if (start.kind !== 'job') return
    const poll = await pollGeneration(model, start.job)
    expect(poll).toMatchObject({ state: 'done' })
    if (poll.state === 'done') expect(poll.media.map(m => m.uri)).toEqual(['https://cdn.higgsfield.ai/a.png', 'https://cdn.higgsfield.ai/b.png'])
  })
  it('reports blocked content as failed (credits refunded)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'nsfw', request_id: RID }))))
    const model = modelById('higgsfield:kling-video/v2.5-turbo/pro/text-to-video')!
    const r = await pollGeneration(model, { provider: 'higgsfield', hf: { requestId: RID } })
    expect(r).toMatchObject({ state: 'failed' })
  })
  it('builds documented inputs and rejects unexpected paths', () => {
    expect(higgsfieldInput('minimax/hailuo-2.3/standard/text-to-video', 'x', { durationSeconds: 10 })).toEqual({ prompt: 'x', duration: 10, prompt_optimizer: true })
    expect(() => checkModelPath('../../evil')).toThrow()
    expect(modelById('higgsfield:higgsfield-ai/soul/standard')!.confirm).toBe(true)
  })
})
