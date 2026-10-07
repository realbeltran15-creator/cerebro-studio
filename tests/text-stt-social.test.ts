import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractJson, geminiOutputText, routeText, runTextTask, estimateTextCost, textModels } from '@/lib/providers/text'
import { routeStt, toSrt, toVtt } from '@/lib/providers/transcribe'
import { socialAuthUrl, SOCIAL_SCOPES } from '@/lib/oauth/social'
import { publishSocialJob, socialApprovalKey, tiktokChunks, validateSocialPayload } from '@/lib/publication/social'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('text router: quality first, then cost', () => {
  const env = { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k', OPENAI_API_KEY: 'o' }
  it('never routes a task to a model below its required quality', () => {
    expect(routeText('script_draft', env).map(m => m.provider)).toEqual(['openai'])
    expect(routeText('script_hooks', env).every(m => m.quality >= 4)).toBe(true)
  })
  it('among eligible models prefers free tiers, then lower price', () => {
    const ids = routeText('prompt_enhance', env).map(m => m.id)
    expect(ids[0]).toBe('groq:openai/gpt-oss-20b')
    expect(ids[ids.length - 1]).toBe('openai:configured')
  })
  it('uses an own gateway (OmniRoute) first for tasks within its declared quality', () => {
    vi.stubEnv('TEXT_GATEWAY_QUALITY', '3')
    const e = { ...env, TEXT_GATEWAY_BASE_URL: 'https://gw.example/v1' }
    expect(routeText('prompt_enhance', e)[0].id).toBe('gateway:configured')
    expect(routeText('script_draft', e).map(m => m.provider)).not.toContain('gateway')
    vi.stubEnv('TEXT_GATEWAY_QUALITY', '5')
    expect(routeText('script_draft', e)[0].id).toBe('gateway:configured')
  })
  it('extracts JSON wrapped in prose or code fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('Aquí está: {"a":{"b":2}} gracias')).toBe('{"a":{"b":2}}')
  })
  it('returns nothing when no provider is configured', () => {
    expect(routeText('tags', {})).toEqual([])
  })
  it('estimates cost from tokens', () => {
    const m = textModels.find(t => t.id === 'groq:openai/gpt-oss-120b')!
    expect(estimateTextCost(m, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.75)
    expect(estimateTextCost(m, { inputTokens: null, outputTokens: 5 })).toBeNull()
  })
  it('reads Gemini Interactions output in both documented shapes', () => {
    expect(geminiOutputText({ output_text: '{"a":1}' })).toBe('{"a":1}')
    expect(geminiOutputText({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"b"' }, { type: 'text', text: ':2}' }] }] })).toBe('{"b":2}')
  })
  it('falls back to the next eligible model when the output is incomplete', async () => {
    vi.stubEnv('GROQ_API_KEY', 'g'); vi.stubEnv('GEMINI_API_KEY', 'k'); vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('OPENAI_TEXT_API_KEY', '')
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('groq')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"hooks":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
      return new Response(JSON.stringify({ output_text: '{"hooks":["uno"]}' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const r = await runTextTask('script_hooks', { system: 's', user: 'u', schema: {}, schemaName: 'x', requestId: 'r', validate: v => ((v as { hooks: string[] }).hooks.length ? v as { hooks: string[] } : null) })
    expect(r.model.provider).toBe('gemini')
    expect(r.attempts[0].model).toBe('groq:openai/gpt-oss-120b')
    expect(r.data.hooks).toEqual(['uno'])
  })
})

describe('Gemini text: transient provider errors', () => {
  const task = () => runTextTask('tags', { system: 's', user: 'u', schema: {}, schemaName: 'x', requestId: 'r', validate: v => ((v as { tags?: string[] }).tags?.length ? v as { tags: string[] } : null) })
  it('retries the same model once on a 503 demand spike and then succeeds', async () => {
    vi.useFakeTimers()
    vi.stubEnv('GEMINI_API_KEY', 'k'); vi.stubEnv('GROQ_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('OPENAI_TEXT_API_KEY', '')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":"service_unavailable"}}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: '{"tags":["selva"]}' })))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const pending = task()
    await vi.advanceTimersByTimeAsync(2000)
    const r = await pending
    vi.useRealTimers()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r.data.tags).toEqual(['selva'])
    expect(r.attempts).toEqual([])
  })
  it('reports the provider status when the spike persists, so the UI can explain it', async () => {
    vi.useFakeTimers()
    vi.stubEnv('GEMINI_API_KEY', 'k'); vi.stubEnv('GROQ_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('OPENAI_TEXT_API_KEY', '')
    const fetchMock = vi.fn(async () => new Response('x', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = task().catch(e => e)
    await vi.advanceTimersByTimeAsync(2000)
    const e = await pending as { status: number | null; attempts: Array<{ model: string }> }
    vi.useRealTimers()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(e.status).toBe(503)
    expect(e.attempts[0].model).toBe('gemini:gemini-3.8-flash')
  })
  it('does not retry quota errors (429)', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k'); vi.stubEnv('GROQ_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('OPENAI_TEXT_API_KEY', '')
    const fetchMock = vi.fn(async () => new Response('x', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(task()).rejects.toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('transcription', () => {
  it('prefers the most accurate configured model', () => {
    expect(routeStt({ GROQ_API_KEY: 'g', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' })[0].id).toBe('groq:whisper-large-v3')
    expect(routeStt({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }).map(m => m.tier)).toEqual(['free'])
  })
  it('formats SRT and VTT timestamps', () => {
    const segs = [{ start: 0, end: 2.5, text: 'Hola' }, { start: 3661.25, end: 3662, text: 'Adiós' }]
    expect(toSrt(segs)).toContain('1\n00:00:00,000 --> 00:00:02,500\nHola')
    expect(toSrt(segs)).toContain('2\n01:01:01,250 --> 01:01:02,000\nAdiós')
    expect(toVtt(segs).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:02.500')).toBe(true)
  })
})

describe('social OAuth and publishing guards', () => {
  it('builds official authorize URLs with the publish scopes and state', () => {
    vi.stubEnv('INSTAGRAM_APP_ID', 'ig-app'); vi.stubEnv('TIKTOK_CLIENT_KEY', 'tt-key')
    const ig = new URL(socialAuthUrl('instagram', 'https://app.test', 'nonce'))
    expect(ig.origin + ig.pathname).toBe('https://www.instagram.com/oauth/authorize')
    expect(ig.searchParams.get('scope')).toBe(SOCIAL_SCOPES.instagram.join(','))
    expect(ig.searchParams.get('redirect_uri')).toBe('https://app.test/api/oauth/instagram/callback')
    const tt = new URL(socialAuthUrl('tiktok', 'https://app.test', 'nonce'))
    expect(tt.origin + tt.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/')
    expect(tt.searchParams.get('client_key')).toBe('tt-key')
    expect(tt.searchParams.get('state')).toBe('nonce')
  })
  it('validates payloads per platform', () => {
    expect(validateSocialPayload('tiktok', {})).toMatch(/vídeo/)
    expect(validateSocialPayload('instagram', { videoAssetId: 'v', caption: '#a '.repeat(31) })).toMatch(/30 hashtags/)
    expect(validateSocialPayload('tiktok', { videoAssetId: 'v', caption: 'ok' })).toBeNull()
  })
  it('computes TikTok chunks within the documented limits', () => {
    expect(tiktokChunks(10 * 1024 * 1024)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 1 })
    const big = tiktokChunks(105 * 1024 * 1024)
    expect(big.chunkSize).toBe(10 * 1024 * 1024)
    expect(big.count).toBe(10)
  })
  it('approval key is per platform and job', () => {
    expect(socialApprovalKey({ owner_id: 'u', platform: 'tiktok', project_id: 'p', idempotency_key: 'k' })).toBe('tiktok:k')
  })
  it('refuses to publish a job without an explicit approval record and never calls the network', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const job = { id: 'j', owner_id: 'u', project_id: 'p', platform: 'tiktok', status: 'approved', idempotency_key: 'k', payload: { videoAssetId: 'v' }, result: null }
    const chain = (data: unknown) => { const q: Record<string, unknown> = {}; for (const f of ['select', 'eq', 'in', 'order', 'limit']) q[f] = () => q; q.maybeSingle = async () => ({ data }); return q }
    const db = { from: (t: string) => chain(t === 'publication_jobs' ? job : null) }
    await expect(publishSocialJob(db as never, 'u', 'j')).rejects.toThrow(/approval is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('refuses jobs that are not approved', async () => {
    const job = { id: 'j', owner_id: 'u', project_id: 'p', platform: 'instagram', status: 'draft', idempotency_key: 'k', payload: { videoAssetId: 'v' }, result: null }
    const q: Record<string, unknown> = {}; for (const f of ['select', 'eq']) q[f] = () => q; q.maybeSingle = async () => ({ data: job })
    await expect(publishSocialJob({ from: () => q } as never, 'u', 'j')).rejects.toThrow(/no está aprobado/)
  })
})
