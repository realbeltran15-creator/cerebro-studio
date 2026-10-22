import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classify, fingerprintKey, formatBytes } from '@/lib/ingest/files'
import { bearer, hashToken, looksLikeToken, newToken, shortcutPathOk } from '@/lib/ingest/shortcut'

const OWNER = '11111111-1111-4111-8111-111111111111'
const PROJ = '22222222-2222-4222-8222-222222222222'

describe('files from the iPhone', () => {
  it('accepts what iPhone apps hand over and refuses what the editor cannot use, with the reason', () => {
    expect(classify('IMG_0001.MOV', 'video/quicktime')).toMatchObject({ ok: true, kind: 'video', mime: 'video/quicktime', ext: 'mov' })
    expect(classify('Grabación 12.m4a', 'audio/x-m4a')).toMatchObject({ ok: true, kind: 'voice', mime: 'audio/mp4' })
    expect(classify('IMG_0002.JPG', '')).toMatchObject({ ok: true, kind: 'image', mime: 'image/jpeg' })
    expect(classify('cancion.mp3', 'audio/mpeg')).toMatchObject({ ok: true, kind: 'music' })
    expect(classify('IMG_0003.HEIC', 'image/heic')).toMatchObject({ ok: false })
    expect(classify('doc.pdf', 'application/pdf')).toMatchObject({ ok: false })
    expect(classify('x.mov', 'video/quicktime').ok && (classify('x.mov', 'video/quicktime') as { note?: string }).note).toMatch(/HEVC/)
  })
  it('duplicate key and sizes', () => {
    expect(fingerprintKey('IMG_0001.MOV', 123)).toBe('img_0001.mov|123')
    expect(formatBytes(52428800)).toBe('50.0 MB')
  })
})

describe('shortcut token', () => {
  it('tokens are random, recognisable and stored only as a hash', () => {
    const t = newToken()
    expect(looksLikeToken(t)).toBe(true)
    expect(newToken()).not.toBe(t)
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(bearer(new Request('http://x', { headers: { authorization: `Bearer ${t}` } }))).toBe(t)
    expect(bearer(new Request('http://x', { headers: { authorization: 'Bearer nope' } }))).toBeNull()
  })
  it('only the owner\'s upload paths can be finished', () => {
    expect(shortcutPathOk(`${OWNER}/library/uploads/ios-${PROJ}.mov`, OWNER)).toBe(true)
    expect(shortcutPathOk(`${OWNER}/${PROJ}/uploads/ios-${PROJ}.mp4`, OWNER)).toBe(true)
    expect(shortcutPathOk(`${PROJ}/library/uploads/ios-${PROJ}.mov`, OWNER)).toBe(false)
    expect(shortcutPathOk(`${OWNER}/library/uploads/../x/ios-${PROJ}.mov`, OWNER)).toBe(false)
    expect(shortcutPathOk(`${OWNER}/library/renders/ios-${PROJ}.mov`, OWNER)).toBe(false)
  })
})

// ---- The two shortcut routes, against a fake service-role client
const state: { configs: Array<{ id: string; owner_id: string; provider?: string; capability?: string; config: Record<string, unknown> }>; assets: Array<Record<string, unknown>>; projects: Array<{ id: string; owner_id: string }>; objects: Record<string, { size: number; mimetype: string }>; removed: string[]; signed: string[] } = { configs: [], assets: [], projects: [], objects: {}, removed: [], signed: [] }
function fakeAdmin() {
  const table = (name: string) => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = []
    let patch: Record<string, unknown> | null = null
    const rows = () => (name === 'connector_configs' ? state.configs : name === 'assets' ? state.assets : state.projects) as Array<Record<string, unknown>>
    const get = (r: Record<string, unknown>, c: string) => (c.includes('->>') ? (r[c.split('->>')[0]] as Record<string, unknown> | undefined)?.[c.split('->>')[1]] : r[c])
    const b: Record<string, unknown> = {}
    b.select = () => b; b.limit = () => b
    b.eq = (c: string, v: unknown) => { filters.push(r => get(r, c) === v); return b }
    b.update = (p: Record<string, unknown>) => { patch = p; return b }
    b.insert = async (row: Record<string, unknown>) => { state.assets.push(row); return { error: null } }
    b.maybeSingle = async () => ({ data: rows().filter(r => filters.every(f => f(r)))[0] ?? null, error: null })
    b.then = (res: (v: unknown) => unknown) => { const hit = rows().filter(r => filters.every(f => f(r))); if (patch) for (const r of hit) Object.assign(r, patch); return Promise.resolve({ data: hit, error: null }).then(res) }
    return b
  }
  return {
    from: table,
    storage: { from: () => ({
      createSignedUploadUrl: async (path: string) => { state.signed.push(path); return { data: { signedUrl: `https://sb.example/storage/v1/object/upload/sign/generated-assets/${path}?token=t`, token: 't', path }, error: null } },
      list: async (dir: string, o: { search: string }) => { const k = `${dir}/${o.search}`; return { data: state.objects[k] ? [{ name: o.search, metadata: state.objects[k] }] : [], error: null } },
      remove: async (paths: string[]) => { state.removed.push(...paths); return { error: null } },
    }) },
  }
}
vi.mock('@/lib/supabase/admin', () => ({ serviceRoleClient: () => fakeAdmin() }))

