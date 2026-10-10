import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudflareFlux2Image, sniffImageMime } from '@/lib/providers/cloudflare'
import { geminiImage, veoSubmit } from '@/lib/providers/gemini'
import { OpenAIImageProvider } from '@/lib/providers/openai-image'
import { wanModelName, wanStatus, wanSubmit } from '@/lib/providers/dashscope'
import { findAudioUrl, topmediaiKeyInfo, topmediaiSpeech } from '@/lib/providers/topmediai'
import { isPublicHttpsUrl } from '@/lib/providers/safe-url'
import { shrinkReference, type ReferenceImage } from '@/lib/providers/references'
import { startGeneration, pollGeneration } from '@/lib/providers/adapters'
import { modelById } from '@/lib/providers/catalog'
import { buildImagePrompt, buildImageRequest, imagePresets, presetGroupLabels } from '@/lib/providers/image-presets'

const ctx = { ownerId: 'u', projectId: 'p', requestId: 'r' }
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')
const JPG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')
const ref = (id: string, mime = 'image/png'): ReferenceImage => ({ assetId: id, bytes: Buffer.from([1, 2, 3, 4]), mime })

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
const mockFetch = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: RequestInit = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init) }))
}
const keys = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_WAN_MODEL', 'TOPMEDIAI_API_KEY', 'TOPMEDIAI_SPEAKER']
beforeEach(() => {
  for (const k of keys) delete process.env[k]
  Object.assign(process.env, { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'cft', GEMINI_API_KEY: 'gk', OPENAI_API_KEY: 'ok', DASHSCOPE_API_KEY: 'dk', TOPMEDIAI_API_KEY: 'tk' })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Cloudflare FLUX.2 klein (multipart, references up to 4)', () => {
  it('sends multipart with prompt, size and reference fields named input_image_N', async () => {
    mockFetch(() => Response.json({ result: { image: PNG_B64 } }))
    const a = await cloudflareFlux2Image(ctx, '@cf/black-forest-labs/flux-2-klein-4b', 'a calm portrait', { width: 1344, height: 768, references: [ref('a1'), ref('a2')] })
    const { url, init } = calls[0]
    expect(url).toContain('/accounts/acc/ai/run/@cf/black-forest-labs/flux-2-klein-4b')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('prompt')).toBe('a calm portrait')
    expect(form.get('width')).toBe('1344')
    expect(form.get('input_image_0')).toBeInstanceOf(Blob)
    expect(form.get('input_image_1')).toBeInstanceOf(Blob)
    expect(form.get('input_image_2')).toBeNull()
    // fetch must set the multipart boundary itself: no Content-Type header may be forced.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cft')
    expect(a.mimeType).toBe('image/png')
    expect(a.metadata).toMatchObject({ references: ['a1', 'a2'], costTier: 'free_allowance' })
  })
  it('never sends more than 4 references and clamps the size', async () => {
    mockFetch(() => Response.json({ result: { image: JPG_B64 } }))
    const a = await cloudflareFlux2Image(ctx, '@cf/black-forest-labs/flux-2-klein-9b', 'x', { width: 5000, height: 10, references: [1, 2, 3, 4, 5, 6].map(i => ref(`r${i}`)) })
    const form = calls[0].init.body as FormData
    expect(form.get('input_image_3')).not.toBeNull()
    expect(form.get('input_image_4')).toBeNull()
    expect(form.get('width')).toBe('1920')
    expect(form.get('height')).toBe('256')
    expect(a.mimeType).toBe('image/jpeg')
  })
  it('reports the daily limit (429) and the paid-plan block (403) with their status code', async () => {
    mockFetch(() => Response.json({ errors: [{ code: 3036, message: 'Account limited' }] }, { status: 429 }))
    await expect(cloudflareFlux2Image(ctx, '@cf/black-forest-labs/flux-2-klein-4b', 'x', { width: 512, height: 512 })).rejects.toThrow(/\(429\).*3036/)
    mockFetch(() => Response.json({ errors: [{ code: 5035 }] }, { status: 403 }))
    await expect(cloudflareFlux2Image(ctx, '@cf/black-forest-labs/flux-2-klein-4b', 'x', { width: 512, height: 512 })).rejects.toThrow(/\(403\)/)
  })
  it('tells PNG from JPEG by the first bytes', () => {
    expect(sniffImageMime(PNG_B64)).toBe('image/png')
    expect(sniffImageMime(JPG_B64)).toBe('image/jpeg')
  })
  it('is wired into startGeneration with shrunk references and free-tier metadata', async () => {
    mockFetch(() => Response.json({ result: { image: PNG_B64 } }))
    const model = modelById('cloudflare:@cf/black-forest-labs/flux-2-klein-4b')!
    const r = await startGeneration({ model, prompt: 'p', finalPrompt: 'p', options: { format: '9:16' }, context: ctx })
    expect(r.kind).toBe('assets')
    const form = calls[0].init.body as FormData
    expect(form.get('width')).toBe('768')
    expect(form.get('height')).toBe('1344')
  })
})

