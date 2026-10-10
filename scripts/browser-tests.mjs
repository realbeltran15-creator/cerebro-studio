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

async function bundle(entry, stdinContents, extraDefine = {}) {
  const out = await build({
    ...(stdinContents ? { stdin: { contents: stdinContents, resolveDir: root, loader: 'tsx' } } : { entryPoints: [entry] }), bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': JSON.stringify(process.env.TEST_FFMPEG_CORE_BASE_URL ?? ''), ...extraDefine }, alias: { '@': root },
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
  // Aprende de mí: record a session, learn the style, save it and apply it.
  await page.getByRole('button', { name: /Grabar mi forma de editar/ }).click()
  await clips.first().click()
  await page.getByLabel('Transición al siguiente').selectOption('cut')
  await page.getByLabel(/^Zoom \(/).first().fill('1.3')
  check('learn: actions recorded while editing', await page.getByText(/Grabando · [1-9]/).count() === 1)
  await page.getByRole('button', { name: /Terminar y aprender/ }).click()
  await page.getByText('Esto es lo que he visto:').waitFor()
  await page.getByRole('button', { name: 'Guardar como estilo' }).click()
  await page.getByText('Estilo guardado en tu cuenta.').waitFor()
  const savedStyle = (await db()).connector_configs?.[0]?.config?.styles?.[0]
  check('learn: style stored for the owner', savedStyle?.name === 'Mi estilo' && savedStyle.samples === 1, savedStyle)
  await page.getByRole('button', { name: 'Aplicar a este montaje' }).click()
  await page.getByText(/Estilo aplicado/).waitFor()
  check('learn: style applied (undoable)', await page.getByText(/Estilo aplicado \(puedes deshacerlo\)/).count() === 1)
  await page.getByRole('button', { name: /Renderizar y guardar/ }).click()
  await page.getByText(/Vídeo guardado en la Biblioteca/).waitFor({ timeout: 60000 })
  const final = await db()
  const out = final.assets.find(a => a.source_provider === 'browser-render')
  check('manual: render completed and saved', final.render_jobs.some(j => j.status === 'completed' && j.output_asset_id === out?.id) && out.provenance.settings.editedManually === true, final.render_jobs)
  check('manual: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 3. Creation Studio: model availability, scene prefill, cost confirmation, queued job → preview.
{
  const server = serve(8793, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'studio.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8793/studio?project=p1')
  await page.getByRole('radio', { name: /FLUX\.2 Pro/ }).waitFor({ timeout: 20000 })
  check('studio: unconfigured model is marked', (await page.getByRole('radio', { name: /^OpenAI GPT ImageSin clave/ }).textContent()).includes('Sin clave'))
  await page.getByLabel('Cómo elegir el modelo').selectOption('free_only')
  await page.getByLabel('Calidad necesaria').selectOption('3')
  check('studio: "solo gratis" picks the free Cloudflare model', (await page.getByRole('radio', { checked: true }).textContent()).includes('FLUX.2 klein 4B'))
  check('studio: tier badges are shown', (await page.getByRole('radio', { name: /^FLUX\.1 schnell/ }).textContent()).includes('Gratis') && (await page.getByRole('radio', { name: /^Nano Banana Pro \(Gemini\)/ }).first().textContent()).includes('De pago'))
  await page.getByRole('radio', { name: /FLUX\.2 Pro/ }).click()
  await page.getByLabel('Escena (opcional)').selectOption('s2')
  await page.getByRole('button', { name: 'Usar texto de la escena' }).click()
  check('studio: scene text fills the prompt', (await page.getByLabel('Describe la imagen').inputValue()).includes('selva peruana'))
  await page.getByRole('button', { name: '9:16 Shorts' }).click()
  await page.getByRole('radio', { name: /FLUX\.2 Pro/ }).click()
  await page.getByRole('button', { name: /^Generar imagen/ }).click()
  check('studio: asks to confirm the cost first', await page.getByRole('alertdialog').count() === 1 && (await page.evaluate(() => window.__GEN.length)) === 0)
  await page.getByRole('button', { name: 'Confirmar y generar' }).click()
  await page.getByText(/trabajo enviado/).waitFor()
  const sent = await page.evaluate(() => window.__GEN[0])
  check('studio: request carries model, scene, format and style', sent.modelId === 'fal:fal-ai/flux-2-pro' && sent.sceneId === 's2' && sent.options.format === '9:16' && sent.preset === 'documentary', sent)
  await page.getByText(/listo y guardado en la Biblioteca/).waitFor({ timeout: 20000 })
  check('studio: result previews in the stage', (await page.locator('.stage img').getAttribute('src'))?.startsWith('blob:'))
  check('studio: result appears in project history', await page.locator('.thumbGrid .thumb').count() === 1)
  // Image modes, evidence and character references.
  await page.getByRole('button', { name: 'Modo gratis' }).click()
  check('studio: free mode selects the free FLUX.2 klein model', (await page.getByRole('radio', { checked: true }).textContent()).includes('FLUX.2 klein 4B'))
  check('studio: free model shows its daily Cloudflare allowance and evidence', (await page.getByRole('radio', { checked: true }).textContent()).includes('Crédito diario') && (await page.getByRole('radio', { checked: true }).textContent()).includes('Documentado'))
  await page.getByRole('button', { name: 'Máxima calidad' }).click()
  const top = await page.getByRole('radio', { checked: true }).textContent()
  check('studio: max-quality mode picks a paid top model and says it is paid', top.includes('De pago') && top.includes('★★★★★'), top)
  await page.getByRole('radio', { name: /^FLUX\.2 klein 4B/ }).click()
  check('studio: manual choice leaves the mode', await page.getByRole('button', { name: 'Modo gratis', pressed: true }).count() === 0)
  check('studio: reference section appears for a model that takes references', await page.locator('.refBox').count() === 1)
  check('studio: unverified/unconfigured model is not offered silently', (await page.getByRole('radio', { name: /Cloudflare\) · gratis, más calidad/ }).textContent()).includes('Sin verificar'))
  await page.locator('.refBox .thumb').first().click()
  await page.getByLabel(/Descripción fija del personaje/).fill('Juliane, 17 años, pelo largo rubio, vestido blanco')
  await page.getByRole('button', { name: /^Generar imagen/ }).click()
  await page.getByRole('button', { name: 'Confirmar y generar' }).click()
  await page.getByText(/trabajo enviado|listo y guardado/).first().waitFor()
  const sent2 = await page.evaluate(() => window.__GEN[window.__GEN.length - 1])
  check('studio: request carries reference ids, identity and the klein model', sent2.modelId === 'cloudflare:@cf/black-forest-labs/flux-2-klein-4b' && sent2.referenceAssetIds?.[0] === 'gen1' && /Juliane/.test(sent2.identity), sent2)
  // Out of credits: the page proposes a free alternative and sends nothing by itself.
  await page.evaluate(() => { window.__FORCE_EXHAUSTED = true })
  await page.getByRole('button', { name: /^Generar imagen/ }).click()
  await page.getByRole('button', { name: 'Confirmar y generar' }).click()
  await page.getByText(/Alternativa gratuita compatible/).waitFor()
  const before = await page.evaluate(() => window.__GEN.length)
  check('studio: exhausted allowance suggests a free alternative and lists paid options as needing authorization', (await page.getByRole('status', { name: 'Alternativas' }).textContent()).includes('solo con tu autorización'))
  await page.getByRole('button', { name: /Usar FLUX\.1 schnell \(Cloudflare\) \(gratis\)/ }).click()
  check('studio: choosing the alternative switches the model without generating', (await page.getByRole('radio', { checked: true }).textContent()).includes('FLUX.1 schnell') && (await page.evaluate(() => window.__GEN.length)) === before)
  await page.evaluate(() => { window.__FORCE_EXHAUSTED = false })
  await page.getByRole('button', { name: /^Voz/ }).click()
  check('studio: TopMediai voice is marked unverified and without key', await page.getByRole('radio', { name: /TopMediai Voz/ }).textContent().then(t => t.includes('Sin verificar') && t.includes('Sin clave')))
  await page.getByRole('button', { name: /Música/ }).click()
  check('studio: music tab lists ElevenLabs Music as ready', (await page.getByRole('radio', { name: /ElevenLabs Music/ }).textContent()).includes('Listo'))
  check('studio: live ElevenLabs balance is shown', await page.getByText(/29,000 de 30,000 créditos|29.000 de 30.000 créditos/).count() === 1)
  await page.getByRole('button', { name: /Ambientes/ }).click()
  check('studio: ambient tab offers looping ambiences', (await page.getByRole('radio', { name: /Ambientes en bucle/ }).textContent()).includes('Créditos incluidos'))
  await page.getByText(/Alternativas gratuitas/).click()
  await page.getByLabel('Buscar en el banco').fill('jungle night')
  await page.getByRole('button', { name: 'Buscar' }).click()
  await page.getByRole('button', { name: 'Importar' }).click()
  await page.getByText(/Importado con su licencia/).first().waitFor()
  const imp = await page.evaluate(() => window.__IMPORTS[0])
  check('studio: free bank import carries source, id, project and type', imp.source === 'freesound' && imp.id === '42' && imp.projectId === 'p1' && imp.as === 'sfx', imp)
  check('studio: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 4. Mobile: the Studio fits a 390 px phone without horizontal scrolling and keeps the main action reachable.
{
  const server = serve(8794, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'studio.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  await page.goto('http://127.0.0.1:8794/studio?project=p1')
  await page.addStyleTag({ content: readFileSync(path.join(root, 'app/globals.css'), 'utf8') })
  await page.getByRole('radio', { name: /FLUX\.2 Pro/ }).waitFor({ timeout: 20000 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('mobile: studio has no horizontal overflow at 390 px', overflow <= 1, overflow)
  const btn = page.getByRole('button', { name: /^Generar imagen/ })
  await btn.scrollIntoViewIfNeeded()
  check('mobile: generate button is visible and within the viewport', await btn.isVisible() && (await btn.boundingBox()).x >= 0)
  await page.close(); server.close()
}

// 5. Mobile smoke: every client page mounts at 390 px with the seeded mock database, shows no horizontal overflow and throws no page errors.
{
  const pages = [
    ['/', 'app/page', '/'], ['/projects', 'app/projects/page', '/projects'], ['/projects/[id]', 'app/projects/[id]/page', '/projects/p1', { id: 'p1' }],
    ['/opportunities', 'app/opportunities/page', '/opportunities'], ['/market-intelligence', 'app/market-intelligence/page', '/market-intelligence'],
    ['/radar', 'app/radar/page', '/radar'], ['/scripts', 'app/scripts/page', '/scripts?project=p1'], ['/create', 'app/create/page', '/create?project=p1'],
    ['/editor', 'app/editor/page', '/editor?project=p1'], ['/editor/auto', 'app/editor/auto/page', '/editor/auto?project=p1'], ['/repurpose', 'app/repurpose/page', '/repurpose?project=p1'],
    ['/audio', 'app/audio/page', '/audio?project=p1'], ['/thumbnails', 'app/thumbnails/page', '/thumbnails?project=p1'], ['/library', 'app/library/page', '/library'],
    ['/usage', 'app/usage/page', '/usage'], ['/youtube', 'app/youtube/page', '/youtube?project=p1'], ['/social', 'app/social/page', '/social?project=p1'],
    ['/analytics', 'app/analytics/page', '/analytics'], ['/automations', 'app/automations/page', '/automations'], ['/connectors', 'app/connectors/page', '/connectors'],
  ]
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8')
  for (const [name, mod, url, params] of pages) {
    let code
    try { code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/${mod}'\ncreateRoot(document.getElementById('root')).render(<Page />)`) } catch (e) { check(`mobile: ${name} bundles`, false, String(e.message).slice(0, 160)); continue }
    const server = serve(8795, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + (params ? `\nwindow.__PARAMS = ${JSON.stringify(params)}` : ''), 'app.js': code })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:8795${url}`)
    await page.addStyleTag({ content: css })
    await page.waitForTimeout(700)
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, text: document.body.innerText.length, wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('table,pre,code,[style*="overflow"],.tableWrap')).slice(0, 3).map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`) }))
    check(`mobile: ${name} fits 390 px`, m.over <= 1 && m.text > 20, m)
    check(`mobile: ${name} has no page errors`, errors.length === 0, errors.slice(0, 2))
    await page.addScriptTag({ content: readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') })
    const axeResult = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.[0] })))
    if (process.env.AXE_REPORT) console.log(`  axe ${name}:`, JSON.stringify(axeResult))
    // document-title and html-has-lang belong to app/layout.tsx, which this harness does not mount (the real layout sets both).
    const blocking = axeResult.filter(v => !['document-title', 'html-has-lang'].includes(v.id))
    check(`a11y: ${name} has no WCAG A/AA violations (contrast, names, labels)`, blocking.length === 0, blocking)
    await page.close(); server.close()
  }
}

// 6. Mobile: the manual editor with a populated project (timeline, tracks, inspector) fits a 390 px phone and passes axe.
{
  const server = serve(8796, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8796/editor/manual?job=job1')
  await page.addStyleTag({ content: readFileSync(path.join(root, 'app/globals.css'), 'utf8') })
  await page.getByText('Montaje abierto en modo manual').waitFor({ timeout: 20000 })
  await page.waitForTimeout(500)
  const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('[style*="overflow"],.timeline,[aria-label*="tiempo"],[aria-label^="Pista"]')).slice(0, 4).map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`) }))
  check('mobile: manual editor with data fits 390 px', m.over <= 1, m)
  await page.addScriptTag({ content: readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') })
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.filter(x => !['document-title', 'html-has-lang'].includes(x.id)).map(x => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, sample: x.nodes[0]?.target?.[0] })))
  check('a11y: manual editor with data has no WCAG A/AA violations', v.length === 0, v)
  check('mobile: manual editor has no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 7. Mobile with awkward, populated data (long titles, long unbroken URLs, many rows): no overflow, no errors, axe clean.
{
  const populated = [['/opportunities', 'app/opportunities/page', '/opportunities'], ['/library', 'app/library/page', '/library'], ['/projects', 'app/projects/page', '/projects'],
    ['/projects/[id]', 'app/projects/[id]/page', '/projects/p1', { id: 'p1' }], ['/studio', 'app/studio/page', '/studio?project=p1'], ['/thumbnails', 'app/thumbnails/page', '/thumbnails?project=p1'], ['/youtube', 'app/youtube/page', '/youtube?project=p1']]
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8')
  const axeSrc = readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8')
  for (const [name, mod, url, params] of populated) {
    const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/${mod}'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
    const setup = readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + '\n;' + readFileSync(path.join(dir, 'populated.seed.js'), 'utf8') + (params ? `\nwindow.__PARAMS = ${JSON.stringify(params)}` : '')
    const server = serve(8797, { 'setup.js': setup, 'app.js': code })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:8797${url}`)
    await page.addStyleTag({ content: css })
    await page.waitForTimeout(900)
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, rows: document.querySelectorAll('article,.listItem,.thumb,tr').length, wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('table,pre,code,[style*="overflow"],.tableWrap')).slice(0, 3).map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`) }))
    check(`mobile (populated): ${name} fits 390 px`, m.over <= 1, m)
    check(`mobile (populated): ${name} has no page errors`, errors.length === 0, errors.slice(0, 2))
    await page.addScriptTag({ content: axeSrc })
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.filter(x => !['document-title', 'html-has-lang'].includes(x.id)).map(x => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, sample: x.nodes[0]?.target?.[0] })))
    check(`a11y (populated): ${name} has no WCAG A/AA violations`, v.length === 0, v)
    await page.close(); server.close()
  }
}

// 8. Repurpose with a real saved edit: suggestion, hook draft, packaging draft and platform limits through the UI.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/repurpose/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const setup = readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + '\n;' + readFileSync(path.join(dir, 'populated.seed.js'), 'utf8')
  const server = serve(8798, { 'setup.js': setup, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8798/repurpose?project=p1')
  await page.addStyleTag({ content: readFileSync(path.join(root, 'app/globals.css'), 'utf8') })
  await page.getByRole('button', { name: 'Sugerir para Instagram Reels' }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Sugerir para Instagram Reels' }).click()
  await page.getByText(/Sugerencia para Instagram Reels/).waitFor()
  const checked = await page.locator('input[type="checkbox"]:checked').count()
  check('repurpose: suggestion selects a coherent run of scenes', checked >= 2 && checked <= 3, checked)
  check('repurpose: hook is drafted from the narration', (await page.getByLabel(/Hook en pantalla/).inputValue()).includes('¿Por qué nadie sobrevivió'))
  check('repurpose: suggestion is labelled as calculated, not AI', await page.getByText('Calculado, no IA').count() >= 2)
  check('repurpose: packaging draft is shown', await page.getByText(/Borrador de título y descripción/).count() === 1)
  check('repurpose: no horizontal overflow at 390 px', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1)
  check('repurpose: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 9. Analytics learning panel: outperformers, retention and honesty labels from seeded YouTube metrics.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/analytics/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const setup = readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + '\n;' + readFileSync(path.join(dir, 'populated.seed.js'), 'utf8')
  const server = serve(8799, { 'setup.js': setup, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8799/analytics')
  await page.addStyleTag({ content: readFileSync(path.join(root, 'app/globals.css'), 'utf8') })
  await page.getByText('Qué ha funcionado').waitFor({ timeout: 20000 })
  check('analytics: outperformer is found with its ratio and project link', await page.getByText(/Vídeo analizado 1 · .*vistas \(\d+(\.\d+)?× la mediana\)/).count() === 1 && await page.locator('a[href="/projects/p1"]').count() >= 1)
  check('analytics: panel is labelled calculated and not causal', await page.getByText('Calculado, no IA').count() === 1 && await page.getByText(/describe qué pasó, no por qué/).count() === 1)
  check('analytics: no horizontal overflow at 390 px', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1)
  check('analytics: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 10. Real conversion VP9/Opus -> H.264/AAC MP4 with ffmpeg.wasm (core served from node_modules only for this test).
{
  const files = {
    '/core/ffmpeg-core.js': ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'text/javascript'],
    '/core/ffmpeg-core.wasm': ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'application/wasm'],
  }
  // The vendored (committed) wrapper is served exactly as the app serves it from /public.
  for (const f of readdirSync(path.join(root, 'public/vendor/ffmpeg')).filter(n => n.endsWith('.js'))) files[`/vendor/ffmpeg/${f}`] = [`public/vendor/ffmpeg/${f}`, 'text/javascript']
  const appJs = await bundle(path.join(dir, 'transcode.entry.ts'))
  const server = http.createServer((q, r) => {
    const name = q.url.split('?')[0]
    if (name === '/app.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(appJs) }
    if (files[name]) { r.writeHead(200, { 'content-type': files[name][1], 'access-control-allow-origin': '*' }); return r.end(readFileSync(path.join(root, files[name][0]))) }
    r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><meta charset="utf-8"><script src="/app.js"></script>')
  }).listen(8800)
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8800/')
  await page.waitForFunction(() => typeof window.runTranscode === 'function')
  const t = await page.evaluate(() => window.runTranscode('http://127.0.0.1:8800/core', '/vendor/ffmpeg'))
  check('transcode: the source really was not H.264 (WebM / VP9)', t.srcType === 'video/webm', t)
  check('transcode: output container is MP4 and was re-encoded to H.264 + AAC (read from the file itself)', t.head === 'ftyp' && t.codecs.video === 'h264' && t.codecs.audio === 'aac', t)
  check('transcode: reported MIME names the real codecs and progress stayed within 0..1', t.mimeCodec === 'h264' && t.progressSeen, t)
  check('transcode: output is a non-trivial file', t.outSize > 2000, t.outSize)
  const bad = await page.evaluate(() => window.runTranscodeBadHost())
  check('transcode: an unreachable converter is reported with a readable message', typeof bad.error === 'string' && /No se pudo cargar el convertidor/.test(bad.error), bad)
  const empty = await page.evaluate(() => window.runTranscodeEmpty())
  check('transcode: an empty video is refused', /vacío/.test(empty.error ?? ''), empty)
  check('transcode: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 11. The editor's render panel end to end: render -> not Instagram-ready -> convert to H.264/AAC -> derived asset with lineage.
{
  const files = {
    '/core/ffmpeg-core.js': ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'text/javascript'],
    '/core/ffmpeg-core.wasm': ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'application/wasm'],
  }
  for (const f of readdirSync(path.join(root, 'public/vendor/ffmpeg')).filter(n => n.endsWith('.js'))) files[`/vendor/ffmpeg/${f}`] = [`public/vendor/ffmpeg/${f}`, 'text/javascript']
  const setup = readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8')
  const appJs = await bundle(path.join(dir, 'manual-editor.entry.tsx'), undefined, { 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': JSON.stringify('http://127.0.0.1:8801/core') })
  const server = http.createServer((q, r) => {
    const name = q.url.split('?')[0]
    if (name === '/setup.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(setup) }
    if (name === '/app.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(appJs) }
    if (files[name]) { r.writeHead(200, { 'content-type': files[name][1] }); return r.end(readFileSync(path.join(root, files[name][0]))) }
    r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/setup.js"></script><script src="/app.js"></script>')
  }).listen(8801)
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', d => d.accept())
  await page.goto('http://127.0.0.1:8801/editor/manual?job=job1')
  await page.getByText('Montaje abierto en modo manual').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /Renderizar y guardar/ }).click()
  await page.getByText(/Vídeo guardado en la Biblioteca/).waitFor({ timeout: 90000 })
  const convert = page.getByRole('button', { name: /Convertir a MP4 compatible/ })
  await convert.waitFor({ timeout: 15000 }).catch(() => undefined)
  const needsConversion = await convert.count()
  check('render panel: a VP9/WebM render is flagged as not Instagram-ready and offers the conversion', needsConversion === 1 && await page.getByText(/Instagram/).count() >= 1)
  if (needsConversion) {
    await convert.click()
    await page.getByText(/MP4 compatible con Instagram guardado/).waitFor({ timeout: 240000 })
    const db = await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
    const original = db.assets.find(a => a.source_provider === 'browser-render')
    const derived = db.assets.find(a => a.source_provider === 'browser-transcode')
    check('render panel: the converted copy is a new asset that keeps lineage and license', Boolean(derived) && derived.provenance.derivedFromAssetId === original?.id && derived.license_status === original?.license_status, { original: original?.id, derived: derived?.provenance })
    check('render panel: the copy is recorded as real H.264 + AAC (not a renamed file)', derived?.provenance.conversion?.codecs?.video === 'h264' && derived?.provenance.conversion?.codecs?.audio === 'aac' && /avc1/.test(derived?.provenance.mimeType ?? ''), derived?.provenance.conversion)
    check('render panel: the original render is kept untouched', original?.provenance.container !== 'mp4' || /avc1/.test(original?.provenance.mimeType ?? ''), original?.provenance.mimeType)
    check('render panel: the conversion button disappears once the compatible copy exists', await page.getByRole('button', { name: /Convertir a MP4 compatible/ }).count() === 0)
  }
  check('render panel: no page errors during render and conversion', errors.length === 0, errors)
  await page.close(); server.close()
}

// 5. TopMediai import: its API is sold apart from the subscriptions, so files are imported by hand and the licence follows the confirmed plan.
{
  const server = serve(8794, { 'app.js': await bundle(path.join(dir, 'topmediai.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8794/')
  await page.getByText('Importar archivos generados en TopMediai').waitFor({ timeout: 20000 })
  check('topmediai import: explains the API is a separate product and nothing is automated', (await page.getByText(/se contrata aparte de tus suscripciones/).count()) === 1 && (await page.getByText(/no se conecta a tu cuenta ni automatiza su web/).count()) === 1)
  check('topmediai import: defaults to restricted until a paid plan is confirmed', await page.getByText(/Restringido \(no comercial\)/).count() === 1)
  await page.getByLabel(/Confirmo que estos archivos se generaron con un plan de pago activo/).check()
  check('topmediai import: confirming a paid plan switches to licensed', await page.getByText(/Se guardarán como «Con licencia»/).count() === 1)
  await page.getByLabel('Plan al generar los archivos').selectOption('free')
  check('topmediai import: choosing the free plan drops the licence back to restricted and hides the confirmation', await page.getByText(/Restringido \(no comercial\)/).count() === 1 && await page.getByLabel(/Confirmo que estos archivos/).count() === 0)
  const wav = Buffer.alloc(44 + 16000 * 2 * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  await page.setInputFiles('#tm-files', [{ name: 'whoosh_impact.wav', mimeType: 'audio/wav', buffer: wav }, { name: 'my-song-final.wav', mimeType: 'audio/wav', buffer: wav }])
  await page.getByLabel('Tipo').first().waitFor({ timeout: 10000 })
  const kinds = await page.getByLabel('Tipo').evaluateAll(els => els.map(e => e.value))
  check('topmediai import: kind is guessed from the file name (effect vs music) and can be changed', kinds.join() === 'sfx,music', kinds)
  check('topmediai import: files listed with title and the import button counts them', (await page.getByRole('button', { name: /Importar 2 archivo/ }).count()) === 1)
  await page.setInputFiles('#tm-files', [{ name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('x') }])
  await page.getByText(/no es un archivo de audio/).waitFor({ timeout: 5000 })
  check('topmediai import: a non-audio download is refused with advice', (await page.getByText(/Descarga el MP3 o WAV desde TopMediai/).count()) === 1)
  check('topmediai import: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 6. Google Flow import: no public Flow API, so the user picks files; nothing is stored until «Importar», and the follow-up is automatic.
{
  const server = serve(8795, { 'setup.js': readFileSync(path.join(dir, 'flow.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'flow.entry.tsx'), undefined, { 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID': 'undefined', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY': 'undefined', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID': 'undefined' }) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8795/')
  await page.getByText('Importar vídeos creados en Google Flow').waitFor({ timeout: 20000 })
  check('flow import: explains there is no public Flow API and that nothing happens until Importar', (await page.getByText(/Flow no ofrece una API pública/).count()) === 1 && (await page.getByText(/Hasta que pulses «Importar» no se lee ni se guarda nada/).count()) === 1)
  check('flow import: Drive picker is disabled without its public identifiers, with the reason shown', await page.getByRole('button', { name: /Elegir de Google Drive/ }).isDisabled() && (await page.getByText(/NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID/).count()) === 1)
  check('flow import: defaults to restricted until the user confirms the origin', (await page.getByText(/«Restringido»: la publicación queda bloqueada/).count()) === 1)
  // A fake MP4 whose sample description says H.264 (stsd box + avc1), and one that says VP9.
  const mp4 = fourcc => { const b = Buffer.alloc(400); b.write('ftyp', 4); b.write('stsd', 100); b.write(fourcc, 116); return b }
  await page.setInputFiles('#flow-files', [{ name: 'flow-clip-h264.mp4', mimeType: 'video/mp4', buffer: mp4('avc1') }, { name: 'flow-clip-vp9.mp4', mimeType: 'video/mp4', buffer: mp4('vp09') }])
  await page.getByText('flow-clip-h264').waitFor({ timeout: 5000 })
  check('flow import: selecting files stores nothing yet', (await page.evaluate(() => window.__DB.assets.length)) === 0 && (await page.evaluate(() => window.__UPLOADS.length)) === 0)
  await page.setInputFiles('#flow-files', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }])
  check('flow import: a non-video file is refused', (await page.getByText(/Formato no admitido/).count()) === 1)
  await page.getByLabel('Prompt usado en Flow (opcional)').fill('A fox running through snow')
  await page.getByLabel(/Confirmo que creé estos vídeos/).check()
  await page.getByRole('button', { name: /Importar 2 seleccionado/ }).click()
  await page.getByText(/2 vídeo\(s\) importados/).waitFor({ timeout: 20000 })
  const assets = await page.evaluate(() => window.__DB.assets)
  const byName = n => assets.find(a => a.provenance.originalFilename === n)
  check('flow import: both videos saved as video assets with the Flow provider', assets.length === 2 && assets.every(a => a.asset_type === 'video' && a.source_provider === 'google-flow-import'), assets)
  check('flow import: declared origin, prompt and AI flag kept as provenance, licence follows the confirmation', byName('flow-clip-h264.mp4').provenance.declaredOrigin === 'google-flow' && byName('flow-clip-h264.mp4').provenance.prompt === 'A fox running through snow' && byName('flow-clip-h264.mp4').provenance.aiGenerated === true && byName('flow-clip-h264.mp4').license_status === 'owned')
  check('flow import: real codecs read from the files, Instagram readiness recorded', byName('flow-clip-h264.mp4').provenance.instagramReady === true && byName('flow-clip-vp9.mp4').provenance.instagramReady === false, assets.map(a => a.provenance.codecs))
  check('flow import: the follow-up steps appear and link to the Editor and the automatic editor', (await page.getByText(/Disponible en el Editor y en el Editor automático/).count()) === 2 && (await page.getByRole('link', { name: 'Abrir en el Editor' }).getAttribute('href')) === '/editor?project=p1' && (await page.getByRole('link', { name: 'Montaje automático' }).getAttribute('href')) === '/editor/auto?project=p1')
  check('flow import: the VP9 file warns that Instagram needs a conversion', (await page.getByText(/convertirlo a MP4 H\.264 \+ AAC/).count()) === 1)
  check('flow import: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

await browser.close()
if (failures.length) { console.error(`${failures.length} browser check(s) failed`); process.exit(1) }
console.log('All browser checks passed.')
