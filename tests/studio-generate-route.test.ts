import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Rows = Record<string, unknown[]>
const state: { user: { id: string } | null; rows: Rows; eqs: Array<[string, string, unknown]>; persisted: unknown[] } = { user: { id: 'u1' }, rows: {}, eqs: [], persisted: [] }

function fakeDb() {
  const table = (name: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'limit', 'gte', 'not', 'in', 'neq', 'or']) b[m] = () => b
    b.eq = (col: string, val: unknown) => { state.eqs.push([name, col, val]); return b }
    b.maybeSingle = async () => ({ data: (state.rows[name] ?? [])[0] ?? null, error: null })
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: state.rows[name] ?? [], error: null }).then(res, rej)
    return b
  }
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: table,
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array(2000)], { type: 'image/png' }), error: null }) }) },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => fakeDb() }))
vi.mock('@/lib/providers/persist', () => ({ persistGeneratedAsset: async (_c: unknown, kind: string, asset: { metadata?: Record<string, unknown> }) => { state.persisted.push({ kind, asset }); return { id: 'asset1', asset_type: kind } } }))

const OWNER = 'u1'
const UUID = '11111111-1111-4111-8111-111111111111'
const post = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/studio/generate/route')
  const res = await POST(new Request('http://x/api/studio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: res.status, json: await res.json() as Record<string, any> }
}
const base = { projectId: 'p1', prompt: 'a lighthouse at dawn', options: { format: '16:9' }, preset: 'photorealistic' }
const KLEIN = 'cloudflare:@cf/black-forest-labs/flux-2-klein-4b'
const usedNeurons = (units: number) => ({ created_at: new Date().toISOString(), provenance: { allowancePool: 'cloudflare-neurons', allowanceUnits: units } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  state.user = { id: OWNER }; state.eqs = []; state.persisted = []
  state.rows = { projects: [{ id: 'p1' }], assets: [] }
  for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'FAL_KEY', 'GEMINI_API_KEY', 'TOKEN_ENCRYPTION_KEY', 'DASHSCOPE_PROMO_START']) delete process.env[k]
  Object.assign(process.env, { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') })
  fetchMock = vi.fn(async () => Response.json({ result: { image: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64') } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('POST /api/studio/generate: nothing is spent without authorization', () => {
  it('requires a session', async () => {
    state.user = null
    expect((await post({ ...base, modelId: KLEIN })).status).toBe(401)
  })

  it('a paid model is refused without the confirmed estimate, and nothing is sent to the provider', async () => {
    process.env.OPENAI_API_KEY = 'k'
    const r = await post({ ...base, modelId: 'openai:gpt-image-2' })
    expect(r.status).toBe(409)
    expect(r.json.error).toMatch(/confirmar el coste/)
    expect(fetchMock).not.toHaveBeenCalled()
    // A confirmation lower than the estimate is also refused.
    expect((await post({ ...base, modelId: 'openai:gpt-image-2', confirmedEstimateUsd: 0.001 })).status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a free generation inside the daily allowance goes through and records what it used from the pool', async () => {
    state.rows.assets = [usedNeurons(500)]
    const r = await post({ ...base, modelId: KLEIN })
    expect(r.status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const meta = (state.persisted[0] as { asset: { metadata: Record<string, unknown> } }).asset.metadata
    expect(meta).toMatchObject({ allowancePool: 'cloudflare-neurons', evidence: 'documented', costTier: 'free' })
    expect(Number(meta.allowanceUnits)).toBeGreaterThan(90)
  })

  it('when the daily allowance cannot cover the image it is NOT sent; free alternatives are suggested, never a paid switch', async () => {
    state.rows.assets = [usedNeurons(9990)]
    const r = await post({ ...base, modelId: KLEIN, needsCommercial: true })
    expect(r.status).toBe(409)
    expect(r.json.exhausted).toBe(true)
    expect(r.json.error).toMatch(/Cupo gratuito agotado/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.persisted).toHaveLength(0)
    const rec = r.json.recommendation
    expect(rec.message).toMatch(/No se cambia nada sin que lo elijas|No queda ninguna alternativa gratuita/)
    // Whatever is offered as free really is free-tier, and paid ones are listed apart and flagged.
    for (const f of rec.free) expect(f.id).not.toMatch(/^(openai|fal):/)
    for (const p of rec.paid) expect(p.requiresAuthorization).toBe(true)
  })

  it('the Alibaba promo is not sent once its local counter shows the 50 s are used (avoids automatic billing)', async () => {
    process.env.DASHSCOPE_API_KEY = 'dk'
    state.rows.assets = [{ created_at: new Date().toISOString(), provenance: { allowancePool: 'alibaba-wan-promo', allowanceUnits: 50 } }]
    const r = await post({ projectId: 'p1', prompt: 'a river', modelId: 'alibaba:wan2.2-t2v-plus', options: { format: '16:9' }, confirmedEstimateUsd: 0 })
    expect(r.status).toBe(409)
    expect(r.json.exhausted).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a provider 429 produces a free-only recommendation and no automatic retry or switch', async () => {
    fetchMock.mockImplementation(async () => Response.json({ errors: [{ code: 3036 }] }, { status: 429 }))
    const r = await post({ ...base, modelId: KLEIN })
    expect(r.status).toBe(502)
    expect(r.json.providerStatus).toBe(429)
    expect(r.json.error).toMatch(/límite de uso|cupo gratuito/)
    expect(r.json.recommendation).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const f of r.json.recommendation.free) expect(f.id).not.toMatch(/^(openai|fal|gemini):.*(pro|gpt)/)
  })
})

describe('reference images', () => {
  it('refuses a set of references whose total size is excessive', async () => {
    const ids = [1, 2, 3, 4].map(i => `1111111${i}-1111-4111-8111-111111111111`)
    state.rows.assets = ids.map(id => ({ id, asset_type: 'image', storage_path: `${OWNER}/p1/${id}.png`, project_id: 'p1', provenance: { mimeType: 'image/png' } }))
    const dbModule = await import('@/lib/storage/server')
    vi.spyOn(dbModule, 'downloadObject').mockResolvedValue({ size: 11 * 1024 * 1024, type: 'image/png', arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Blob)
    const r = await post({ ...base, modelId: KLEIN, referenceAssetIds: ids })
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/superan 40 MB/)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('are refused for a model that cannot use them', async () => {
    process.env.FAL_KEY = 'f'
    const r = await post({ ...base, modelId: 'fal:fal-ai/flux-2-pro', confirmedEstimateUsd: 1, referenceAssetIds: [UUID] })
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/no admite imágenes de referencia/)
  })

  it('only the caller\'s own image assets of the same project are looked up; an unknown one is refused', async () => {
    state.rows.assets = []
    const r = await post({ ...base, modelId: KLEIN, referenceAssetIds: [UUID] })
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/no existe en este proyecto/)
    const refQuery = state.eqs.filter(([t]) => t === 'assets')
    expect(refQuery.some(([, c, v]) => c === 'owner_id' && v === OWNER)).toBe(true)
    expect(refQuery.some(([, c, v]) => c === 'project_id' && v === 'p1')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reaches Cloudflare as multipart with the reference and records the ids in provenance', async () => {
    state.rows.assets = [{ id: UUID, asset_type: 'image', storage_path: `${OWNER}/p1/ref.png`, project_id: 'p1', provenance: { mimeType: 'image/png' } }]
    // sharp needs a real image to shrink.
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#335577' } }).png().toBuffer()
    vi.stubGlobal('fetch', fetchMock)
    const dbModule = await import('@/lib/storage/server')
    vi.spyOn(dbModule, 'downloadObject').mockResolvedValue(new Blob([new Uint8Array(png)], { type: 'image/png' }))
    const r = await post({ ...base, modelId: KLEIN, referenceAssetIds: [UUID], identity: 'Marta, 40s, short grey hair' })
    expect(r.status).toBe(201)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('input_image_0')).toBeInstanceOf(Blob)
    const sent = (init.body as FormData).get('prompt') as string
    expect(sent).toMatch(/Marta, 40s, short grey hair/)
    expect(sent).toMatch(/identity reference/)
    const meta = (state.persisted[0] as { asset: { metadata: Record<string, unknown> } }).asset.metadata
    expect(meta.references).toEqual([UUID])
    expect(Number(meta.allowanceUnits)).toBeGreaterThan(95) // output tiles + one reference tile
  })
})
