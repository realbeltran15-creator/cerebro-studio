/**
 * Exploratory walk-through of /market-intelligence in a real Chromium, with screenshots and an inventory of every control.
 * Data is MOCKED (tests/browser/research-fixtures.mjs): no YouTube quota is spent. Output goes to $EXPLORE_OUT (default /tmp/explore).
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs'
import http from 'http'
import path from 'path'
import { installResearchRoutes } from '../tests/browser/research-fixtures.mjs'

const root = path.resolve(new URL('..', import.meta.url).pathname), dir = path.join(root, 'tests/browser')
const out = process.env.EXPLORE_OUT || '/tmp/explore'; mkdirSync(out, { recursive: true })
const chrome = process.env.CHROMIUM_PATH || (() => { const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; const d = existsSync(b) && readdirSync(b).find(n => /^chromium-\d+/.test(n)); return d ? path.join(b, d, 'chrome-linux/chrome') : null })()
const bundleOut = await build({ stdin: { contents: `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/market-intelligence/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': '""' }, alias: { '@': root },
  plugins: [{ name: 'mocks', setup(b) { b.onResolve({ filter: /^next\/(link|navigation)$/ }, () => ({ path: path.join(dir, 'mocks/next.tsx') })); b.onResolve({ filter: /(^@\/lib|\.\.\/lib|\.\/lib)\/supabase\/client$/ }, () => ({ path: path.join(dir, 'mocks/supabase.ts') })) } }] })
const scripts = { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8'), 'app.js': bundleOut.outputFiles[0].text }
const server = http.createServer((q, r) => { const n = q.url.split('?')[0].slice(1); if (scripts[n]) { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(scripts[n]) } r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>${Object.keys(scripts).map(s => `<script src="/${s}"></script>`).join('')}`) }).listen(8801)
const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8')

export async function open({ width = 1400, height = 1000, mobile = false } = {}) {
  const browser = await chromium.launch({ executablePath: chrome })
  const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile })
  const state = await installResearchRoutes(page, { mode: 'ok', requests: [] })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8801/market-intelligence'); await page.addStyleTag({ content: css })
  await page.getByRole('tab').first().waitFor({ timeout: 20000 })
  return { browser, page, state, errors, shot: (n, full = true) => page.screenshot({ path: path.join(out, `${n}.png`), fullPage: full }) }
}

/** Every interactive control on the page with its accessible name and state. */
export const inventory = page => page.evaluate(() => [...document.querySelectorAll('button,a[href],input,select,textarea,[role=tab],summary')].filter(e => e.offsetParent !== null).map(e => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), name: (e.getAttribute('aria-label') || document.querySelector(`label[for="${e.id}"]`)?.textContent || e.textContent || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 70), disabled: e.disabled === true })))

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const s = await open()
  await s.shot('01-entrada')
  const inv = await inventory(s.page)
  writeFileSync(path.join(out, 'inventory-entrada.json'), JSON.stringify(inv, null, 1))
  console.log(`controls on entry: ${inv.length}; errors: ${s.errors.length}; requests: ${JSON.stringify(s.state.requests)}`)
  await s.browser.close(); server.close()
}
