import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deployEnv, isPreviewDeploy, previewBlock } from '@/lib/security/preview-guard'
import { ROUTE_POLICY } from '@/lib/security/route-policy'

// An "authenticated session" that records every use: in Preview nothing may reach it.
const sessionCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => { sessionCalls.n++; return { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.c' } } }) }, from: () => { throw new Error('db') } } },
}))

const API = join(process.cwd(), 'app', 'api')
function routeFiles(dir = API, out: string[] = []) { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) routeFiles(p, out); else if (f === 'route.ts') out.push(p) } return out }
const keyOf = (file: string) => file.slice(API.length + 1, -'/route.ts'.length).split(sep).join('/')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const handlersOf = (src: string) => METHODS.filter(m => new RegExp(`export (async function ${m}\\b|const ${m}\\b|\\{[^}]*\\b${m}\\b[^}]*\\} from)`).test(src))

afterEach(() => vi.unstubAllEnvs())

describe('deployEnv', () => {
  it('only VERCEL_ENV decides: production, preview (and vercel dev) or local', () => {
    expect(deployEnv({ VERCEL_ENV: 'production' })).toBe('production')
    expect(deployEnv({ VERCEL_ENV: 'preview' })).toBe('preview')
    expect(deployEnv({ VERCEL_ENV: 'development' })).toBe('preview')
    expect(deployEnv({})).toBe('local')
    expect(isPreviewDeploy({ VERCEL_ENV: ' preview ' })).toBe(true)
    expect(isPreviewDeploy({ NEXT_PUBLIC_VERCEL_ENV: 'production', VERCEL_URL: 'x' })).toBe(false) // public variables are ignored
  })
  it('previewBlock answers 403 with no-store only in Preview', async () => {
    const r = previewBlock('publication', { VERCEL_ENV: 'preview' })!
    expect(r.status).toBe(403); expect(r.headers.get('cache-control')).toBe('no-store')
    expect(await r.json()).toMatchObject({ blocked: 'preview', kind: 'publication' })
    expect(previewBlock('publication', { VERCEL_ENV: 'production' })).toBeNull()
    expect(previewBlock('publication', {})).toBeNull()
  })
})

