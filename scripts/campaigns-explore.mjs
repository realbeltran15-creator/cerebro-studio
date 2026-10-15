/** Screenshots of /campaigns in a real Chromium (mocked page shell, no network). Output: $EXPLORE_OUT (default /tmp/explore-campaigns). */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'fs'
import http from 'http'
import path from 'path'

const root = path.resolve(new URL('..', import.meta.url).pathname), dir = path.join(root, 'tests/browser')
const out = process.env.EXPLORE_OUT || '/tmp/explore-campaigns'; mkdirSync(out, { recursive: true })
const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
const chrome = process.env.CHROMIUM_PATH || (() => { const d = existsSync(b) && readdirSync(b).find(n => /^chromium-\d+/.test(n)); return path.join(b, d, 'chrome-linux', 'chrome') })()
const bundled = await build({ stdin: { contents: `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/campaigns/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': '""' }, alias: { '@': root },
  plugins: [{ name: 'mocks', setup(x) { x.onResolve({ filter: /^next\/(link|navigation)$/ }, () => ({ path: path.join(dir, 'mocks/next.tsx') })); x.onResolve({ filter: /(^@\/lib|\.\.\/lib|\.\/lib)\/supabase\/client$/ }, () => ({ path: path.join(dir, 'mocks/supabase.ts') })) } }] })
const scripts = { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8'), 'app.js': bundled.outputFiles[0].text }
const server = http.createServer((q, r) => { const n = q.url.split('?')[0].slice(1); if (scripts[n]) { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(scripts[n]) } r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>${Object.keys(scripts).map(s => `<script src="/${s}"></script>`).join('')}`) }).listen(8802)
const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8')
const browser = await chromium.launch({ executablePath: chrome }), page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
await page.route('**/api/campaigns/connections', r => r.fulfill({ json: { networks: ['google_ads', 'meta_ads', 'tiktok_ads'].map(n => ({ network: n, state: 'no_disponible', message: 'No disponible: faltan la aprobación de la plataforma y la conexión. Puedes diseñar y guardar la campaña igualmente.' })) } }))
await page.goto('http://127.0.0.1:8802/campaigns'); await page.addStyleTag({ content: css })
await page.getByRole('button', { name: '+ Nueva campaña' }).first().click()
await page.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Un canal' }); await page.getByLabel('Nombre', { exact: true }).fill('Umbral del Hito')
await page.getByLabel('Objetivo principal', { exact: true }).selectOption({ label: 'Suscriptores / seguidores' })
await page.getByRole('button', { name: 'Usar plataformas sugeridas' }).click(); await page.getByLabel('Presupuesto total', { exact: true }).fill('900'); await page.getByLabel('Duración (días)', { exact: true }).fill('28'); await page.getByLabel('Cantidad esperada', { exact: true }).fill('600'); await page.getByLabel('Métrica', { exact: true }).selectOption({ label: 'Suscriptores' })
const shot = n => page.screenshot({ path: path.join(out, `${n}.png`), fullPage: true })
await shot('1-brief')
for (const [t, n] of [['Estrategia', '2-estrategia'], ['Presupuesto y calendario', '3-presupuesto'], ['Resultados y reglas', '4-resultados'], ['Conexiones', '5-conexiones'], ['Informe', '6-informe']]) { await page.getByRole('tab', { name: t }).click(); await page.waitForTimeout(400); await shot(n) }
await browser.close(); server.close(); console.log('shots in', out)