describe('Gemini image (Nano Banana)', () => {
  it('posts text plus inline reference images and asks for an image in the right aspect ratio', async () => {
    mockFetch(() => Response.json({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }], usageMetadata: { totalTokenCount: 10 } }))
    const a = await geminiImage(ctx, 'gemini-3-pro-image', 'portrait', { aspectRatio: '9:16', references: [ref('x1', 'image/jpeg')] })
    const { url, init } = calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('gk')
    const body = JSON.parse(String(init.body))
    expect(body.contents[0].parts[0]).toEqual({ text: 'portrait' })
    expect(body.contents[0].parts[1].inlineData).toMatchObject({ mimeType: 'image/jpeg' })
    expect(body.generationConfig).toMatchObject({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } })
    expect(a.uri.startsWith('data:image/png;base64,')).toBe(true)
    expect(a.metadata).toMatchObject({ references: ['x1'] })
  })
  it('explains a missing image (safety filter) instead of saving nothing silently', async () => {
    mockFetch(() => Response.json({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [{ text: 'no' }] } }] }))
    await expect(geminiImage(ctx, 'gemini-3.1-flash-image', 'x', { aspectRatio: '16:9' })).rejects.toThrow(/IMAGE_SAFETY/)
  })
  it('surfaces the 429 that a free-tier key gets (no free image API) and rejects odd model ids', async () => {
    mockFetch(() => Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }))
    await expect(geminiImage(ctx, 'gemini-3.1-flash-image', 'x', { aspectRatio: '16:9' })).rejects.toThrow(/\(429\)/)
    await expect(geminiImage(ctx, '../evil', 'x', { aspectRatio: '16:9' })).rejects.toThrow(/Invalid/)
  })
  it('Veo gets durationSeconds as a number (a string is rejected by the real API)', async () => {
    mockFetch(() => Response.json({ name: 'models/veo-3.1-lite-generate-preview/operations/abc123' }))
    await veoSubmit('veo-3.1-lite-generate-preview', 'x', { aspectRatio: '16:9', durationSeconds: 4 })
    expect(JSON.parse(String(calls[0].init.body)).parameters.durationSeconds).toBe(4)
  })
})

