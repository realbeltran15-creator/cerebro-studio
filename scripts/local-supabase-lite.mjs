// "Supabase-lite" for LOCAL beta tests. It is NOT Supabase. One HTTP gateway that real @supabase/supabase-js talks to:
//   /rest/v1/*     -> REAL PostgREST (RLS enforced by the real PostgreSQL schema)
//   /auth/v1/*     -> SIMULATED GoTrue (signup, password login, refresh, user, logout). HS256 JWTs signed with the PostgREST secret.
//   /storage/v1/*  -> SIMULATED Storage API on a temp directory. The per-user-folder rule of the real bucket policy is re-implemented in code,
//                     so it is NOT the real storage.objects RLS.
// Known limits (not covered): email confirmation, OAuth, password rules/rate limits, MFA, token revocation, Storage RLS/resumable uploads/image transforms, Realtime.
import http from 'node:http'
import { createHmac, randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
export function startLite({ port, pgrst, secret, storageDir, onUserCreated }) {
  const sign = c => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(c); return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}` }
  const verify = t => { const [h, p, s] = (t ?? '').split('.'); if (!s) return null; const ok = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'); if (s.length !== ok.length || !timingSafeEqual(Buffer.from(s), Buffer.from(ok))) return null; const c = JSON.parse(Buffer.from(p, 'base64url').toString()); return c.exp > Date.now() / 1000 ? c : null }
  const users = new Map(), refresh = new Map()
  const userJson = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created, app_metadata: { provider: 'email' }, user_metadata: u.meta, created_at: u.created })
  const session = u => { const now = Math.floor(Date.now() / 1000), rt = randomBytes(16).toString('hex'); refresh.set(rt, u.id); return { access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp: now + 3600 }), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: rt, user: userJson(u) } }
  const hash = (pw, salt = randomBytes(8).toString('hex')) => `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`
  const same = (pw, h) => { const [salt] = h.split(':'); return hash(pw, salt) === h }
  const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))) })
  const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  const uidOf = req => { const t = (req.headers.authorization ?? '').replace(/^Bearer /, ''); const c = verify(t); return c && c.role === 'authenticated' ? c.sub : (c?.role === 'service_role' ? 'service' : null) }
  const file = (bucket, p) => path.join(storageDir, bucket, ...p.split('/').filter(Boolean))
  // The real policy: only the first folder named like the caller's uid.
  const allowed = (uid, p) => uid === 'service' || (uid && p.split('/')[0] === uid)
  const signedTokens = new Map()

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), p = url.pathname
    // The browser app talks to this gateway cross-origin (as it does to the real Supabase), so answer CORS like Supabase does.
    res.setHeader('access-control-allow-origin', req.headers.origin ?? '*'); res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] ?? '*'); res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'); res.setHeader('access-control-expose-headers', 'content-range,content-profile')
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    try {
      if (p.startsWith('/rest/v1/')) { // transparent proxy to the real PostgREST
        const b = await body(req)
        const h = { ...req.headers }; delete h.host
        const up = http.request(pgrst + p.slice('/rest/v1'.length) + url.search, { method: req.method, headers: h }, r => { const hh = { ...r.headers }; delete hh['access-control-allow-origin']; res.writeHead(r.statusCode, hh); r.pipe(res) })
        up.on('error', e => json(res, 502, { message: String(e) })); return up.end(b)
      }
      if (p.startsWith('/auth/v1/')) {
        const route = p.slice('/auth/v1'.length), b = (await body(req)).toString(), j = b ? JSON.parse(b) : {}
        if (route === '/signup' && req.method === 'POST') {
          if (!j.email || !j.password || j.password.length < 6) return json(res, 422, { code: 'weak_password', msg: 'Password should be at least 6 characters.' })
          if ([...users.values()].some(u => u.email === j.email)) return json(res, 422, { code: 'user_already_exists', msg: 'User already registered' })
          const u = { id: randomUUID(), email: j.email, pw: hash(j.password), meta: j.data ?? {}, created: new Date().toISOString() }; users.set(u.id, u)
          await onUserCreated?.(u); return json(res, 200, session(u))
        }
        if (route === '/token' && req.method === 'POST') {
          const g = url.searchParams.get('grant_type')
          if (g === 'password') { const u = [...users.values()].find(x => x.email === j.email); if (!u || !same(j.password ?? '', u.pw)) return json(res, 400, { code: 'invalid_credentials', msg: 'Invalid login credentials' }); return json(res, 200, session(u)) }
          if (g === 'refresh_token') { const id = refresh.get(j.refresh_token); if (!id) return json(res, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }); refresh.delete(j.refresh_token); return json(res, 200, session(users.get(id))) }
        }
        if (route === '/user' && req.method === 'GET') { const c = verify((req.headers.authorization ?? '').replace(/^Bearer /, '')); const u = c && users.get(c.sub); return u ? json(res, 200, userJson(u)) : json(res, 401, { code: 'bad_jwt', msg: 'invalid JWT' }) }
        if (route === '/logout') { res.writeHead(204); return res.end() }
        return json(res, 404, { msg: 'not simulated: ' + route })
      }
      if (p.startsWith('/storage/v1/')) {
        const route = p.slice('/storage/v1'.length), uid = uidOf(req)
        let m
        if ((m = route.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'GET') { // download with a signed token
          const t = signedTokens.get(url.searchParams.get('token')); if (!t || t.kind !== 'get' || t.bucket !== m[1] || t.path !== decodeURIComponent(m[2]) || t.exp < Date.now()) return json(res, 400, { error: 'InvalidJWT', message: 'invalid or expired token' })
          const f = file(m[1], t.path); if (!existsSync(f)) return json(res, 404, { error: 'not_found' }); res.writeHead(200); return res.end(readFileSync(f))
        }
        if ((m = route.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'POST') {
          const j = JSON.parse((await body(req)).toString() || '{}'); const pth = decodeURIComponent(m[2]); if (!allowed(uid, pth)) return json(res, 403, { error: 'Unauthorized', message: 'new row violates row-level security policy' })
          const tok = randomBytes(12).toString('hex'); signedTokens.set(tok, { kind: 'get', bucket: m[1], path: pth, exp: Date.now() + (j.expiresIn ?? 60) * 1000 })
          return json(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=${tok}` })
        }
        if ((m = route.match(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/))) {
          const pth = decodeURIComponent(m[2])
          if (req.method === 'POST') { if (!allowed(uid, pth)) return json(res, 403, { error: 'Unauthorized' }); const tok = randomBytes(12).toString('hex'); signedTokens.set(tok, { kind: 'put', bucket: m[1], path: pth, exp: Date.now() + 7200e3 }); return json(res, 200, { url: `/object/upload/sign/${m[1]}/${m[2]}?token=${tok}`, token: tok }) }
          const t = signedTokens.get(url.searchParams.get('token')); if (!t || t.kind !== 'put' || t.path !== pth) return json(res, 400, { error: 'InvalidJWT' })
          const f = file(m[1], pth); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, await body(req)); signedTokens.delete(url.searchParams.get('token')); return json(res, 200, { Key: `${m[1]}/${pth}` })
        }
        if ((m = route.match(/^\/object\/list\/([^/]+)$/)) && req.method === 'POST') {
          const j = JSON.parse((await body(req)).toString() || '{}'), prefix = (j.prefix ?? '').replace(/\/$/, ''); if (!allowed(uid, prefix || '/')) return json(res, 200, [])
          const d = file(m[1], prefix); const out = existsSync(d) ? readdirSync(d).map(n => ({ name: n, id: randomUUID(), metadata: { size: statSync(path.join(d, n)).size } })) : []
          return json(res, 200, out.slice(j.offset ?? 0, (j.offset ?? 0) + (j.limit ?? 100)))
        }
        if ((m = route.match(/^\/object\/([^/]+)$/)) && req.method === 'DELETE') { // remove
          const j = JSON.parse((await body(req)).toString() || '{}'); const done = []
          for (const x of j.prefixes ?? []) if (allowed(uid, x)) { const f = file(m[1], x); if (existsSync(f)) { rmSync(f); done.push({ name: x }) } }
          return json(res, 200, done)
        }
        if ((m = route.match(/^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/))) {
          const pth = decodeURIComponent(m[2]), f = file(m[1], pth)
          if (!allowed(uid, pth)) return json(res, uid ? 403 : 401, { error: 'Unauthorized', message: 'not allowed' })
          if (req.method === 'GET') { if (!existsSync(f)) return json(res, 404, { error: 'not_found', message: 'Object not found' }); res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(readFileSync(f)) }
          if (req.method === 'POST' || req.method === 'PUT') {
            if (existsSync(f) && req.headers['x-upsert'] !== 'true') return json(res, 400, { error: 'Duplicate', message: 'The resource already exists', statusCode: '409' })
            mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, await body(req)); return json(res, 200, { Id: randomUUID(), Key: `${m[1]}/${pth}` })
          }
        }
        return json(res, 404, { msg: 'not simulated: ' + route })
      }
      json(res, 404, { msg: 'unknown' })
    } catch (e) { json(res, 500, { message: String(e) }) }
  })
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)))
}
