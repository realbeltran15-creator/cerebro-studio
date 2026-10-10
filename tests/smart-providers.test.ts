import { describe, expect, it } from 'vitest'
import { catalog, evidenceOf, imageDimensions, modelById, POOLS, type CatalogModel } from '@/lib/providers/catalog'
import { fits, poolStatus, promoStartFor, statusLabel, windowFor } from '@/lib/providers/allowance'
import { buildAvailability } from '@/lib/providers/availability'
import { pickModel, rankModels, recommendAlternatives, type Availability } from '@/lib/providers/router'
import { providers } from '@/lib/providers/directory'

const ready = (over: Record<string, Partial<Availability>> = {}): Record<string, Availability> =>
  Object.fromEntries(catalog.map(m => [m.id, { ready: true, ...over[m.id] }]))
const KLEIN4 = 'cloudflare:@cf/black-forest-labs/flux-2-klein-4b'

describe('catalogue invariants (nothing is presented as better known than it is)', () => {
  it('has unique ids and a configured env for every model', () => {
    const ids = catalog.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(catalog.every(m => m.env.length > 0)).toBe(true)
  })
  it('a model with an allowance estimate always names its pool, and pool models are not paid-tier', () => {
    for (const m of catalog) {
      if (m.allowanceUnits) expect(m.allowance, m.id).toBeDefined()
      if (m.allowance) expect(m.tier === 'paid', m.id).toBe(false)
    }
  })
  it('integrations that were never run against the real service are marked unverified', () => {
    for (const id of ['alibaba:wan2.2-t2v-plus', 'topmediai:text2speech', 'cloudflare:@cf/black-forest-labs/flux-2-klein-9b']) expect(evidenceOf(modelById(id)!), id).toBe('unverified')
  })
  it('every model that takes reference images says so as a capability', () => {
    for (const m of catalog.filter(x => x.references)) expect(m.capabilities, m.id).toContain('reference_images')
  })
  it('unverified models also require explicit confirmation or a manual choice (never automatic)', () => {
    const picked = pickModel(catalog, { modality: 'video', strategy: 'best_value', minQuality: 1 }, ready())
    expect(picked === null || evidenceOf(picked.model) !== 'unverified').toBe(true)
  })
  it('every researched provider states whether a free API exists and when it was checked', () => {
    for (const p of providers.filter(x => x.integrated !== undefined)) expect(p.freeApi, p.id).toBeDefined()
    expect(providers.find(p => p.id === 'gemini')!.allowance).toMatch(/NO tienen nivel gratuito/)
    expect(providers.find(p => p.id === 'kling')!.allowance).toMatch(/web.*NO dan acceso a la API/s)
    expect(providers.find(p => p.id === 'topmediai')!.allowance).toMatch(/aparte|APARTE/)
  })
})

