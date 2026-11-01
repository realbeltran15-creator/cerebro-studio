import { describe, expect, it } from 'vitest'
import { handleQueueRequest, sameOrigin, type ApiDeps, type ApiRequest } from '@/lib/queue/api'
import { PRODUCTION_PROJECT_REF, resolveQueueConfig } from '@/lib/queue/config'
import { createMemoryStore } from '@/lib/queue/memory-store'

const REF = 'abcdefghijklmnopqrst'
const goodEnv = { QUEUE_ENABLED: 'true', QUEUE_ENVIRONMENT: 'test', QUEUE_TEST_PROJECT_REF: REF, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` }
const A = { id: 'a-user' }, B = { id: 'b-user' }
const PROJ = '11111111-1111-4111-8111-111111111111'

function deps(over: Partial<ApiDeps> = {}) {
  const store = createMemoryStore()
  return { store, d: { config: resolveQueueConfig(goodEnv), store, rateLimit: () => ({ allowed: true, retryAfterS: 0 }), ...over } as ApiDeps }
}
const req = (r: Partial<ApiRequest>): ApiRequest => ({ action: 'enqueue', method: 'POST', origin: 'https://app.test', host: 'app.test', user: A, ...r })
const enq = (body: unknown, r: Partial<ApiRequest> = {}) => req({ body, ...r })
const ok = { kind: 'video_production', idempotencyKey: 'key-12345678', projectId: PROJ, payload: { t: 1 } }

describe('config de la cola', () => {
  it('apagada por defecto y ante cualquier duda', () => {
    expect(resolveQueueConfig({}).enabled).toBe(false)
    expect(resolveQueueConfig({ ...goodEnv, QUEUE_ENABLED: 'yes' }).enabled).toBe(false)
    expect(resolveQueueConfig({ ...goodEnv, QUEUE_ENVIRONMENT: 'production' }).enabled).toBe(false)
    expect(resolveQueueConfig({ ...goodEnv, QUEUE_KILL_SWITCH: 'true' }).enabled).toBe(false)
    expect(resolveQueueConfig({ ...goodEnv, QUEUE_TEST_PROJECT_REF: undefined }).enabled).toBe(false)
  })
  it('rechaza Production por ref, URL y VERCEL_ENV', () => {
    expect(resolveQueueConfig({ ...goodEnv, QUEUE_TEST_PROJECT_REF: PRODUCTION_PROJECT_REF, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }).enabled).toBe(false)
    expect(resolveQueueConfig({ ...goodEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }).enabled).toBe(false)
    expect(resolveQueueConfig({ ...goodEnv, NEXT_PUBLIC_SUPABASE_URL: `https://other${REF.slice(5)}.supabase.co` }).enabled).toBe(false)
    expect(resolveQueueConfig({ ...goodEnv, VERCEL_ENV: 'production' }).enabled).toBe(false)
  })
  it('no existe modo real', () => {
    expect(resolveQueueConfig({ ...goodEnv, QUEUE_ALLOW_LIVE: 'true' }).enabled).toBe(false)
    expect(resolveQueueConfig({ ...goodEnv, QUEUE_DRY_RUN: 'false' }).enabled).toBe(false)
  })
  it('configuracion valida de pruebas', () => {
    const c = resolveQueueConfig(goodEnv)
    expect(c.enabled && c.dryRunOnly).toBe(true)
    expect(resolveQueueConfig({ ...goodEnv, VERCEL_ENV: 'preview' }).enabled).toBe(true)
  })
})

describe('API de cola', () => {
  it('desactivada -> 404 aunque haya usuario', async () => {
    const { d } = deps({ config: resolveQueueConfig({}) })
    expect((await handleQueueRequest(enq(ok), d)).status).toBe(404)
  })
  it('sin sesion -> 401', async () => {
    const { d } = deps()
    expect((await handleQueueRequest(enq(ok, { user: null }), d)).status).toBe(401)
  })
  it('CSRF: sin Origin o de otro sitio -> 403; GET no lo exige', async () => {
    const { d } = deps()
    expect((await handleQueueRequest(enq(ok, { origin: null }), d)).status).toBe(403)
    expect((await handleQueueRequest(enq(ok, { origin: 'https://evil.test' }), d)).status).toBe(403)
    expect(sameOrigin('https://app.test', 'app.test')).toBe(true)
    expect(sameOrigin('not a url', 'app.test')).toBe(false)
  })
  it('encola siempre en dry_run, aunque el cliente pida lo contrario', async () => {
    const { d, store } = deps()
    const r = await handleQueueRequest(enq(ok), d)
    expect(r.status).toBe(201)
    expect(store.all()[0].dryRun).toBe(true)
    expect((await handleQueueRequest(enq({ ...ok, idempotencyKey: 'key-other-1', dryRun: false }), d)).status).toBe(400)
    expect((await handleQueueRequest(enq({ ...ok, idempotencyKey: 'key-other-2', dry_run: false }), d)).status).toBe(400)
    expect(store.all().length).toBe(1)
  })
  it('doble envio (misma clave) no duplica; payload distinto -> 409', async () => {
    const { d, store } = deps()
    const a = await handleQueueRequest(enq(ok), d)
    const b = await handleQueueRequest(enq(ok), d)
    expect([a.status, b.status]).toEqual([201, 200])
    expect(store.all().length).toBe(1)
    expect((await handleQueueRequest(enq({ ...ok, payload: { t: 2 } }), d)).status).toBe(409)
    expect(store.all().length).toBe(1)
  })
  it('validacion de entradas', async () => {
    const { d } = deps()
    for (const bad of [null, { ...ok, kind: 'publish_now' }, { ...ok, idempotencyKey: 'x' }, { ...ok, projectId: 'no-uuid' }, { ...ok, payload: [1] }]) {
      expect((await handleQueueRequest(enq(bad), d)).status).toBe(400)
    }
    expect((await handleQueueRequest(enq({ ...ok, payload: { big: 'x'.repeat(9000) } }), d)).status).toBe(413)
  })
  it('aislamiento: otro usuario no ve ni cancela (404, sin filtrar existencia)', async () => {
    const { d, store } = deps()
    const id = ((await handleQueueRequest(enq(ok), d)).body.job as { id: string }).id
    const get = { action: 'get' as const, method: 'GET', jobId: id }
    expect((await handleQueueRequest(req({ ...get, user: B }), d)).status).toBe(404)
    expect((await handleQueueRequest(req({ ...get, user: A }), d)).status).toBe(200)
    const cancel = { action: 'cancel' as const, method: 'POST', jobId: id }
    expect((await handleQueueRequest(req({ ...cancel, user: B }), d)).status).toBe(404)
    expect(store.all()[0].cancelRequested).toBe(false)
    expect((await handleQueueRequest(req({ ...cancel, user: A }), d)).status).toBe(202)
    expect((await handleQueueRequest(req({ ...get, jobId: 'nope', user: A }), d)).status).toBe(400)
  })
  it('limite de peticiones -> 429 con Retry-After y sin encolar', async () => {
    const { d, store } = deps({ rateLimit: () => ({ allowed: false, retryAfterS: 7 }) })
    const r = await handleQueueRequest(enq(ok), d)
    expect(r.status).toBe(429)
    expect(r.headers?.['Retry-After']).toBe('7')
    expect(store.all().length).toBe(0)
  })
  it('la respuesta publica no incluye claim_token ni executorId ni payload', async () => {
    const { d } = deps()
    const r = await handleQueueRequest(enq(ok), d)
    const s = JSON.stringify(r.body)
    expect(s).not.toMatch(/claimToken|executorId|payloadHash|ownerId/)
  })
})
