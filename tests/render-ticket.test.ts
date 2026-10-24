// @vitest-environment node
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { emptyComposition } from '@/lib/editor/composition'
import { addClip } from '@/lib/editor/timeline'
import { addOverlay, addTrack } from '@/lib/editor/tracks'

const state: { jobs: Record<string, unknown>[]; assets: Record<string, unknown>[]; user: string } = { jobs: [], assets: [], user: 'u1' }
const chain = (rows: () => Record<string, unknown>[]) => {
  let f: Array<(r: Record<string, unknown>) => boolean> = []
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q },
    in: (k: string, v: unknown[]) => { f.push(r => v.includes(r[k])); return q },
    maybeSingle: async () => ({ data: rows().find(r => f.every(x => x(r))) ?? null }),
    then: (ok: (v: unknown) => void) => ok({ data: rows().filter(r => f.every(x => x(r))) }),
  }
  return q
}
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) },
    from: (t: string) => chain(() => (t === 'render_jobs' ? state.jobs : state.assets)),
    storage: { from: () => ({ createSignedUrl: async (p: string, ttl: number) => ({ data: { signedUrl: `https://signed.example/${p}?ttl=${ttl}` }, error: null }) }) },
  }),
}))

const { POST } = await import('@/app/api/render/ticket/route')
const { readTicket } = await import('@/lib/render/ticket')
const { downloadTicketAssets } = await import('@/lib/render/download')
const call = (body: unknown) => POST(new Request('http://x/api/render/ticket', { method: 'POST', body: JSON.stringify(body) }))

function montage() {
  let c = emptyComposition('t', 'Mi montaje')
  c = addClip(c, 'a1', 3000); c = addClip(c, 'a2', 3000)
  const tr = addTrack(c, 'overlay'); c = tr.composition
  c = addOverlay(c, { assetId: 'logo', startMs: 0, durationMs: 2000, trackId: tr.trackId }).composition
  return { ...c, musicAssetId: 'song' }
}
const asset = (id: string, type: string, owner = 'u1', path_: string | null = `u1/p/${id}.bin`) => ({ id, owner_id: owner, asset_type: type, storage_path: path_, provenance: { bytes: 1000 } })

describe('render ticket', () => {
  it('gives the montage and signed links for every material, overlay layers and music included', async () => {
    state.jobs = [{ id: 'j1', owner_id: 'u1', project_id: 'p1', composition: montage() }]
    state.assets = [asset('a1', 'image'), asset('a2', 'video'), asset('logo', 'image'), asset('song', 'music')]
    const r = await call({ jobId: 'j1' })
    expect(r.status).toBe(200)
    const t = await r.json()
    expect(Object.keys(t.assets).sort()).toEqual(['a1', 'a2', 'logo', 'song'])
    expect(t.assets.a2.kind).toBe('video'); expect(t.assets.song.kind).toBe('audio'); expect(t.assets.logo.kind).toBe('image')
    expect(t.assets.a1.url).toContain('ttl=14400')
    expect(readTicket(t).composition.title).toBe('Mi montaje')
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it('refuses somebody else\'s montage, a missing material and a visitor', async () => {
    state.jobs = [{ id: 'j1', owner_id: 'u2', project_id: 'p1', composition: montage() }]
    state.assets = []
    expect((await call({ jobId: 'j1' })).status).toBe(404)
    state.jobs = [{ id: 'j1', owner_id: 'u1', project_id: 'p1', composition: montage() }]
    state.assets = [asset('a1', 'image'), asset('a2', 'video'), asset('song', 'music'), asset('logo', 'image', 'u1', null)]
    const r = await call({ jobId: 'j1' })
    expect(r.status).toBe(422); expect((await r.json()).missing).toEqual(['logo'])
    state.assets = [asset('a1', 'image'), asset('a2', 'video'), asset('song', 'music'), asset('logo', 'image', 'u2')]
    expect((await call({ jobId: 'j1' })).status).toBe(422)   // another person's file is never signed
    state.user = ''
    expect((await call({ jobId: 'j1' })).status).toBe(401)
    state.user = 'u1'
  })
  it('rejects expired or foreign files', () => {
    expect(() => readTicket({ version: 1, assets: {}, composition: montage(), expiresAt: '2020-01-01T00:00:00Z' })).toThrow(/caducado/)
    expect(() => readTicket({ hello: 1 })).toThrow(/paquete de render/)
  })
})

describe('material download', () => {
  let server: http.Server, base = ''
  const body = Buffer.alloc(300_000).map((_, i) => i % 251)
  let requests: string[] = [], cutOnce = true
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const range = /bytes=(\d+)-/.exec(String(req.headers.range ?? ''))
      requests.push(range ? `range ${range[1]}` : 'full')
      const from = range ? Number(range[1]) : 0
      if (from >= body.length) { res.statusCode = 416; return res.end() }
      res.statusCode = range ? 206 : 200
      res.setHeader('content-length', body.length - from)
      if (cutOnce && !range) { cutOnce = false; res.write(body.subarray(0, 100_000)); setTimeout(() => res.destroy(), 20); return }
      res.end(body.subarray(from))
    }).listen(0)
    await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => { server.close() })
  it('continues a cut download from where it stopped, and does not repeat finished files', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dl-'))
    const t = { version: 1, createdAt: '', expiresAt: '', jobId: 'j', projectId: null, title: 't', composition: montage(), assets: { x: { url: `${base}/x`, kind: 'video' } } } as never
    const a = await downloadTicketAssets(t, dir)
    expect(readFileSync(a.x.path).equals(body)).toBe(true)
    expect(requests[0]).toBe('full'); expect(requests.some(r => r.startsWith('range') && Number(r.split(' ')[1]) > 0)).toBe(true)
    const n = requests.length
    await downloadTicketAssets(t, dir)
    expect(requests.length).toBe(n)
    expect(existsSync(a.x.path + '.part')).toBe(false)
  })
})