describe('policy covers every API route', () => {
  const files = routeFiles()
  it('has a decision for each of the route files and no stale entries', () => {
    const keys = files.map(keyOf).sort()
    expect(keys.filter(k => !ROUTE_POLICY[k])).toEqual([])
    expect(Object.keys(ROUTE_POLICY).filter(k => !keys.includes(k))).toEqual([])
    expect(keys.length).toBeGreaterThanOrEqual(60)
  })
  it('every blocked handler calls previewBlock with its kind as the FIRST statement', () => {
    const bad: string[] = []
    for (const f of files) {
      const pol = ROUTE_POLICY[keyOf(f)]
      if (!pol || !('blocked' in pol)) continue
      const src = readFileSync(f, 'utf8')
      for (const m of (pol.methods ?? METHODS)) {
        const sig = new RegExp(`export async function ${m}\\([^\\n]*\\{\\n  const blocked = previewBlock\\('${pol.blocked}'\\); if \\(blocked\\) return blocked\\n`)
        if (new RegExp(`export async function ${m}\\b`).test(src) && !sig.test(src)) bad.push(`${keyOf(f)} ${m}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('blocked methods are not partially guarded: a route with blocked=all methods guards every exported handler', () => {
    for (const f of files) {
      const pol = ROUTE_POLICY[keyOf(f)]; if (!pol || !('blocked' in pol) || pol.methods) continue
      const src = readFileSync(f, 'utf8'); const own = handlersOf(src).filter(m => new RegExp(`export async function ${m}\\b`).test(src))
      expect((src.match(/previewBlock\('/g) ?? []).length, keyOf(f)).toBe(own.length)
    }
  })
  it('the read-only/low-risk routes that stay open are not hiding a service-role or paid-provider call', () => {
    const offenders: string[] = []
    for (const f of files) {
      const pol = ROUTE_POLICY[keyOf(f)]; if (!pol || !('allowed' in pol)) continue
      const src = readFileSync(f, 'utf8')
      if (/serviceRoleClient|SERVICE_ROLE|FAL_KEY|OPENAI_API_KEY|GEMINI_API_KEY|ELEVENLABS|generateContent|fal\.run|falQueue/.test(src)) offenders.push(keyOf(f))
    }
    expect(offenders).toEqual([])
  })
})

describe('sensitive routes in Preview (with an authenticated session available)', () => {
  const blocked = routeFiles().map(f => ({ key: keyOf(f), file: f, pol: ROUTE_POLICY[keyOf(f)] })).filter(r => r.pol && 'blocked' in r.pol)
  const calls: Array<{ key: string; file: string; method: string; kind: string }> = []
  for (const r of blocked) { const src = readFileSync(r.file, 'utf8'); for (const m of (('blocked' in r.pol && r.pol.methods) || METHODS)) if (new RegExp(`export async function ${m}\\b`).test(src)) calls.push({ key: r.key, file: r.file, method: m, kind: 'blocked' in r.pol ? r.pol.blocked : '' }) }

  beforeEach(() => { sessionCalls.n = 0 })
  it('lists at least 35 guarded handlers', () => expect(calls.length).toBeGreaterThanOrEqual(35))

  for (const c of calls) {
    it(`${c.method} /api/${c.key}: 403 in Preview, before auth/DB/network`, async () => {
      vi.stubEnv('VERCEL_ENV', 'preview')
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network call in Preview') })
      const mod = await import(/* @vite-ignore */ c.file) as Record<string, (r: Request, ctx: unknown) => Promise<Response>>
      const params = Promise.resolve({ id: 'x', jobId: 'x', versionId: 'x', platform: 'youtube' })
      const res = await mod[c.method](new Request('http://localhost/api/x', { method: c.method, headers: { 'content-type': 'application/json', authorization: 'Bearer anything' }, body: c.method === 'GET' || c.method === 'DELETE' ? undefined : '{"provider":"fal","confirm":"APROBAR"}' }), { params })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ blocked: 'preview', kind: c.kind })
      expect(fetchSpy).not.toHaveBeenCalled(); expect(sessionCalls.n).toBe(0)
      fetchSpy.mockRestore()
    })
    it(`${c.method} /api/${c.key}: Production is not affected by the guard`, async () => {
      vi.stubEnv('VERCEL_ENV', 'production')
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('no network in tests') })
      const mod = await import(/* @vite-ignore */ c.file) as Record<string, (r: Request, ctx: unknown) => Promise<Response>>
      const params = Promise.resolve({ id: 'x', jobId: 'x', versionId: 'x', platform: 'youtube' })
      let body: { blocked?: string } = {}
      try { const res = await mod[c.method](new Request('http://localhost/api/x', { method: c.method, headers: { 'content-type': 'application/json' }, body: c.method === 'GET' || c.method === 'DELETE' ? undefined : '{}' }), { params }); body = await res.clone().json().catch(() => ({})) } catch { /* the real handler failed for lack of config/network: it ran, which is the point */ }
      expect(body.blocked).not.toBe('preview')
      fetchSpy.mockRestore()
    })
  }
})

// Reachability: an open route must not even IMPORT (transitively) a module that talks to a paid provider, a publisher or Drive.
const NETWORK_MODULES = ['lib/providers/openai-voice', 'lib/providers/text', 'lib/providers/dashscope', 'lib/providers/elevenlabs', 'lib/providers/openai-image', 'lib/providers/gemini', 'lib/providers/fal-queue', 'lib/providers/adapters/index', 'lib/providers/check', 'lib/publication/youtube', 'lib/ingest/drive-stream', 'lib/ingest/drive-upload', 'lib/analytics/youtube']
// Open routes that import one of those only for static data or helpers, never to call out (reviewed by hand).
const REVIEWED_STATIC_IMPORTS: Record<string, string> = {}
function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8'); const out: string[] = []
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
    const spec = m[1]; let base: string | null = null
    if (spec.startsWith('@/')) base = join(process.cwd(), spec.slice(2))
    else if (spec.startsWith('.')) base = join(file, '..', spec)
    if (!base) continue
    for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) { try { if (statSync(cand).isFile()) { out.push(cand); break } } catch { /* next */ } }
  }
  return out
}
function reach(file: string, seen = new Set<string>()): Set<string> { if (seen.has(file)) return seen; seen.add(file); for (const i of importsOf(file)) reach(i, seen); return seen }

describe('open routes cannot reach network-capable provider modules', () => {
  it('no open route imports (transitively) a paid-provider, publisher or Drive module', () => {
    const offenders: Record<string, string[]> = {}
    for (const f of routeFiles()) {
      const pol = ROUTE_POLICY[keyOf(f)]; if (!pol || !('allowed' in pol)) continue
      const hits = [...reach(f)].map(p => p.slice(process.cwd().length + 1).replace(/\.tsx?$/, '').replace(/\/index$/, '/index')).filter(p => NETWORK_MODULES.includes(p) || NETWORK_MODULES.includes(p.replace(/\/index$/, '')))
      if (hits.length && !REVIEWED_STATIC_IMPORTS[keyOf(f)]) offenders[keyOf(f)] = hits
    }
    expect(offenders).toEqual({})
  })
})
