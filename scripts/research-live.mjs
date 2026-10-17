/**
 * Drives the REAL Cerebro Studio (Preview) in a real Chromium, logged in with a dedicated test account, and runs Investigación like a user.
 * Credentials come only from environment variables (never from the chat, never printed):
 *   CEREBRO_EMAIL, CEREBRO_PASSWORD         a test account of the app
 *   CEREBRO_URL                              default: the feat/creation-studio Preview
 *   VERCEL_BYPASS_TOKEN (optional)           only if the Preview is protected by Vercel Authentication
 * Stages (small first, so quota is spent in steps):
 *   --stage smoke   1 market, 1 topic (~204 units): proves login, filters, the real API and the thumbnails
 *   --stage guided  --per N (default 3) in the six markets: runs what fits in today's budget, then exports the report
 * Output: research-output/live-<date>/ (screenshots + report). Real data comes from whatever YOUTUBE_API_KEY the Preview server has.
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import path from 'path'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const base = (process.env.CEREBRO_URL || 'https://cerebro-studio-git-feat-creation-studio-jesus-e021.vercel.app').replace(/\/$/, '')
const chrome = process.env.CHROMIUM_PATH || (() => { const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; const d = existsSync(b) && readdirSync(b).find(n => /^chromium-\d+/.test(n)); return d ? path.join(b, d, 'chrome-linux/chrome') : null })()
const out = path.resolve('research-output', `live-${new Date().toISOString().slice(0, 10)}`); mkdirSync(out, { recursive: true })

const pick = async (page, label, search, option) => { await page.getByRole('button', { name: label, exact: true }).click(); await page.getByLabel(`Buscar en ${label}`).fill(search); await page.getByRole('checkbox', { name: option }).check(); await page.keyboard.press('Escape') }

/** The research walk-through, used against the real app and (in tests) against the local harness. */
export async function drive(page, { stage = 'smoke', per = 3, log = console.log, shot = async () => {} } = {}) {
  await page.getByRole('tab', { name: 'Nichos' }).click()
  const go = () => page.getByRole('button', { name: /^Aplicar y/ })
  if (stage === 'smoke') {
    await pick(page, 'Países', 'Estados', /Estados Unidos/); await pick(page, 'Nichos', 'inteligencia', /Inteligencia artificial/)
    await page.getByLabel(/Temas o subnichos/).fill('AI tools for productivity')
    log('Plan:', (await page.getByLabel('Qué hará el botón').innerText()).replace(/\s+/g, ' '))
    await shot('smoke-1-plan'); await go().click()
    await page.getByText(/Resultados actualizados: \d+ análisis/).waitFor({ timeout: 120000 })
    const hidden = page.getByRole('status', { name: 'Resultados ocultos por filtros' })
    if (await hidden.count()) { log('Aviso:', (await hidden.innerText()).replace(/\s+/g, ' ').slice(0, 200)); await hidden.getByRole('button', { name: /Mostrar todos/ }).click() }
    await shot('smoke-2-resultado')
    const card = page.getByRole('article', { name: /^Análisis de/ }).first()
    log('Resultado:', (await card.innerText()).replace(/\s+/g, ' ').slice(0, 600))
    await page.getByRole('tab', { name: 'Descubrir oportunidades' }).click()
    const thumbs = await page.locator('.recoSection .thumb img').evaluateAll(els => els.map(e => ({ src: e.getAttribute('src'), loaded: e.complete && e.naturalWidth > 0 })))
    log(`Miniaturas en recomendaciones: ${thumbs.length} (${thumbs.filter(t => t.loaded).length} cargadas)`)
    await shot('smoke-3-recomendaciones')
    return { thumbs }
  }
  for (const [q, o] of [['Estados', /Estados Unidos/], ['Alemania', /Alemania/], ['Australia', /Australia/], ['Reino', /Reino Unido/], ['Canad', /Canadá/], ['Suiza', /Suiza/]]) await pick(page, 'Países', q, o)
  await page.getByRole('button', { name: 'Solo aplicar filtros (sin buscar)' }).click()
  const g = page.getByRole('region', { name: 'Investigación guiada' })
  await g.getByLabel('Subnichos por mercado').fill(String(per))
  await g.getByRole('button', { name: /Preparar plan/ }).click()
  log('Plan guiado:', (await g.getByText(/análisis pendientes/).innerText()).replace(/\s+/g, ' '))
  const confirm = g.getByRole('checkbox', { name: /gastará/ }); if (await confirm.count()) await confirm.check()
  await g.getByRole('button', { name: /Ejecutar lo que cabe hoy/ }).click()
  await page.getByRole('button', { name: /Ejecutar lo que cabe hoy|Plan completo/ }).waitFor({ timeout: 30 * 60 * 1000 })
  await shot('guided-resultado')
  const dl = page.waitForEvent('download')
  await g.getByRole('button', { name: 'Exportar informe (Markdown)' }).click()
  const file = await dl; const dest = path.join(out, file.suggestedFilename()); await file.saveAs(dest); log('Informe guardado en', dest)
  const dl2 = page.waitForEvent('download')
  await g.getByRole('button', { name: 'Exportar informe (CSV)' }).click()
  const f2 = await dl2; await f2.saveAs(path.join(out, f2.suggestedFilename()))
  return { dest }
}

if (process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1])) {
  const { CEREBRO_EMAIL: email, CEREBRO_PASSWORD: password, VERCEL_BYPASS_TOKEN: bypass } = process.env
  if (!email || !password) { console.error('Faltan CEREBRO_EMAIL y CEREBRO_PASSWORD en el entorno (cuenta de prueba de la app).'); process.exit(2) }
  const browser = await chromium.launch({ executablePath: chrome })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : undefined })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const shot = async n => page.screenshot({ path: path.join(out, `${n}.png`), fullPage: true })
  const res = await page.goto(`${base}/login`)
  console.log('Preview /login →', res?.status())
  await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
  await page.goto(`${base}/market-intelligence`); await page.getByRole('tab').first().waitFor({ timeout: 30000 })
  await shot('00-entrada')
  const r = await drive(page, { stage: arg('stage', 'smoke'), per: Number(arg('per', '3')), log: (...a) => console.log(...a), shot })
  console.log('Errores de página:', errors.length ? errors : 'ninguno')
  await browser.close(); void r
}
