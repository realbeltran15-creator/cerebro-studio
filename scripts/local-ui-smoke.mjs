// Real Next.js production build + real Chromium + real login page against the local stack (real PG schema + PostgREST; Auth/Storage SIMULATED).
// Checks: protected routes redirect, UI login works through the real @supabase/ssr cookie flow, authenticated pages render without server/page errors.
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startLite } from './local-supabase-lite.mjs'

const { PGRST_URL, JWT_SECRET, PGDIR, PGPORT, CHROMIUM_PATH } = process.env, LITE = 54370, WEB = 54371
const root = path.resolve(new URL('..', import.meta.url).pathname)
const sq = sql => execFileSync('psql', ['-h', PGDIR, '-p', PGPORT, '-U', 'postgres', '-X', '-q', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const anon = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role: 'anon', iss: 'local', exp: 4102444800 }); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` })()
const lite = await startLite({ port: LITE, pgrst: PGRST_URL, secret: JWT_SECRET, storageDir: mkdtempSync(path.join(os.tmpdir(), 'lite-ui-')), onUserCreated: u => sq(`insert into auth.users (id, email, raw_user_meta_data) values ('${u.id}', '${u.email}', '{}')`) })
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${LITE}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon }
let pass = 0, fail = 0
const t = async (name, fn) => { try { const r = await fn(); if (r === true) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name, '->', JSON.stringify(r)) } } catch (e) { fail++; console.log('FAIL ', name, '-> excepción', e.message.split('\n')[0]) } }
if (!process.env.SKIP_BUILD) { console.log('next build (apunta al stack local)…'); const b = spawn('npx', ['next', 'build'], { cwd: root, env, stdio: 'ignore' }); const code = await new Promise(r => b.on('exit', r)); if (code) { console.log('FAIL build', code); process.exit(1) } }
const web = spawn('npx', ['next', 'start', '-p', String(WEB)], { cwd: root, env, stdio: 'ignore', detached: true })
// Kill the whole server process group on any exit (a leaked `next start` keeps holding CPU and the port).
process.on('exit', () => { try { process.kill(-web.pid) } catch {} })
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${WEB}/login`); break } catch { await new Promise(r => setTimeout(r, 500)) } }
const seed = createClient(`http://127.0.0.1:${LITE}`, anon, { auth: { persistSession: false } })
const su = await seed.auth.signUp({ email: 'ui@example.test', password: 'synthetic-pass-ui' }); const uid = su.data.user.id
await seed.from('projects').insert({ owner_id: uid, name: 'Proyecto visible en la UI' })
const browser = await chromium.launch({ executablePath: CHROMIUM_PATH })
const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`) })
const base = `http://127.0.0.1:${WEB}`
await t('/projects sin sesión redirige a /login?next=', async () => { await page.goto(base + '/projects'); return /\/login\?next=%2Fprojects/.test(page.url()) })
await t('la página de login se muestra', async () => (await page.getByLabel('Correo electrónico').count()) === 1)
await t('contraseña errónea muestra un mensaje y no entra', async () => { await page.getByLabel('Correo electrónico').fill('ui@example.test'); await page.locator('input[type=password]').fill('incorrecta1'); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await page.waitForTimeout(1200); return /login/.test(page.url()) })
await t('login por la interfaz con credenciales correctas', async () => { await page.locator('input[type=password]').fill('synthetic-pass-ui'); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); try { await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 20000 }) } catch (e) { console.log('   estado:', page.url(), '|', await page.locator('.connectionStatus').innerText(), '|', errors.slice(0, 3).join(' ; ')); throw e }; await page.goto(base + '/projects'); return !/\/login/.test(page.url()) })
await t('/projects muestra el proyecto del usuario (lectura servidor + RLS)', async () => { await page.waitForLoadState('networkidle'); return (await page.getByText('Proyecto visible en la UI').count()) > 0 })
for (const r of ['/library', '/scripts', '/create', '/opportunities', '/usage']) await t(`${r} carga autenticado sin redirigir a login`, async () => { await page.goto(base + r); await page.waitForLoadState('networkidle'); return !/\/login/.test(page.url()) })
await t('sin errores 5xx ni excepciones de página durante el recorrido', async () => errors.length === 0 || errors)
await browser.close(); web.kill(); lite.close()
console.log(`\nRESUMEN UI: ${pass} correctas, ${fail} fallidas`); process.exit(fail ? 1 : 0)
