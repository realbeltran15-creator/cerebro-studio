// Auditoría de uso de la beta con la app REAL (Next.js + Chromium) y Auth/Storage/PostgREST OFICIALES (OFFICIAL=1).
// Para cada página en alcance: carga como usuario autenticado, captura de pantalla (escritorio y móvil), errores de consola/red,
// desbordamiento horizontal en móvil, y que NINGÚN enlace/botón interno lleve a una página cerrada (callejón sin salida).
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
const { JWT_SECRET, CHROMIUM_PATH } = process.env, GW = Number(process.env.GATEWAY_PORT || 54321), WEB = 54391
const OUT = process.env.AUDIT_OUT || '/tmp/audit'; mkdirSync(OUT, { recursive: true })
const root = path.resolve(new URL('..', import.meta.url).pathname)
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const anon = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role: 'anon', iss: 'local', exp: 4102444800 }); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` })()
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: '1', ...(process.env.AUDIT_ALL === '1' ? {} : { NEXT_PUBLIC_CEREBRO_BETA: 'private' }), NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${GW}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon }
if (!process.env.SKIP_BUILD) { const b = spawn('npx', ['next', 'build'], { cwd: root, env, stdio: 'ignore' }); if ((await new Promise(r => b.on('exit', r))) !== 0) { console.log('FAIL build'); process.exit(1) } }
const web = spawn('npx', ['next', 'start', '-p', String(WEB)], { cwd: root, env, stdio: 'ignore', detached: true })
process.on('exit', () => { try { process.kill(-web.pid) } catch {} })
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${WEB}/login`); break } catch { await new Promise(r => setTimeout(r, 500)) } }
const base = `http://127.0.0.1:${WEB}`, EMAIL = 'auditor@example.test', PW = 'synthetic-pass-audit'
await createClient(`http://127.0.0.1:${GW}`, anon, { auth: { persistSession: false } }).auth.signUp({ email: EMAIL, password: PW })
const browser = await chromium.launch({ executablePath: CHROMIUM_PATH })
let fail = 0; const out = (ok, m) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${m}`) }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage()
let bad = []; page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|status of 40[34]/.test(m.text())) bad.push('console: ' + m.text().slice(0, 140)) }); page.on('pageerror', e => bad.push('pageerror: ' + String(e).slice(0, 140)))
page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) bad.push(`${r.status()} ${r.url().slice(0, 110)}`) })
await page.goto(base + '/login'); await page.getByLabel('Correo electrónico').fill(EMAIL); await page.locator('input[type=password]').fill(PW)
await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 20000 })
out(true, 'login por la interfaz')
const ALL = process.env.AUDIT_ALL === '1' // todos los módulos (beta apagada; sin claves de proveedores: nada puede gastar)
const PAGES = ALL ? (process.env.AUDIT_PAGES || '').split(',').filter(Boolean) : ['/', '/projects', '/scripts', '/create', '/library', '/audio', '/storage', '/editor', '/editor/manual']
const allLinks = new Map()
for (const p of PAGES) {
  bad = []; await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(base + p); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600)
  const slug = p === '/' ? 'home' : p.slice(1).replace(/\//g, '_')
  await page.screenshot({ path: `${OUT}/${slug}-desktop.png`, fullPage: true })
  const info = await page.evaluate(() => ({ h1: document.querySelector('h1')?.innerText || '', text: (document.querySelector('main')?.innerText || '').length, links: [...document.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href')) }))
  out(!/\/login/.test(page.url()) && !/fuera-de-alcance/.test(page.url()), `${p}: carga sin redirigir (${page.url().replace(base, '')})`)
  out(info.h1.length > 0, `${p}: tiene título principal (${info.h1.slice(0, 40)})`)
  out(info.text > 30, `${p}: tiene contenido (${info.text} caracteres)`)
  out(!/Application error|Unhandled Runtime Error|Internal Server Error|This page couldn.t load/i.test(await page.locator('body').innerText()), `${p}: sin pantalla de error de la aplicación`)
  out(bad.length === 0, `${p}: sin errores de consola ni respuestas ≥400${bad.length ? ' -> ' + bad.slice(0, 3).join(' | ') : ''}`)
  for (const l of info.links) allLinks.set(l, (allLinks.get(l) || new Set()).add(p))
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${slug}-mobile.png`, fullPage: true })
  for (const w of [375, 390]) { // regresión de desbordamiento horizontal en móvil
    await page.setViewportSize({ width: w, height: 844 }); await page.waitForTimeout(250)
    const ov = await page.evaluate(() => { const W = window.innerWidth, bad = []; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width && r.right > W + 2 && !e.closest('[aria-hidden=true]')) bad.push(`${e.tagName.toLowerCase()}:${Math.round(r.right - W)}:${(e.innerText || "").slice(0, 40).replace(/\n/g, " ")}:ws=${getComputedStyle(e).whiteSpace}`) } return { px: document.documentElement.scrollWidth - W, bad: bad.slice(0, 4) } })
    out(ov.px <= 2, `${p}: sin desbordamiento horizontal a ${w} px (${ov.px}px)${ov.px > 2 ? ' ' + ov.bad.join(' ') : ''}`)
  }
}
// Ningún enlace interno visible puede llevar a una página cerrada
const dead = []
for (const [href, from] of allLinks) {
  if (/^\/(_next|api)\//.test(href) || href.startsWith('//')) continue
  const r = await page.request.get(base + href, { maxRedirects: 0 }).catch(() => null)
  const loc = r?.headers()['location'] || ''
  if (!r || /fuera-de-alcance/.test(loc) || r.status() >= 400) dead.push(`${href} (desde ${[...from].join(',')}) -> ${r ? r.status() + ' ' + loc : 'sin respuesta'}`)
}
out(dead.length === 0, `enlaces internos (${allLinks.size}) sin callejones sin salida${dead.length ? '\n   ' + dead.join('\n   ') : ''}`)
await browser.close(); web.kill()
console.log(`\nRESUMEN AUDITORÍA: ${fail === 0 ? 'sin hallazgos' : fail + ' hallazgos'} · capturas en ${OUT}`); process.exit(fail ? 1 : 0)