describe('OpenAI images (generation and reference edits)', () => {
  it('uses /images/generations without references and honours the model chosen in the catalogue', async () => {
    mockFetch(() => Response.json({ data: [{ b64_json: PNG_B64 }] }))
    await new OpenAIImageProvider().generateImage(ctx, 'p', { model: 'gpt-image-1.5', size: '1536x1024', quality: 'high' })
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: 'gpt-image-1.5', size: '1536x1024', quality: 'high' })
  })
  it('switches to /images/edits with image[] parts when references are attached', async () => {
    mockFetch(() => Response.json({ data: [{ b64_json: PNG_B64 }] }))
    const a = await new OpenAIImageProvider().generateImage(ctx, 'p', { model: 'gpt-image-1', references: [ref('a'), ref('b')] })
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/edits')
    const form = calls[0].init.body as FormData
    expect(form.getAll('image[]')).toHaveLength(2)
    expect(form.get('input_fidelity')).toBe('high')
    expect(a.metadata).toMatchObject({ references: ['a', 'b'] })
  })
  it('does not send input_fidelity for other models and rejects unknown model names', async () => {
    mockFetch(() => Response.json({ data: [{ b64_json: PNG_B64 }] }))
    await new OpenAIImageProvider().generateImage(ctx, 'p', { model: 'gpt-image-2', references: [ref('a')] })
    expect((calls[0].init.body as FormData).get('input_fidelity')).toBeNull()
    await new OpenAIImageProvider().generateImage(ctx, 'p', { model: 'evil/../x' })
    expect(JSON.parse(String(calls[1].init.body)).model).toBe('gpt-image-1') // falls back to the configured default
  })
})

describe('Alibaba Wan via DashScope (unverified: request built from documentation)', () => {
  it('creates an async task with the async header, size and duration', async () => {
    mockFetch(() => Response.json({ output: { task_id: 'abcdef12-3456', task_status: 'PENDING' } }))
    const job = await wanSubmit('wan2.2-t2v-plus', 'a river', { format: '9:16', durationSeconds: 5, negativePrompt: 'blur' })
    const { url, init } = calls[0]
    expect(url).toBe('https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis')
    expect((init.headers as Record<string, string>)['X-DashScope-Async']).toBe('enable')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dk')
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'wan2.2-t2v-plus', input: { prompt: 'a river', negative_prompt: 'blur' }, parameters: { size: '720*1280', duration: 5 } })
    expect(job.taskId).toBe('abcdef12-3456')
  })
  it('maps task states and only accepts the result from Alibaba object storage', async () => {
    mockFetch(() => Response.json({ output: { task_status: 'RUNNING' } }))
    expect(await wanStatus({ taskId: 'abcdef12-3456', base: '' })).toEqual({ state: 'running' })
    mockFetch(() => Response.json({ output: { task_status: 'SUCCEEDED', video_url: 'https://dashscope-result-sg.oss-ap-southeast-1.aliyuncs.com/x.mp4' } }))
    expect(await wanStatus({ taskId: 'abcdef12-3456', base: '' })).toMatchObject({ state: 'done' })
    mockFetch(() => Response.json({ output: { task_status: 'SUCCEEDED', video_url: 'https://evil.example/x.mp4' } }))
    expect(await wanStatus({ taskId: 'abcdef12-3456', base: '' })).toMatchObject({ state: 'failed', error: expect.stringMatching(/dominio no permitido/) })
    mockFetch(() => Response.json({ output: { task_status: 'FAILED', message: 'bad prompt' } }))
    expect(await wanStatus({ taskId: 'abcdef12-3456', base: '' })).toMatchObject({ state: 'failed', error: expect.stringMatching(/no consumen cuota/) })
  })
  it('refuses a base URL outside aliyuncs.com so the API key cannot be sent elsewhere', async () => {
    process.env.DASHSCOPE_BASE_URL = 'https://evil.example'
    mockFetch(() => Response.json({}))
    await expect(wanSubmit('wan2.2-t2v-plus', 'x', { format: '16:9', durationSeconds: 5 })).rejects.toThrow(/aliyuncs\.com/)
    expect(calls).toHaveLength(0)
    expect(() => { process.env.DASHSCOPE_WAN_MODEL = 'x; drop'; wanModelName('alibaba:wan2.2-t2v-plus') }).toThrow()
  })
  it('flows through startGeneration/pollGeneration as a queued job', async () => {
    mockFetch(url => url.includes('/tasks/') ? Response.json({ output: { task_status: 'SUCCEEDED', video_url: 'https://dashscope-result-sg.oss-ap-southeast-1.aliyuncs.com/v.mp4' } }) : Response.json({ output: { task_id: 'abcdef12-3456' } }))
    const model = modelById('alibaba:wan2.2-t2v-plus')!
    const start = await startGeneration({ model, prompt: 'p', finalPrompt: 'p', options: { format: '16:9' }, context: ctx })
    expect(start.kind).toBe('job')
    if (start.kind !== 'job') return
    const done = await pollGeneration(model, start.job)
    expect(done).toMatchObject({ state: 'done', media: [{ mimeType: 'video/mp4' }] })
  })
})

