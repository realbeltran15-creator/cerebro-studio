import { afterEach, describe, expect, it, vi } from 'vitest'
import { catalog, modelById } from '@/lib/providers/catalog'
import { providers, providerById } from '@/lib/providers/directory'
import { pickModel, rankModels, type Availability } from '@/lib/providers/router'
import { summarizeUsage, type UsageAsset } from '@/lib/providers/usage'
import { describeAsset, originOf, type LibraryAsset } from '@/lib/library'
import { allowedDownload, freesoundLicense } from '@/lib/providers/stock'
import { startGeneration, pollGeneration } from '@/lib/providers/adapters'

const all = (ready: boolean): Record<string, Availability> => Object.fromEntries(catalog.map(m => [m.id, { ready }]))

describe('provider directory and catalogue', () => {
  it('every model belongs to a known provider and declares tier, quality and capabilities', () => {
    for (const m of catalog) {
      expect(providerById(m.provider), m.id).toBeTruthy()
      expect(['free', 'credits', 'freemium', 'paid', 'local']).toContain(m.tier)
      expect(m.quality).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(m.capabilities)).toBe(true)
    }
  })
  it('Google Flow is listed without an API; Veo goes through the official Gemini API', () => {
    expect(providerById('google-flow')?.api).toBe('no_public_api')
    expect(modelById('gemini:veo-3.1-fast-generate-preview')?.env).toEqual(['GEMINI_API_KEY'])
    expect(modelById('gemini:veo-3.1-fast-generate-preview')?.priceConfirmed).toBe(false)
  })
  it('every provider records when its facts were checked and where', () => {
    for (const p of providers) { expect(p.verifiedAt).toMatch(/^2026-\d\d-\d\d$/); expect(p.docsUrl).toMatch(/^https:\/\//) }
  })
})

describe('selection strategies never require spending', () => {
  it('best value with draft quality uses the free model', () => {
    const r = rankModels(catalog, { modality: 'image', strategy: 'best_value', minQuality: 2 }, all(true))
    expect(r[0].model.tier).toBe('free')
  })
  it('best value never drops below the required quality to save money', () => {
    const r = pickModel(catalog, { modality: 'image', strategy: 'best_value', minQuality: 4 }, all(true))!
    expect(r.model.quality).toBeGreaterThanOrEqual(4)
    expect(r.model.id).toBe('fal:fal-ai/flux-2-pro') // cheapest among quality ≥ 4
    expect(rankModels(catalog, { modality: 'image', strategy: 'best_value', minQuality: 4 }, all(true)).find(x => x.model.tier === 'free')!.eligible).toBe(false)
  })
  it('maps old saved strategies', async () => {
    const { normalizeStrategy } = await import('@/lib/providers/router')
    expect(normalizeStrategy('free_first')).toBe('best_value')
    expect(normalizeStrategy('cheapest')).toBe('best_value')
    expect(normalizeStrategy('nope')).toBeNull()
  })
  it('free only marks paid models as not eligible', () => {
    const r = rankModels(catalog, { modality: 'video', strategy: 'free_only' }, all(true))
    expect(r.every(x => !x.eligible)).toBe(true)
    expect(pickModel(catalog, { modality: 'video', strategy: 'free_only' }, all(true))).toBeNull()
  })
  it('best quality and cheapest order differently', () => {
    const best = pickModel(catalog, { modality: 'image', strategy: 'best_quality' }, all(true))!
    const cheap = pickModel(catalog, { modality: 'image', strategy: 'best_value', minQuality: 1 }, all(true))!
    expect(best.model.quality).toBe(5)
    expect(cheap.estimateUsd).toBe(0)
  })
  it('skips unconfigured providers and exhausted credits, explaining why', () => {
    const availability = { ...all(false), 'elevenlabs:music_v1': { ready: true, creditsExhausted: true }, 'fal:fal-ai/lyria2': { ready: true } }
    const r = rankModels(catalog, { modality: 'music', strategy: 'best_value' }, availability)
    expect(r[0].model.id).toBe('fal:fal-ai/lyria2')
    expect(r.find(x => x.model.id === 'elevenlabs:music_v1')!.reasons).toContain('Sin créditos disponibles en el proveedor')
  })
  it('respects a manual provider and format', () => {
    const r = pickModel(catalog, { modality: 'image', strategy: 'best_quality', providers: ['openai'], format: '9:16' }, all(true))!
    expect(r.model.provider).toBe('openai')
    // Free images now exist (Cloudflare FLUX.2 klein 4B), but never for video, and never when a paid provider was chosen by hand.
    expect(pickModel(catalog, { modality: 'image', strategy: 'free_only', format: '16:9' }, all(true))!.model.id).toBe('cloudflare:@cf/black-forest-labs/flux-2-klein-4b')
    expect(pickModel(catalog, { modality: 'image', strategy: 'free_only', providers: ['openai'] }, all(true))).toBeNull()
  })
})

describe('usage ledger from provenance', () => {
  const a = (p: Record<string, unknown>, extra: Partial<UsageAsset> = {}): UsageAsset => ({ id: Math.random().toString(36), asset_type: 'image', project_id: 'p1', source_provider: 'x', license_status: 'generated', provenance: p, created_at: '2026-10-01T00:00:00Z', ...extra })
  it('sums estimates for paid, credits from providers and ignores user uploads', () => {
    const s = summarizeUsage([
      a({ catalogModel: 'fal:fal-ai/flux-2-pro', providerName: 'fal.ai', costTier: 'paid', estimateUsd: 0.045 }),
      a({ catalogModel: 'fal:fal-ai/flux-2-pro', providerName: 'fal.ai', costTier: 'paid', estimateUsd: 0.045 }),
      a({ catalogModel: 'elevenlabs:sound-generation', providerName: 'ElevenLabs', costTier: 'credits', credits: { credits: 120 } }, { asset_type: 'sfx' }),
      a({ catalogModel: 'cloudflare:@cf/black-forest-labs/flux-1-schnell', costTier: 'free_allowance' }),
      a({ title: 'mi canción' }, { license_status: 'owned', asset_type: 'music' }),
    ])
    expect(s.generations).toBe(4)
    expect(s.estimatedUsd).toBeCloseTo(0.09)
    expect(s.elevenCredits).toBe(120)
    expect(s.byTier.free).toBe(1)
    expect(s.rows[0]).toMatchObject({ provider: 'fal.ai', count: 2 })
  })
})

describe('library provenance', () => {
  const asset = (p: Record<string, unknown>, extra: Partial<LibraryAsset> = {}): LibraryAsset => ({ id: 'a', asset_type: 'sfx', project_id: 'p', storage_path: 's', source_provider: 'freesound', source_url: 'https://freesound.org/s/1/', license_status: 'licensed', provenance: p, created_at: '2026-10-01T00:00:00Z', ...extra })
  it('describes an imported sound with author, license and source', () => {
    const d = describeAsset(asset({ importedAt: '2026-10-01', title: 'Lluvia', license: 'CC Attribution', attribution: '"Lluvia" por ana', provider: 'freesound' }))
    expect(originOf(asset({ importedAt: 'x' }))).toBe('imported')
    expect(d).toMatchObject({ title: 'Lluvia', tier: 'free', license: 'CC Attribution', attribution: '"Lluvia" por ana', sourceUrl: 'https://freesound.org/s/1/' })
  })
  it('describes a generation with model, params and cost', () => {
    const d = describeAsset(asset({ catalogModel: 'fal:fal-ai/veo3/fast', providerName: 'fal.ai', originalPrompt: 'selva', costTier: 'paid', estimateUsd: 1.2, options: { format: '9:16', durationSeconds: 8 } }, { license_status: 'generated', asset_type: 'video', source_url: null }))
    expect(d.params).toContain('formato 9:16')
    expect(d.cost).toContain('estimado $1.200')
    expect(originOf(asset({}, { source_provider: 'browser-render' }))).toBe('render')
  })
})

describe('free media banks', () => {
  it('maps Freesound licenses to asset license states', () => {
    expect(freesoundLicense('Creative Commons 0').licenseStatus).toBe('public_domain')
    expect(freesoundLicense('http://creativecommons.org/licenses/by-nc/4.0/').licenseStatus).toBe('restricted')
    expect(freesoundLicense('Attribution').licenseStatus).toBe('licensed')
  })
  it('only downloads from the bank’s own hosts', () => {
    expect(allowedDownload('pixabay', 'https://cdn.pixabay.com/photo/x.jpg')).toBe(true)
    expect(allowedDownload('pixabay', 'https://evil.com/pixabay.com.jpg')).toBe(false)
    expect(allowedDownload('pexels', 'https://videos.pexels.com/video-files/1/1-hd.mp4')).toBe(true)
    expect(allowedDownload('pexels', 'https://images.pexels.com/photos/1/a.jpeg')).toBe(true)
    expect(allowedDownload('pexels', 'https://player.vimeo.com/external/123.hd.mp4?s=x&profile_id=175')).toBe(true)
    expect(allowedDownload('pexels', 'https://player.vimeo.com/video/123')).toBe(false)
    expect(allowedDownload('pixabay', 'https://player.vimeo.com/external/123.hd.mp4')).toBe(false)
    expect(allowedDownload('pexels', 'https://user:pw@videos.pexels.com/x.mp4')).toBe(false)
    expect(allowedDownload('freesound', 'https://cdn.freesound.org/previews/1/1_1-hq.mp3')).toBe(true)
    expect(allowedDownload('freesound', 'http://cdn.freesound.org/a.mp3')).toBe(false)
  })
})

describe('adapters', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  const ctx = { ownerId: 'u', projectId: 'p', requestId: 'r' }
  it('Cloudflare image returns base64 JSON as a data URI', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acc'); vi.stubEnv('CLOUDFLARE_API_TOKEN', 'tok')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { image: 'QUJD' }, success: true }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const m = modelById('cloudflare:@cf/black-forest-labs/flux-1-schnell')!
    const r = await startGeneration({ model: m, prompt: 'p', finalPrompt: 'p', options: {}, context: ctx })
    expect(r.kind).toBe('assets')
    if (r.kind === 'assets') expect(r.assets[0].uri).toBe('data:image/jpeg;base64,QUJD')
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/accounts/acc/ai/run/@cf/black-forest-labs/flux-1-schnell')
  })
  it('Veo submits a long-running job and polls it to a downloaded video', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url); calls.push(u)
      // Live check 2026-10-10: Gemini rejects a string durationSeconds with INVALID_ARGUMENT, so it must be a JSON number.
      if (u.endsWith(':predictLongRunning')) { expect(typeof JSON.parse(String(init?.body)).parameters.durationSeconds).toBe('number'); expect(JSON.parse(String(init?.body)).parameters).toMatchObject({ aspectRatio: '9:16', durationSeconds: 6, personGeneration: 'allow_adult' }); return Response.json({ name: 'models/veo-3.1-fast-generate-preview/operations/op123' }) }
      if (u.endsWith('/operations/op123')) return Response.json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/v:download' } }] } } })
      return new Response(new Uint8Array([1, 2, 3]))
    }))
    const m = modelById('gemini:veo-3.1-fast-generate-preview')!
    const start = await startGeneration({ model: m, prompt: 'p', finalPrompt: 'p', options: { format: '9:16', durationSeconds: 6 }, context: ctx })
    expect(start.kind).toBe('job')
    if (start.kind !== 'job') return
    const done = await pollGeneration(m, start.job)
    expect(done.state).toBe('done')
    if (done.state === 'done') { expect(done.media[0].uri).toBe('data:video/mp4;base64,AQID'); expect(done.media[0].externalId).toBe('op123#0') }
  })
  it('ElevenLabs ambience asks for a loop and records the credits charged', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'k')
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ loop: true, model_id: 'eleven_text_to_sound_v2', duration_seconds: 20 })
      return new Response(new Uint8Array([9, 9]), { headers: { 'character-cost': '80' } })
    }))
    const r = await startGeneration({ model: modelById('elevenlabs:sound-generation-loop')!, prompt: 'selva', finalPrompt: 'selva', options: {}, context: ctx })
    if (r.kind === 'assets') expect(r.assets[0].metadata?.credits).toEqual({ credits: 80, unit: 'elevenlabs_credits', reported: true })
  })
})