describe('free allowances: daily, monthly and promotional are different things', () => {
  const day = (iso: string) => new Date(iso)
  const asset = (at: string, pool: string, units: number) => ({ created_at: at, provenance: { allowancePool: pool, allowanceUnits: units } })

  it('daily pools reset at 00:00 UTC', () => {
    const now = day('2026-10-10T15:00:00Z')
    const used = [asset('2026-10-10T01:00:00Z', 'cloudflare-neurons', 4000), asset('2026-10-09T23:59:00Z', 'cloudflare-neurons', 9000)]
    const s = poolStatus(POOLS.cloudflare, used, now)
    expect(s.used).toBe(4000)
    expect(s.remaining).toBe(6000)
    expect(s.endsAt).toBe('2026-10-11T00:00:00.000Z')
    expect(poolStatus(POOLS.cloudflare, used, day('2026-10-11T00:00:01Z')).used).toBe(0)
  })
  it('monthly pools reset on the first of the month', () => {
    const monthly = { pool: 'm', kind: 'monthly', amount: 100, unit: 'usd', note: '' } as const
    expect(poolStatus(monthly, [asset('2026-09-30T23:00:00Z', 'm', 60), asset('2026-10-02T00:00:00Z', 'm', 30)], day('2026-10-20T00:00:00Z')).remaining).toBe(70)
  })
  it('a promo grant does not renew and expires validDays after activation', () => {
    const start = day('2026-08-01T00:00:00Z')
    const used = [asset('2026-08-05T00:00:00Z', 'alibaba-wan-promo', 15)]
    expect(poolStatus(POOLS.alibabaWan, used, day('2026-09-01T00:00:00Z'), start).remaining).toBe(35)
    const later = poolStatus(POOLS.alibabaWan, used, day('2026-11-15T00:00:00Z'), start)
    expect(later.expired).toBe(true)
    expect(later.exhausted).toBe(true)
    expect(statusLabel(later)).toMatch(/caducado/)
  })
  it('without an activation date a promo pool counts everything and never claims an expiry', () => {
    const s = poolStatus(POOLS.alibabaWan, [asset('2026-01-01T00:00:00Z', 'alibaba-wan-promo', 50)], day('2026-10-10T00:00:00Z'), null)
    expect(s.endsAt).toBeNull()
    expect(s.exhausted).toBe(true)
  })
  it('ignores other pools, malformed rows and counts only what Cerebro recorded', () => {
    const s = poolStatus(POOLS.cloudflare, [asset('2026-10-10T01:00:00Z', 'other', 99999), { created_at: 'nope', provenance: { allowancePool: 'cloudflare-neurons', allowanceUnits: 5 } }, { created_at: '2026-10-10T02:00:00Z', provenance: null }], day('2026-10-10T12:00:00Z'))
    expect(s.used).toBe(0)
  })
  it('fits() lets unknown or zero-unit generations through and blocks only a real shortfall', () => {
    const s = poolStatus(POOLS.cloudflare, [asset('2026-10-10T01:00:00Z', 'cloudflare-neurons', 9950)], day('2026-10-10T12:00:00Z'))
    expect(fits(s, 40)).toBe(true)
    expect(fits(s, 104)).toBe(false)
    expect(fits(undefined, 9999)).toBe(true)
    expect(fits(s, 0)).toBe(true)
  })
  it('reads the promo activation date from env and ignores garbage', () => {
    expect(promoStartFor('alibaba-wan-promo', { DASHSCOPE_PROMO_START: '2026-08-01' })?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(promoStartFor('alibaba-wan-promo', { DASHSCOPE_PROMO_START: 'ayer' })).toBeNull()
    expect(windowFor(POOLS.cloudflare, day('2026-10-10T12:00:00Z')).start?.toISOString()).toBe('2026-10-10T00:00:00.000Z')
  })
  it('Cloudflare klein 4B costs about 100 neurons per image: roughly 96 free images a day', () => {
    const units = modelById(KLEIN4)!.allowanceUnits!({ format: '16:9' })
    expect(units).toBeGreaterThan(90)
    expect(units).toBeLessThan(120)
    expect(Math.floor(10000 / units)).toBeGreaterThan(80)
    expect(modelById(KLEIN4)!.allowanceUnits!({ format: '16:9', references: 2 })).toBeCloseTo(units + 2 * 5.37, 1)
  })
})

describe('routing by quality, credits, cost, speed, resolution and rights', () => {
  it('free mode picks Cloudflare klein and never a paid model', () => {
    const r = pickModel(catalog, { modality: 'image', strategy: 'free_only', minQuality: 3 }, ready())!
    expect(r.model.id).toBe(KLEIN4)
    expect(r.estimateUsd).toBe(0)
  })
  it('max quality picks a tested/documented top model and shows the cost, never the free draft model', () => {
    const r = pickModel(catalog, { modality: 'image', strategy: 'best_quality' }, ready())!
    expect(r.model.quality).toBe(5)
    expect(r.model.tier).toBe('paid')
    expect(r.estimateUsd).toBeGreaterThan(0)
  })
  it('excludes models that cannot take the requested number of reference images', () => {
    const r = rankModels(catalog, { modality: 'image', strategy: 'best_value', references: 6, minQuality: 1 }, ready())
    expect(r.find(x => x.model.id === KLEIN4)!.reasons.join()).toMatch(/4 imágenes de referencia/)
    expect(r.find(x => x.model.id === 'fal:fal-ai/flux-2-pro')!.reasons.join()).toMatch(/No admite imágenes de referencia/)
    expect(r.filter(x => x.eligible).every(x => (x.model.references?.max ?? 0) >= 6)).toBe(true)
  })
  it('filters by resolution', () => {
    const r = rankModels(catalog, { modality: 'video', strategy: 'best_quality', minShortSidePx: 1080 }, ready())
    expect(r.find(x => x.model.id === 'gemini:veo-3.1-fast-generate-preview')!.eligible).toBe(false)
    expect(r.find(x => x.model.id === 'gemini:veo-3.1-generate-preview')!.eligible).toBe(true)
  })
  it('flags plan-dependent commercial rights instead of hiding them', () => {
    const r = rankModels(catalog, { modality: 'voice', strategy: 'best_value', needsCommercial: true, providers: ['topmediai'], minQuality: 1 }, ready())
    const top = r.find(x => x.model.id === 'topmediai:text2speech')!
    expect(top.eligible).toBe(true)
    expect(top.warnings.join(' ')).toMatch(/plan/i)
    expect(top.warnings.join(' ')).toMatch(/no está confirmada|sin verificar/i)
  })
  it('excludes a model whose output is non-commercial when commercial use is needed', () => {
    const nc: CatalogModel = { ...modelById(KLEIN4)!, id: 'x:nc', rights: 'non_commercial' }
    const r = rankModels([nc], { modality: 'image', strategy: 'free_only', needsCommercial: true }, { 'x:nc': { ready: true } })
    expect(r[0].eligible).toBe(false)
    expect(r[0].reasons.join()).toMatch(/no es de uso comercial/)
  })
  it('does not pick an unverified integration automatically, but allows it when the provider is chosen by hand', () => {
    const auto = rankModels(catalog, { modality: 'voice', strategy: 'free_only', minQuality: 1 }, ready()).find(x => x.model.id === 'topmediai:text2speech')!
    expect(auto.eligible).toBe(false)
    const manual = rankModels(catalog, { modality: 'voice', strategy: 'free_only', providers: ['topmediai'], minQuality: 1 }, ready()).find(x => x.model.id === 'topmediai:text2speech')!
    expect(manual.eligible).toBe(true)
  })
  it('prefers a tested model over a merely documented one at equal quality and cost', () => {
    const tested: CatalogModel = { ...modelById('openai:gpt-image-1.5')!, id: 'x:a', evidence: 'tested' }
    const doc: CatalogModel = { ...modelById('openai:gpt-image-1.5')!, id: 'x:b', evidence: 'documented' }
    const r = rankModels([doc, tested], { modality: 'image', strategy: 'best_quality', minQuality: 1 }, { 'x:a': { ready: true }, 'x:b': { ready: true } })
    expect(r[0].model.id).toBe('x:a')
  })
})

describe('when a free provider runs out, recommend another free one — never switch to paid', () => {
  const exhausted = (): Record<string, Availability> => ready(Object.fromEntries(catalog.filter(m => m.provider === 'cloudflare').map(m => [m.id, { remaining: 20 }])))

  it('marks the model as exhausted (not merely unavailable) when the allowance cannot cover the generation', () => {
    const r = rankModels(catalog, { modality: 'image', strategy: 'free_only', format: '16:9' }, exhausted()).find(x => x.model.id === KLEIN4)!
    expect(r.eligible).toBe(false)
    expect(r.exhausted).toBe(true)
    expect(r.reasons[0]).toMatch(/Cupo gratuito agotado/)
  })
  it('recommends free alternatives only; paid options are listed apart and need authorization', () => {
    const rec = recommendAlternatives(catalog, { modality: 'image', strategy: 'free_only', format: '16:9', minQuality: 3 }, exhausted(), KLEIN4)
    expect(rec.free.every(x => ['free', 'local', 'credits', 'freemium'].includes(x.model.tier))).toBe(true)
    expect(rec.paid.length).toBeGreaterThan(0)
    expect(rec.paid.every(x => x.model.tier === 'paid')).toBe(true)
    expect(rec.message).toMatch(/No se cambia nada sin que lo elijas|No queda ninguna alternativa gratuita/)
  })
  it('says plainly when no free alternative exists and still does not pick a paid one', () => {
    const rec = recommendAlternatives(catalog, { modality: 'video', strategy: 'free_only' }, ready(), 'alibaba:wan2.2-t2v-plus')
    expect(rec.free).toHaveLength(0)
    expect(rec.message).toMatch(/No queda ninguna alternativa gratuita compatible/)
    expect(rec.message).toMatch(/autorización/)
  })
  it('a different free provider with a fitting allowance is offered when Cloudflare is out', () => {
    const only: CatalogModel = { ...modelById('elevenlabs:eleven_multilingual_v2')!, id: 'x:free-voice', tier: 'free' }
    const rec = recommendAlternatives([only, modelById('cloudflare:@cf/myshell-ai/melotts')!], { modality: 'voice', strategy: 'free_only', minQuality: 1 }, { 'x:free-voice': { ready: true }, 'cloudflare:@cf/myshell-ai/melotts': { ready: true, creditsExhausted: true } }, 'cloudflare:@cf/myshell-ai/melotts')
    expect(rec.free[0].model.id).toBe('x:free-voice')
  })
  it('buildAvailability carries the remaining allowance of each pool to its models', () => {
    const av = buildAvailability(catalog, { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, { 'cloudflare-neurons': poolStatus(POOLS.cloudflare, [{ created_at: '2026-10-10T01:00:00Z', provenance: { allowancePool: 'cloudflare-neurons', allowanceUnits: 9900 } }], new Date('2026-10-10T12:00:00Z')) }, { jobsReady: false })
    expect(av[KLEIN4]).toMatchObject({ ready: true, remaining: 100 })
    expect(av['openai:gpt-image-2'].ready).toBe(false)
  })
  it('image dimensions stay inside Cloudflare limits and multiples of 16', () => {
    for (const d of Object.values(imageDimensions)) { expect(d.width % 16).toBe(0); expect(d.height % 16).toBe(0); expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(1920); expect(Math.min(d.width, d.height)).toBeGreaterThanOrEqual(256) }
  })
})