describe('TopMediai API (unverified response shape)', () => {
  it('sends x-api-key and the documented body fields, and accepts raw audio', async () => {
    mockFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }))
    const a = await topmediaiSpeech(ctx, 'Hola mundo', 'speaker-uuid', 'Cheerful')
    expect(calls[0].url).toBe('https://api.topmediai.com/v1/text2speech')
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('tk')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: 'Hola mundo', speaker: 'speaker-uuid', emotion: 'Cheerful' })
    expect(a.mimeType).toBe('audio/mpeg')
    expect(a.metadata).toMatchObject({ characters: 10, unverifiedResponse: true })
  })
  it('follows a URL found in common JSON shapes, but only a public https one', async () => {
    mockFetch(() => Response.json({ data: { oss_url: 'https://cdn.example.com/a.mp3' } }))
    expect((await topmediaiSpeech(ctx, 'x', 's')).uri).toBe('https://cdn.example.com/a.mp3')
    mockFetch(() => Response.json({ data: { oss_url: 'http://127.0.0.1/a.mp3' } }))
    await expect(topmediaiSpeech(ctx, 'x', 's')).rejects.toThrow(/no se reconoce/)
  })
  it('fails loudly on an unrecognised response, listing field names but never values', async () => {
    mockFetch(() => Response.json({ weird: 'secret-value-123', code: 7 }))
    const err = await topmediaiSpeech(ctx, 'x', 's').catch(e => e as Error)
    expect(err.message).toMatch(/weird, code/)
    expect(err.message).not.toMatch(/secret-value/)
  })
  it('enforces the 500-character limit and the speaker id before spending anything', async () => {
    mockFetch(() => Response.json({}))
    await expect(topmediaiSpeech(ctx, 'a'.repeat(501), 's')).rejects.toThrow(/500/)
    await expect(topmediaiSpeech(ctx, 'ok', '  ')).rejects.toThrow(/speaker/)
    process.env.TOPMEDIAI_SPEAKER = 'default-speaker'
    mockFetch(() => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } }))
    await topmediaiSpeech(ctx, 'ok', '')
    expect(JSON.parse(String(calls[0].init.body)).speaker).toBe('default-speaker')
  })
  it('the key-info check is read-only and never returns the key, email or tokens', async () => {
    mockFetch(() => Response.json({ x_api_key: 'tk', email: 'me@x.com', key_status: 'active', key_words_counts: 4200, member_id: 99, notes: 'n'.repeat(200) }))
    const info = await topmediaiKeyInfo()
    expect(calls[0].init.method ?? 'GET').toBe('GET')
    expect(calls[0].url).toBe('https://api.topmediai.com/v1/get_api_key_info')
    expect(info.fields).toEqual({ key_status: 'active', key_words_counts: 4200, member_id: 99 })
    expect(JSON.stringify(info)).not.toMatch(/me@x\.com|"tk"/)
  })
  it('finds audio URLs only under known keys', () => {
    expect(findAudioUrl({ url: 'https://a.com/x.mp3' })).toBe('https://a.com/x.mp3')
    expect(findAudioUrl({ result: { audio_url: 'https://a.com/y.mp3' } })).toBe('https://a.com/y.mp3')
    expect(findAudioUrl({ other: 'https://a.com/z.mp3' })).toBeNull()
  })
  it('is wired as a voice model that always needs confirmation', async () => {
    mockFetch(() => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } }))
    const model = modelById('topmediai:text2speech')!
    expect(model.confirm).toBe(true)
    const r = await startGeneration({ model, prompt: 'hola', finalPrompt: 'hola', options: {}, voice: 'spk', context: ctx })
    expect(r.kind).toBe('assets')
  })
})

