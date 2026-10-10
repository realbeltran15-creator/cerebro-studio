import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog, falEndpoint, falInput, falOutputs, modelById } from '@/lib/providers/catalog'
import { falResult, falStatus, falSubmit, isFalMediaUrl, safeQueueUrl, type FalJob } from '@/lib/providers/fal-queue'

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
const job: FalJob = { requestId: 'r1', statusUrl: 'https://queue.fal.run/fal-ai/x/requests/r1/status', responseUrl: 'https://queue.fal.run/fal-ai/x/requests/r1' }

beforeEach(() => { vi.stubEnv('FAL_KEY', 'test-key-not-real'); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('fal hosts and media allow-list', () => {
  it('only polls queue.fal.run over https', () => {
    expect(safeQueueUrl('https://queue.fal.run/a/b')).toBeTruthy()
    for (const bad of ['http://queue.fal.run/a', 'https://evil.example/a', 'https://queue.fal.run.evil.example/a', 'https://fal.run/a', null]) expect(safeQueueUrl(bad)).toBeNull()
  })
  it('downloads outputs only from fal.media and its subdomains (plus explicitly configured hosts)', () => {
    for (const ok of ['https://v3.fal.media/files/a/b.mp4', 'https://v3b.fal.media/files/x.mp4', 'https://fal.media/files/x.mp4']) expect(isFalMediaUrl(ok)).toBe(true)
    for (const bad of ['http://v3.fal.media/x', 'https://evilfal.media/x', 'https://fal.media.evil.example/x', 'https://user:pw@v3.fal.media/x', 'https://169.254.169.254/latest', 'https://example.com/x.mp4', 42]) expect(isFalMediaUrl(bad)).toBe(false)
    vi.stubEnv('FAL_EXTRA_MEDIA_HOSTS', 'cdn.example.net, bad host!')
    expect(isFalMediaUrl('https://cdn.example.net/x.mp4')).toBe(true)
    expect(isFalMediaUrl('https://other.example.net/x.mp4')).toBe(false)
  })
  it('falOutputs drops files that are not on fal media hosts', () => {
    const r = { video: { url: 'https://v3.fal.media/files/a.mp4', content_type: 'video/mp4' } }
    expect(falOutputs(r, 'video')).toEqual([{ url: 'https://v3.fal.media/files/a.mp4', contentType: 'video/mp4' }])
    expect(falOutputs({ video: { url: 'https://evil.example/a.mp4' } }, 'video')).toEqual([])
  })
})

describe('fal video catalogue', () => {
  const videoModels = catalog.filter(m => m.provider === 'fal' && m.modality === 'video')
  it('lists the minimal-cost draft model with an honest, unconfirmed estimate', () => {
    const m = modelById('fal:fal-ai/wan/v2.2-5b/text-to-video/fast-wan')!
    expect(m.tier).toBe('paid')
    expect(m.priceConfirmed).toBe(false)
    expect(m.estimateUsd({})).toBeLessThan(0.1)
    expect(m.quality).toBeLessThanOrEqual(2)
    expect(m.env).toEqual(['FAL_KEY'])
  })
  it('every fal video model has an input mapping and the cheapest is the draft model', () => {
    expect(videoModels.length).toBeGreaterThanOrEqual(3)
    for (const m of videoModels) expect(() => falInput(m, 'prompt', {})).not.toThrow()
    const cheapest = [...videoModels].sort((a, b) => a.estimateUsd({}) - b.estimateUsd({}))[0]
    expect(falEndpoint(cheapest)).toBe('fal-ai/wan/v2.2-5b/text-to-video/fast-wan')
  })
  it('sends only the prompt for the default format and adds the aspect ratio otherwise', () => {
    const m = modelById('fal:fal-ai/wan/v2.2-5b/text-to-video/fast-wan')!
    expect(falInput(m, 'selva', {})).toEqual({ prompt: 'selva' })
    expect(falInput(m, 'selva', { format: '9:16' })).toEqual({ prompt: 'selva', aspect_ratio: '9:16' })
  })
})

describe('fal queue client', () => {
  it('submits once, with the Key header, and never retries a rejected submission', async () => {
    const f = vi.fn(async () => json({ detail: 'prompt is required' }, 422))
    vi.stubGlobal('fetch', f)
    await expect(falSubmit('fal-ai/x', {})).rejects.toThrow(/\(422\)[\s\S]*parámetros/)
    expect(f).toHaveBeenCalledTimes(1)
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).Authorization).toBe('Key test-key-not-real')
  })
  it('explains auth and balance failures without echoing the key', async () => {
    for (const [status, text] of [[401, /clave de fal\.ai no es válida/], [403, /saldo/]] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => json({ detail: 'nope' }, status)))
      const err = await falSubmit('fal-ai/x', {}).then(() => null, e => e as Error)
      expect(err!.message).toMatch(text)
      expect(err!.message).toContain(`(${status})`)
      expect(err!.message).not.toContain('test-key-not-real')
    }
  })
  it('accepts a valid job and refuses URLs outside queue.fal.run', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ request_id: 'r1', status_url: job.statusUrl, response_url: job.responseUrl })))
    await expect(falSubmit('fal-ai/x', { prompt: 'a' })).resolves.toEqual(job)
    vi.stubGlobal('fetch', vi.fn(async () => json({ request_id: 'r1', status_url: 'https://evil.example/s', response_url: job.responseUrl })))
    await expect(falSubmit('fal-ai/x', { prompt: 'a' })).rejects.toThrow(/trabajo válido/)
  })
  it('retries a status read through transient 5xx and then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 503 })).mockResolvedValueOnce(json({ status: 'IN_PROGRESS' }))
    vi.stubGlobal('fetch', f)
    const p = falStatus(job)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toEqual({ state: 'running', position: null })
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('gives up on a status read after three attempts', async () => {
    const f = vi.fn(async () => new Response('x', { status: 502 }))
    vi.stubGlobal('fetch', f)
    const p = falStatus(job).then(() => null, (e: Error) => e)
    await vi.advanceTimersByTimeAsync(5000)
    expect((await p)?.message).toMatch(/502/)
    expect(f).toHaveBeenCalledTimes(3)
  })
  it('reports why a finished job has no result (e.g. safety filter) and that failed jobs are not billed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ detail: 'content policy violation' }, 422)))
    await expect(falResult(job)).rejects.toThrow(/422[\s\S]*content policy violation[\s\S]*no se cobran/)
  })
  it('maps statuses', async () => {
    for (const [status, state] of [['IN_QUEUE', 'queued'], ['IN_PROGRESS', 'running'], ['COMPLETED', 'done']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => json({ status, queue_position: 2 })))
      expect((await falStatus(job)).state).toBe(state)
    }
  })
})

