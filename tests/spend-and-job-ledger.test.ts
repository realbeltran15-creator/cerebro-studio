import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { capViolation, DEFAULT_CAPS, spendCaps, spendStatus } from '@/lib/providers/spend'
import { JOB_TTL_MS, prune, type LedgerJob } from '@/lib/providers/job-ledger'

const NOW = new Date('2026-10-17T15:00:00Z')
const paid = (usd: number, at: string) => ({ id: at, asset_type: 'image', project_id: 'p', source_provider: 'x', license_status: 'generated', provenance: { catalogModel: 'm', costTier: 'paid', estimateUsd: usd }, created_at: at })

describe('spending caps', () => {
  it('reads caps from the environment with safe defaults; 0 disables paid generations', () => {
    expect(spendCaps({})).toEqual(DEFAULT_CAPS)
    expect(spendCaps({ GENERATION_DAILY_CAP_USD: '2', GENERATION_MONTHLY_CAP_USD: '10' })).toEqual({ dailyUsd: 2, monthlyUsd: 10 })
    expect(spendCaps({ GENERATION_DAILY_CAP_USD: 'abc', GENERATION_MONTHLY_CAP_USD: '-1' })).toEqual(DEFAULT_CAPS)
    const off = spendStatus([], [], { dailyUsd: 0, monthlyUsd: 25 }, NOW)
    expect(capViolation(off, 0.05)).toMatch(/desactivadas/)
    expect(capViolation(off, 0)).toBeNull()   // free models are never blocked by the cash cap
  })
  it('counts paid estimates of today and this month plus pending queued jobs; ignores free, credits and other months', () => {
    const assets = [paid(1, '2026-10-17T10:00:00Z'), paid(2, '2026-10-02T10:00:00Z'), paid(9, '2026-09-30T23:00:00Z'),
      { ...paid(5, '2026-10-17T11:00:00Z'), provenance: { catalogModel: 'm', costTier: 'credits', estimateUsd: 5 } },
      { ...paid(5, '2026-10-17T11:00:00Z'), provenance: { catalogModel: 'm', costTier: 'free', estimateUsd: 0 } }]
    const s = spendStatus(assets, [{ createdAt: '2026-10-17T14:00:00Z', estimateUsd: 1.2, tier: 'paid' }, { createdAt: '2026-10-17T14:00:00Z', estimateUsd: 3, tier: 'credits' }], { dailyUsd: 3, monthlyUsd: 5 }, NOW)
    expect(s.todayUsd).toBeCloseTo(2.2)
    expect(s.monthUsd).toBeCloseTo(4.2)
    expect(capViolation(s, 0.5)).toBeNull()
    expect(capViolation(s, 1.2)).toMatch(/Tope diario/)
    expect(capViolation({ ...s, caps: { dailyUsd: 100, monthlyUsd: 5 } }, 1)).toMatch(/Tope mensual/)
  })
})

describe('job ledger pruning', () => {
  const job = (over: Partial<LedgerJob>): LedgerJob => ({ id: 'j', token: 't', modelId: 'm', label: 'M', modality: 'video', prompt: 'p', projectId: 'p', estimateUsd: 1, tier: 'paid', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), state: 'pending', ...over })
  it('expires pending jobs older than the token lifetime and drops finished ones after 7 days', () => {
    const old = new Date(NOW.getTime() - JOB_TTL_MS - 1000).toISOString()
    const out = prune([job({ id: 'a' }), job({ id: 'b', createdAt: old, updatedAt: old }), job({ id: 'c', state: 'done', updatedAt: new Date(NOW.getTime() - 8 * 86400e3).toISOString() })], NOW.getTime())
    expect(out.map(j => [j.id, j.state])).toEqual([['a', 'pending'], ['b', 'expired']])
  })
})

// ---------- Route: the cap is enforced on the server before the provider is called ----------
const db: { assets: unknown[]; config: unknown; inserted: unknown[]; updated: unknown[] } = { assets: [], config: null, inserted: [], updated: [] }
function fakeDb() {
  const table = (name: string) => {
    const b: Record<string, any> = {}
    for (const m of ['select', 'order', 'limit', 'gte', 'eq', 'not', 'in', 'neq', 'or']) b[m] = () => b
    b.maybeSingle = async () => ({ data: name === 'projects' ? { id: 'p1' } : name === 'connector_configs' ? db.config : null, error: null })
    b.insert = (row: unknown) => { db.inserted.push(row); return { then: (r: any) => Promise.resolve({ error: null }).then(r) } }
    b.update = (row: unknown) => { db.updated.push(row); const u: Record<string, any> = {}; for (const m of ['eq']) u[m] = () => u; u.select = async () => ({ data: [{ owner_id: 'u1' }], error: null }); return u }
    b.then = (res: any, rej?: any) => Promise.resolve({ data: name === 'assets' ? db.assets : [], error: null }).then(res, rej)
    return b
  }
  return { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: table }
}
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => fakeDb() }))
vi.mock('@/lib/providers/persist', () => ({ persistGeneratedAsset: async () => ({ id: 'asset1' }) }))

describe('POST /api/studio/generate: server-side spending cap and job recording', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    db.assets = []; db.config = null; db.inserted = []; db.updated = []
    Object.assign(process.env, { FAL_KEY: 'k', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'), GENERATION_DAILY_CAP_USD: '1', GENERATION_MONTHLY_CAP_USD: '10' })
    fetchMock = vi.fn(async () => Response.json({ request_id: 'req-1', status_url: 'https://queue.fal.run/x/requests/req-1/status', response_url: 'https://queue.fal.run/x/requests/req-1' }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GENERATION_DAILY_CAP_USD; delete process.env.GENERATION_MONTHLY_CAP_USD })
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/studio/generate/route')
    const res = await POST(new Request('http://x/api/studio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    return { status: res.status, json: await res.json() as Record<string, any> }
  }
  const KLING = 'fal:fal-ai/kling-video/v2.5-turbo/pro/text-to-video'

  it('refuses a confirmed paid generation that would exceed today\'s cap, without calling the provider', async () => {
    db.assets = [paid(0.9, new Date().toISOString())]
    const r = await post({ projectId: 'p1', modelId: KLING, prompt: 'a slow pan over a jungle', options: { durationSeconds: 5 }, confirmedEstimateUsd: 10 })
    expect(r.status).toBe(402)
    expect(r.json.error).toMatch(/Tope diario/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a queued paid job inside the cap is recorded on the server so it can be recovered', async () => {
    const r = await post({ projectId: 'p1', modelId: KLING, prompt: 'a slow pan over a jungle', options: { durationSeconds: 5 }, confirmedEstimateUsd: 10 })
    expect(r.status).toBe(202)
    expect(r.json.job.recoverable).toBe(true)
    const row = db.inserted[0] as { provider: string; capability: string; config: { jobs: Array<{ state: string; token: string; tier: string }> } }
    expect(row).toMatchObject({ provider: 'cerebro-studio', capability: 'generation_jobs' })
    expect(row.config.jobs[0]).toMatchObject({ state: 'pending', tier: 'paid', token: r.json.job.token })
  })
})
