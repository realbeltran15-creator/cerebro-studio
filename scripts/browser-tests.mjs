/**
 * Browser tests that need a real Chromium (MediaRecorder, WebAudio, canvas, pointer input).
 * Run with `npm run test:browser`. Uses CHROMIUM_PATH or the Playwright browsers directory.
 * Supabase and next/* are replaced by in-memory mocks; nothing leaves the machine.
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, readFileSync, readdirSync } from 'fs'
import http from 'http'
import path from 'path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const dir = path.join(root, 'tests/browser')
const chrome = process.env.CHROMIUM_PATH || (() => {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  const d = existsSync(base) && readdirSync(base).find(n => /^chromium-\d+/.test(n))
  return d ? path.join(base, d, 'chrome-linux/chrome') : null
})()
if (!chrome || !existsSync(chrome)) { console.log('Chromium not found (set CHROMIUM_PATH); browser tests skipped.'); process.exit(0) }

async function bundle(entry) {
  const out = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': root },
    plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /^next\/(link|navigation)$/ }, () => ({ path: path.join(dir, 'mocks/next.tsx') }))
      b.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: path.join(dir, 'mocks/supabase.ts') }))
    } }],
  })
  return out.outputFiles[0].text
}

function serve(port, scripts) {
  return http.createServer((q, r) => {
    const name = q.url.split('?')[0].slice(1)
    if (scripts[name]) { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(scripts[name]) }
    r.writeHead(200, { 'content-type': 'text/html' })
    r.end(`<!doctype html><meta charset="utf-8"><div id="root"></div>${Object.keys(scripts).map(s => `<script src="/${s}"></script>`).join('')}`)
  }).listen(port)
}

const failures = []
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failures.push(name) }
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })

// 1. Renderer: image + video montage with trims, cut, mute, crop, text, subtitles and audio.
{
  const server = serve(8791, { 'r.js': await bundle(path.join(dir, 'renderer-video.harness.ts')) })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:8791/')
  const r = await page.evaluate(() => window.runTest())
  const near = (rgb, want, tol = 40) => rgb && rgb.every((v, i) => Math.abs(v - want[i]) <= tol)
  check('renderer: image clip colour', near(r.samples.c1, [192, 57, 43]), r.samples.c1)
  check('renderer: text overlay drawn', r.samples.textCenter > 1000, r.samples.textCenter)
  check('renderer: trim-in 1000 shows source second 1-2', near(r.samples.c2, [0, 200, 0]), r.samples.c2)
  check('renderer: trim-in 3000 shows source second 3-4', near(r.samples.c3, [200, 200, 0]), r.samples.c3)
  check('renderer: zoom 1.5 + focusX 0 keeps the left half', near(r.samples.c4, [255, 0, 255]), r.samples.c4)
  check('renderer: cut shows a frame, not black', r.samples.cutEdge.reduce((a, b) => a + b) > 150, r.samples.cutEdge)
  check('renderer: fade goes to black', r.samples.fadeEdge.reduce((a, b) => a + b) < 90, r.samples.fadeEdge)
  check('renderer: subtitles drawn', r.samples.caption > 500, r.samples.caption)
  check('renderer: duration ≈ 8 s at 1280x720', Math.abs(r.duration - 8) < 0.5 && r.size[0] === 1280, [r.duration, r.size])
  check('renderer: video clip audio present', r.audio.video440_clip2 > 0.1 && r.audio.video440_clip1 < 0.01, r.audio)
  check('renderer: muted clip is silent', r.audio.video880_clip4_muted < 0.01, r.audio)
  check('renderer: linked voice only in its clip', r.audio.voice220_clip1 > 0.1 && r.audio.voice220_clip3 < 0.01, r.audio)
  await page.close(); server.close()
}

// 2. Manual editor UI driven like a user, saving and rendering through mocked Supabase.
{
  const server = serve(8792, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', d => d.accept())
  const clips = page.locator('[aria-label="Pista de vídeo"] > div')
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
  await page.goto('http://127.0.0.1:8792/editor/manual?job=job1')
  await page.getByText('Montaje abierto en modo manual').waitFor({ timeout: 20000 })
  check('manual: voices moved to the voice track', await page.locator('[aria-label="Pista de Voz"] > div').count() === 2)
  await clips.nth(1).click()
  await page.getByPlaceholder(/1 –/).fill('1.5')
  await page.getByRole('button', { name: 'Dividir' }).click()
  check('manual: split creates a clip', await clips.count() === 4)
  const box = await page.locator('[aria-label="Cambiar duración"]').first().boundingBox()
  await page.mouse.move(box.x + 4, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 44, box.y + 20, { steps: 8 }); await page.mouse.up()
  check('manual: dragging the edge resizes (+1 s)', (await clips.first().getAttribute('title')).endsWith('3 s'))
  await page.getByRole('button', { name: 'Deshacer' }).click()
  check('manual: undo', (await clips.first().getAttribute('title')).endsWith('2 s'))
  await page.getByRole('button', { name: 'Rehacer' }).click()
  check('manual: redo', (await clips.first().getAttribute('title')).endsWith('3 s'))
  await clips.last().click()
  await page.getByLabel('Texto en pantalla').fill('FIN')
  await page.getByLabel('Transición al siguiente').selectOption('cut')
  await page.getByRole('button', { name: 'Duplicar' }).click()
  check('manual: duplicate', await clips.count() === 5)
  await clips.last().click(); await page.keyboard.press('Delete')
  check('manual: delete with keyboard', await clips.count() === 4)
  await page.locator('label', { hasText: /^Audio/ }).locator('select').selectOption('mus')
  await page.locator('label', { hasText: /^Pista/ }).locator('select').selectOption('music')
  await clips.first().click()
  await page.getByRole('button', { name: /Añadir al inicio/ }).click()
  await page.locator('[aria-label="Pista de Música"] > div').first().waitFor()
  await page.getByRole('button', { name: 'Guardar montaje' }).click()
  await page.getByText('Montaje guardado.').waitFor()
  const stored = (await db()).render_jobs[0].composition
  check('manual: saved as manual edit with split trims', stored.editedManually === true && stored.clips[2].trimInMs === 1500 && stored.clips[3].text?.content === 'FIN', stored.clips)
  check('manual: saved audio tracks', stored.audioClips.map(a => a.kind).join() === 'voice,voice,music', stored.audioClips)
  await clips.nth(2).click()
  await page.getByText('Vista previa desde el clip seleccionado').click()
  check('manual: partial preview hides rendering', await page.getByRole('button', { name: /Renderizar y guardar/ }).count() === 0)
  await page.getByText('Vista previa desde el clip seleccionado').click()
  await page.getByRole('button', { name: /Renderizar y guardar/ }).click()
  await page.getByText(/Vídeo guardado en la Biblioteca/).waitFor({ timeout: 60000 })
  const final = await db()
  const out = final.assets.find(a => a.source_provider === 'browser-render')
  check('manual: render completed and saved', final.render_jobs.some(j => j.status === 'completed' && j.output_asset_id === out?.id) && out.provenance.settings.editedManually === true, final.render_jobs)
  check('manual: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

await browser.close()
if (failures.length) { console.error(`${failures.length} browser check(s) failed`); process.exit(1) }
console.log('All browser checks passed.')