import { pollGeneration, startGeneration } from '@/lib/providers/adapters'
describe('fal video end to end with a simulated queue (no network, no spend)', () => {
  const model = modelById('fal:fal-ai/wan/v2.2-5b/text-to-video/fast-wan')!
  const ctx = { ownerId: 'u1', projectId: 'p1', requestId: 'req' }
  function queue(resultBody: unknown, statuses: string[] = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']) {
    const calls: Array<{ url: string; method: string }> = []
    let s = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input); calls.push({ url, method: init?.method ?? 'GET' })
      if (init?.method === 'POST') return json({ request_id: 'rq1', status_url: job.statusUrl, response_url: job.responseUrl })
      if (url.endsWith('/status')) return json({ status: statuses[Math.min(s++, statuses.length - 1)], queue_position: 1 })
      return json(resultBody)
    }))
    return calls
  }
  it('submits once, polls through queued/running, and returns the file for storage with a stable external id', async () => {
    const calls = queue({ video: { url: 'https://v3.fal.media/files/a/clip.mp4', content_type: 'video/mp4' } })
    const started = await startGeneration({ model, prompt: 'selva', finalPrompt: 'selva', options: {}, context: ctx } as never)
    expect(started.kind).toBe('job')
    if (started.kind !== 'job' || started.job.provider !== 'fal') throw new Error('expected a fal job')
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
    expect((await pollGeneration(model, started.job)).state).toBe('queued')
    expect((await pollGeneration(model, started.job)).state).toBe('running')
    const done = await pollGeneration(model, started.job)
    expect(done).toEqual({ state: 'done', media: [{ uri: 'https://v3.fal.media/files/a/clip.mp4', mimeType: 'video/mp4', externalId: 'rq1#0' }] })
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
  })
  it('refuses a file on an unexpected host and says which', async () => {
    queue({ video: { url: 'https://files.evil.example/clip.mp4' } }, ['COMPLETED'])
    const out = await pollGeneration(model, { provider: 'fal', fal: job })
    expect(out).toMatchObject({ state: 'failed' })
    expect(JSON.stringify(out)).toMatch(/files\.evil\.example.*FAL_EXTRA_MEDIA_HOSTS/)
  })
  it('reports an empty result as a probable safety filter', async () => {
    queue({ video: null }, ['COMPLETED'])
    expect(JSON.stringify(await pollGeneration(model, { provider: 'fal', fal: job }))).toMatch(/filtro de seguridad/)
  })
})