describe('safe URLs', () => {
  it('accepts public https and rejects everything that could reach internal services', () => {
    expect(isPublicHttpsUrl('https://v3.fal.media/a.png')).toBe(true)
    for (const bad of ['http://a.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://169.254.169.254/x', 'https://[::1]/x', 'https://user:pw@a.com/x', 'file:///etc/passwd', 'https://intranet/x', 'nope', 7]) expect(isPublicHttpsUrl(bad), String(bad)).toBe(false)
    expect(isPublicHttpsUrl('https://x.oss.aliyuncs.com/a', ['aliyuncs.com'])).toBe(true)
    expect(isPublicHttpsUrl('https://aliyuncs.com.evil.io/a', ['aliyuncs.com'])).toBe(false)
  })
})

describe('reference images are shrunk for Cloudflare', () => {
  it('reduces the longest side to 512 px and re-encodes as JPEG', async () => {
    const sharp = (await import('sharp')).default
    const big = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()
    const out = await shrinkReference({ assetId: 'z', bytes: big, mime: 'image/png' }, 512)
    const meta = await sharp(out.bytes).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(512)
    expect(meta.format).toBe('jpeg')
    expect(out.mime).toBe('image/jpeg')
    const small = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#fff' } }).png().toBuffer()
    expect((await sharp((await shrinkReference({ assetId: 's', bytes: small, mime: 'image/png' }, 512)).bytes).metadata()).width).toBe(100) // never enlarged
  })
})

describe('image prompts: photographic, cinematic and artistic looks with character consistency', () => {
  it('offers the three families and keeps the original five presets', () => {
    const groups = new Set(Object.values(imagePresets).map(p => p.group))
    expect([...groups].sort()).toEqual(['art', 'cinema', 'photo'])
    expect(presetGroupLabels.photo).toBe('Fotográficos')
    expect(Object.keys(imagePresets).length).toBeGreaterThanOrEqual(14)
  })
  it('photographic looks carry skin/hand realism rules; painted looks do not', () => {
    expect(buildImagePrompt({ subject: 'x', preset: 'portrait' })).toMatch(/skin pores/)
    expect(buildImagePrompt({ subject: 'x', preset: 'portrait' })).toMatch(/beauty-filter smoothing/)
    expect(buildImagePrompt({ subject: 'x', preset: 'oil_painting' })).not.toMatch(/skin pores/)
    expect(buildImagePrompt({ subject: 'x', preset: 'film35' })).toMatch(/Kodak Portra 400/)
  })
  it('puts the identity lock and the reference instruction in every scene prompt', () => {
    const { prompt } = buildImageRequest({ subject: 'walks into a kitchen', preset: 'cinematic', references: { count: 2, role: 'identity' }, identity: 'Marta, 40s, short grey hair, green parka' })
    expect(prompt).toMatch(/Character \(identical in every scene/)
    expect(prompt).toMatch(/Marta, 40s/)
    expect(prompt).toMatch(/2 attached reference images as the identity reference/)
    expect(prompt).toMatch(/Change only the pose, expression, setting, framing and lighting/)
    expect(buildImageRequest({ subject: 'x', preset: 'cinematic', references: { count: 1, role: 'style' } }).prompt).toMatch(/only as a style reference/)
  })
  it('splits avoidances into a negative prompt for models that have one, and writes them inline otherwise', () => {
    const inline = buildImageRequest({ subject: 'x', preset: 'documentary' })
    expect(inline.negative).toBeNull()
    expect(inline.prompt).toMatch(/Avoid: glossy or plastic-looking skin/)
    const native = buildImageRequest({ subject: 'x', preset: 'product', nativeNegative: true, extraNegative: 'no people' })
    expect(native.prompt).not.toMatch(/Avoid:/)
    expect(native.negative).toMatch(/plastic-looking skin/)
    expect(native.negative).toMatch(/garbled labels/)
    expect(native.negative).toMatch(/no people/)
    expect(native.negative!.length).toBeLessThanOrEqual(1000)
  })
})