const TOKEN = newToken()
const call = async (route: 'start' | 'finish', body: unknown, token = TOKEN) => {
  const mod = route === 'start' ? await import('@/app/api/ios/start/route') : await import('@/app/api/ios/finish/route')
  const res = await mod.POST(new Request(`http://x/api/ios/${route}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const raw = await res.text()
  let json: Record<string, string> | null = null
  try { json = JSON.parse(raw) } catch { /* plain text */ }
  return { status: res.status, text: raw, json }
}

describe('iPhone shortcut routes', () => {
  beforeEach(() => {
    state.configs = [{ id: 'c1', owner_id: OWNER, provider: 'cerebro-ios', capability: 'share_token', config: { hash: hashToken(TOKEN), createdAt: 'x', destination: PROJ, uploads: 0 } }]
    state.assets = []; state.projects = [{ id: PROJ, owner_id: OWNER }]; state.objects = {}; state.removed = []; state.signed = []
  })
  it('start: a valid code gets a one-time upload URL inside the owner\'s folder and destination', async () => {
    const r = await call('start', { name: 'IMG_0001.MOV', size: 1000 })
    expect(r.status).toBe(200)
    expect(r.json?.contentType).toBe('video/quicktime')
    expect(r.json?.path).toMatch(new RegExp(`^${OWNER}/${PROJ}/uploads/ios-[0-9a-f-]{36}\\.mov$`))
    expect(r.json?.putUrl).toContain('/object/upload/sign/')
  })
  it('start: wrong or revoked code, unsupported type, too large', async () => {
    expect((await call('start', { name: 'a.mov' }, newToken())).status).toBe(401)
    expect((await call('start', { name: 'a.heic' })).status).toBe(415)
    const big = await call('start', { name: 'a.mov', size: 60 * 1024 * 1024 })
    expect(big.status).toBe(413); expect(big.text).toMatch(/50\.0 MB/)
    expect(state.signed).toEqual([])
  })
  it('finish: registers what really arrived, in the destination, and refuses duplicates', async () => {
    const s = await call('start', { name: 'IMG_0001.MOV' })
    const path = s.json!.path
    expect((await call('finish', { path, name: 'IMG_0001.MOV' })).status).toBe(404) // nothing uploaded yet
    state.objects[path] = { size: 2048, mimetype: 'video/quicktime' }
    const ok = await call('finish', { path, name: 'IMG_0001.MOV' })
    expect(ok.status).toBe(200); expect(ok.text).toMatch(/Guardado en Cerebro Studio: IMG_0001\.MOV/)
    expect(state.assets[0]).toMatchObject({ owner_id: OWNER, project_id: PROJ, asset_type: 'video', storage_path: path, provenance: { bytes: 2048, uploadedFrom: 'iphone-shortcut', original: true } })
    expect(state.configs[0].config.uploads).toBe(1)
    const s2 = await call('start', { name: 'IMG_0001.MOV' })
    state.objects[s2.json!.path] = { size: 2048, mimetype: 'video/quicktime' }
    const dup = await call('finish', { path: s2.json!.path, name: 'IMG_0001.MOV' })
    expect(dup.text).toMatch(/Ya estaba/); expect(state.removed).toEqual([s2.json!.path]); expect(state.assets.length).toBe(1)
  })
  it('finish: another user\'s path is refused', async () => {
    const r = await call('finish', { path: `${PROJ}/library/uploads/ios-${PROJ}.mov`, name: 'x.mov' })
    expect(r.status).toBe(400)
  })
  it('a deleted destination project falls back to the general Library', async () => {
    state.projects = []
    const r = await call('start', { name: 'a.m4a' })
    expect(r.json?.path).toMatch(new RegExp(`^${OWNER}/library/uploads/`))
  })
})
