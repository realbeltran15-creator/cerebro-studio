/**
 * Resumable big uploads, end to end in a real Chromium: the browser code (lib/storage/client.ts) talks to the real route handlers
 * (/api/storage/upload-url and /api/storage/multipart, with a stand-in for the database) and to a local S3-compatible server that plays R2.
 * The page is reloaded in the middle of an upload; the second attempt must send only the parts R2 does not have yet.
 *   node scripts/upload-test.mjs
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const chrome = process.env.CHROMIUM_PATH || (() => { const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; const d = existsSync(base) && readdirSync(base).find(n => /^chromium-\d+/.test(n)); return d ? path.join(base, d, 'chrome-linux/chrome') : null })()
if (!chrome) { console.log('Upload test skipped: needs Chromium.'); process.exit(0) }
const failures = []
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failures.push(name) }

// ---- Fake R2 (S3 multipart) with CORS.
const uploads = new Map(), puts = []
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'ETag' }
const s3 = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
  const u = new URL(req.url, 'http://x'); const chunks = []
  req.on('data', d => chunks.push(d))
  req.on('end', () => {
    const body = Buffer.concat(chunks), key = u.pathname.split('/').slice(2).join('/')
    if (req.method === 'POST' && u.searchParams.has('uploads')) { const id = `up-${uploads.size + 1}-xxxxxxxx`; uploads.set(id, { key, parts: new Map(), completed: false }); return res.end(`<R><UploadId>${id}</UploadId></R>`) }
    const up = uploads.get(u.searchParams.get('uploadId') ?? '')
    if (!up) { res.statusCode = 404; return res.end('<Error><Code>NoSuchUpload</Code></Error>') }
    if (req.method === 'PUT') { const n = Number(u.searchParams.get('partNumber')); puts.push(n); up.parts.set(n, { etag: `"e${n}"`, size: body.length }); res.setHeader('ETag', `"e${n}"`); return res.end() }
    if (req.method === 'GET') return res.end(`<R>${[...up.parts].map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><ETag>${p.etag.replace(/"/g, '&quot;')}</ETag><Size>${p.size}</Size></Part>`).join('')}<IsTruncated>false</IsTruncated></R>`)
    if (req.method === 'POST') { up.completed = true; return res.end('<R><Key>k</Key></R>') }
    res.statusCode = 204; res.end()
  })
}).listen(8861)
Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'bkt', R2_ENDPOINT: 'http://127.0.0.1:8861' })

// ---- Real route handlers, with a stand-in for the database.
const stub = { name: 'stub', setup(b) { b.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({ path: 'stub-supabase', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: "export const createServerSupabaseClient = async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }) })" })) } }
const api = await build({ stdin: { contents: "export { POST as multipart } from '@/app/api/storage/multipart/route'; export { POST as uploadUrl } from '@/app/api/storage/upload-url/route'", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error', plugins: [stub], external: ['next/server'] })
const cache = path.join(root, 'node_modules/.cache/cerebro-upload'); mkdirSync(cache, { recursive: true })
writeFileSync(path.join(cache, 'routes.cjs'), api.outputFiles[0].text)
const routes = (await import('node:module')).createRequire(import.meta.url)(path.join(cache, 'routes.cjs'))
const harness = (await build({ entryPoints: [path.join(root, 'tests/browser/upload.harness.ts')], bundle: true, write: false, format: 'iife', logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"' } })).outputFiles[0].text
const app = http.createServer(async (q, r) => {
  const u = q.url.split('?')[0]
  if (u === '/h.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(harness) }
  if (u === '/api/storage/multipart' || u === '/api/storage/upload-url') {
    const chunks = []; for await (const c of q) chunks.push(c)
    const res = await (u.endsWith('multipart') ? routes.multipart : routes.uploadUrl)(new Request(`http://x${u}`, { method: 'POST', body: Buffer.concat(chunks) }))
    r.writeHead(res.status, { 'content-type': 'application/json' }); return r.end(await res.text())
  }
  r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><meta charset="utf-8"><script src="/h.js"></script>')
}).listen(8860)

const SIZE = 150 * 1024 * 1024   // 5 parts of 32 MiB (the last one smaller)
const browser = await chromium.launch({ executablePath: chrome })
const ctx = await browser.newContext()
const errors = []
let page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8860/'); await page.waitForFunction(() => typeof window.startUpload === 'function')
await page.evaluate(n => window.startUpload(n), SIZE)
const t0 = Date.now()
while (puts.length < 2 && Date.now() - t0 < 120000) await new Promise(r => setTimeout(r, 50))
await page.close()                       // the browser is closed in the middle of the upload
await new Promise(r => setTimeout(r, 300))
const first = [...new Set(puts)].sort()
const up1 = [...uploads.values()][0]
check('the first attempt started one multipart upload and sent some parts, not all', uploads.size === 1 && first.length >= 2 && first.length < 5 && !up1.completed, { uploads: uploads.size, first })
const before = puts.length
page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8860/'); await page.waitForFunction(() => typeof window.runUpload === 'function')
const done = await page.evaluate(n => window.runUpload(n), SIZE)
const second = puts.slice(before)
const have = new Set([...up1.parts.keys()])
check('the second attempt continued the SAME upload (no new upload started)', uploads.size === 1, uploads.size)
check('it sent only the parts R2 did not have (no part sent twice after the interruption)', second.every(n => !first.includes(n) || second.filter(x => x === n).length === 1) && [1, 2, 3, 4, 5].every(n => have.has(n)), { first, second })
check('the upload was completed with 5 parts in the right sizes', up1.completed && up1.parts.size === 5 && up1.parts.get(5).size === SIZE - 4 * 32 * 1024 * 1024 && up1.parts.get(1).size === 32 * 1024 * 1024, [...up1.parts].map(([n, p]) => [n, p.size]))
check('it returned the R2 path in the user\'s own folder and reported progress up to 100 %', /^r2:u1\/library\/uploads\/abcdefgh-1\.mp4$/.test(done.path) && done.progress.at(-1) === 1 && done.progress[0] > 0, { path: done.path, progress: done.progress.slice(0, 3) })
check('no page errors', errors.length === 0, errors)
await browser.close(); s3.close(); app.close()
console.log(failures.length ? `${failures.length} check(s) failed` : 'Upload checks passed.')
process.exit(failures.length ? 1 : 0)
