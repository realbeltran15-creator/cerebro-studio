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
import { installResearchRoutes } from '../tests/browser/research-fixtures.mjs'

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
      b.onResolve({ filter: /(^@\/lib|\.\.\/lib|\.\/lib)\/supabase\/client$/ }, () => ({ path: path.join(dir, 'mocks/supabase.ts') }))
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

// Thumbnail text composed on top: real canvas, 1280×720 JPEG, text where asked, too-long text refused.
{
  const server = serve(8787, { 'q.js': await bundle(path.join(dir, 'thumbnail-compose.harness.ts')) })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:8787/')
  const r = await page.evaluate(() => window.runCompose())
  check('thumbnail compose: output is a 1280x720 JPEG', r.w === 1280 && r.h === 720 && r.type === 'image/jpeg', r)
  check('thumbnail compose: text drawn at the bottom, not at the top', r.lowerWhite > 2000 && r.upperWhite === 0, r)
  check('thumbnail compose: unreadably long text is refused', r.threw === true)
  await page.close(); server.close()
}

// 3. Virtual Influencer Studio: automated quality measurements on real media.
{
  const server = serve(8788, { 'q.js': await bundle(path.join(dir, 'influencer-quality.harness.ts')) })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:8788/')
  const r = await page.evaluate(() => window.runTest())
  check('influencer: 800x600 image fails the resolution check', r.image.check === 'fail', r.image)
  check('influencer: 1280x720 video passes resolution', r.stable.res === 'pass', r.stable)
  check('influencer: A/V drift within tolerance passes', r.stable.av.status === 'pass', r.stable.av)
  check('influencer: stable video passes flicker', r.stable.flicker.status === 'pass', r.stable.flicker)
  check('influencer: flickering video fails flicker', r.flickering.flicker.status === 'fail', r.flickering.flicker)
  check('influencer: video without audio fails A/V sync', r.flickering.av === 'fail', r.flickering)
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
  check('studio: free model shows its daily Cloudflare allowance and evidence', (await page.getByRole('radio', { checked: true }).textContent()).includes('Crédito diario') && (await page.getByRole('radio', { checked: true }).textContent()).includes('NO VERIFICADO (documentado)'))
  await page.getByRole('button', { name: 'Máxima calidad' }).click()
  const top = await page.getByRole('radio', { checked: true }).textContent()
  check('studio: max-quality mode picks a paid top model and says it is paid', top.includes('De pago') && top.includes('★★★★★'), top)
  await page.getByRole('radio', { name: /^FLUX\.2 klein 4B/ }).click()
  check('studio: manual choice leaves the mode', await page.getByRole('button', { name: 'Modo gratis', pressed: true }).count() === 0)
  check('studio: reference section appears for a model that takes references', await page.locator('.refBox').count() === 1)
  check('studio: unverified/unconfigured model is not offered silently', (await page.getByRole('radio', { name: /Cloudflare\) · gratis, más calidad/ }).textContent()).includes('NO VERIFICADO'))
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
  check('studio: TopMediai voice is marked unverified and without key', await page.getByRole('radio', { name: /TopMediai Voz/ }).textContent().then(t => t.includes('NO VERIFICADO') && t.includes('Sin clave')))
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

// 3b. Short desde referencia: analysis → plan → storyboard → free-only batch that stops at the first refusal.
{
  const server = serve(8795, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'recreate.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8795/studio/recreate?project=p1')
  const analyse = page.getByRole('button', { name: 'Analizar y crear plan' })
  check('recreate: analysis needs a link or transcript', await analyse.isDisabled())
  await page.getByLabel('Enlace de YouTube').fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
  await analyse.click()
  await page.getByText(/La noche en que el faro/).waitFor()
  check('recreate: request carries url, project and the consistent-characters option', await page.evaluate(() => window.__ANALYZE.url.includes('jNQXAC9IVRw') && window.__ANALYZE.projectId === 'p1' && window.__ANALYZE.consistent === true))
  check('recreate: plan shows 6 scenes, 18 s, 9:16 and the originality figure', (await page.getByText(/6 escenas · 18\.0 s · 9:16/).count()) === 1 && (await page.getByText(/repite 0 %/).count()) === 1)
  await page.getByRole('button', { name: 'Guardar como storyboard' }).click()
  await page.getByText(/Guardado como storyboard vertical 9:16/).waitFor()
  check('recreate: saved plan is the one shown', await page.evaluate(() => window.__SAVED.length === 1 && window.__SAVED[0].plan.scenes.length === 6))
  await page.getByRole('button', { name: 'Generar material gratis' }).click()
  await page.getByText(/Se detuvo el lote/).waitFor()
  const gen = await page.evaluate(() => window.__GEN)
  check('recreate: batch sends character, scene image and scene voice with free models only', gen.length === 4 && gen.slice(0, 3).map(g => g.modelId).join() === 'cloudflare:@cf/black-forest-labs/flux-2-klein-4b,cloudflare:@cf/black-forest-labs/flux-2-klein-4b,gemini:gemini-3.8-flash-tts', gen.map(g => g.modelId))
  check('recreate: scene image uses the character as reference and is tied to its scene', gen[1].referenceAssetIds?.[0] === 'g1' && gen[1].sceneId === 'sc1' && gen[1].options.format === '9:16', gen[1])
  check('recreate: nothing is ever sent with a cost confirmation', gen.every(g => g.confirmedEstimateUsd === undefined))
  check('recreate: after the refusal nothing else is requested and the user is told no paid model was used', gen.length === 4 && (await page.getByText(/no se cambió a ningún modelo de pago/).count()) === 1)
  check('recreate: animation step explains it is manual and lists clip upload', (await page.getByText(/no automatiza Meta AI, Flow ni Canva/).count()) === 1 && (await page.getByLabel(/Clips animados/).count()) === 1)
  check('recreate: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 4. Mobile: the Studio fits a 390 px phone without horizontal scrolling and keeps the main action reachable.
{
  const server = serve(8794, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'studio.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  await page.goto('http://127.0.0.1:8794/studio?project=p1')
  await page.addStyleTag({ content: readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '') })
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
    ['/campaigns', 'app/campaigns/page', '/campaigns'], ['/shorts', 'app/shorts/page', '/shorts'], ['/editor/manual', 'app/editor/manual/page', '/editor/manual'],
  ]
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '')
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
  await page.addStyleTag({ content: readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '') })
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
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '')
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
  const longSeed = `;(() => { const db = window.__DB; const seg = (start, end, text) => ({ start, end, text });
    db.assets.push({ id: 'sub-as1', owner_id: 'u1', project_id: 'p1', asset_type: 'subtitle', storage_path: null, source_provider: 'groq', source_url: null, license_status: 'owned', created_at: '2026-09-30T00:00:00Z',
      provenance: { title: 'Subtítulos', sourceAssetId: 'as1', segments: [seg(0, 8, 'Hola a todos, bienvenidos de nuevo.'), seg(8, 20, 'y hoy hablamos de varias cosas sin orden'), seg(20, 28, '¿Por qué nadie habla del secreto de las pirámides?'), seg(28, 40, 'Durante 4000 años se pensó que las construyeron esclavos, pero no fue así.'), seg(40, 52, 'Los registros muestran salarios, raciones de cerveza y bajas por enfermedad.'), seg(52, 60, 'Eran trabajadores pagados.')] } }) })()`
  const setup = readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + '\n;' + readFileSync(path.join(dir, 'populated.seed.js'), 'utf8') + '\n' + longSeed
  const server = serve(8798, { 'setup.js': setup, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8798/repurpose?project=p1')
  await page.addStyleTag({ content: readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '') })
  await page.getByRole('button', { name: 'Sugerir para Instagram Reels' }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Sugerir para Instagram Reels' }).click()
  await page.getByText(/Sugerencia para Instagram Reels/).waitFor()
  const checked = await page.locator('input[type="checkbox"]:checked').count()
  check('repurpose: suggestion selects a coherent run of scenes', checked >= 2 && checked <= 3, checked)
  check('repurpose: hook is drafted from the narration', (await page.getByLabel(/Hook en pantalla/).inputValue()).includes('¿Por qué nadie sobrevivió'))
  check('repurpose: suggestion is labelled as calculated, not AI', await page.getByText('Calculado, no IA').count() >= 2)
  check('repurpose: packaging draft is shown', await page.getByText(/Borrador de título y descripción/).count() === 1)
  // Long video → Short: a transcribed video proposes windows with reasons; «Crear Short» saves a 9:16 draft with transcript-timed captions.
  const long = page.getByRole('region', { name: 'Shorts desde un vídeo largo' })
  check('repurpose (long video): offers to transcribe videos that have no transcript', await long.getByRole('button', { name: 'Transcribir' }).count() >= 1)
  await long.getByLabel('Vídeo transcrito').selectOption('as1')
  await long.getByLabel('Duración').selectOption('20-58')
  await long.getByText(/puntuación/).first().waitFor({ timeout: 10000 })
  check('repurpose (long video): candidates explain why they were chosen', await long.getByText(/empieza con una pregunta/).count() >= 1)
  await long.locator('li', { hasText: '0:20–' }).getByRole('button', { name: 'Crear Short (borrador 9:16)' }).click()
  await long.getByRole('link', { name: /Abrir en el editor manual/ }).waitFor({ timeout: 10000 })
  const short = (await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))).render_jobs.find(j => j.output_format === '9:16' && j.composition?.clips?.[0]?.visualAssetId === 'as1')
  check('repurpose (long video): the draft trims the source video and carries timed captions', !!short && short.composition.clips[0].trimInMs === 20000 && short.composition.subtitles === true && (short.composition.clips[0].cues ?? []).length >= 2, short?.composition?.clips?.[0])
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
  await page.addStyleTag({ content: readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '') })
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
  // 10c. The GPL-free path (WebCodecs H.264 + AAC) on the same recorded WebM. No ffmpeg core is loaded.
  const coreRequests = []
  page.on('request', r => { if (/ffmpeg-core/.test(r.url())) coreRequests.push(r.url()) })
  const n = await page.evaluate(() => window.runNativeTranscode())
  if (!n.support.video) console.log('  (skip) this Chromium build cannot encode H.264 with WebCodecs', n.support)
  else {
    check('transcode (WebCodecs): WebM/VP9+Opus becomes MP4 H.264 + AAC, read from the file itself', n.srcType === 'video/webm' && n.head === 'ftyp' && n.codecs.video === 'h264' && n.codecs.audio === 'aac' && n.outSize > 2000, n)
    check('transcode (WebCodecs): progress stays within 0..1 and the ffmpeg core was never requested', n.progressSeen && coreRequests.length === 0, { n, coreRequests })
  }
  const g = await page.evaluate(() => window.runNativeGarbage())
  check('transcode (WebCodecs): a file that is not a video is refused with a readable message', typeof g.error === 'string' && !g.error.startsWith('other:'), g)
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
  check('flow import: Drive picker is disabled without its public identifiers, with the reason shown', await page.getByRole('button', { name: /Elegir de Google Drive/ }).isDisabled() && (await page.getByText(/El selector de Google Drive todavía no está activado en este servidor/).count()) === 1 && (await page.getByText(/NEXT_PUBLIC_GOOGLE_PICKER/).count()) === 0)
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
  check('flow import: the follow-up steps appear and open both imported videos in the manual editor (automatic editor only as a secondary option)', (await page.getByText(/Listo para editar en el Editor manual/).count()) === 2 && /^\/editor\/manual\?project=p1&assets=[^&]+,[^&]+$/.test(await page.getByRole('link', { name: 'Editar en el Editor manual' }).getAttribute('href')) && (await page.getByRole('link', { name: 'Montaje automático de un vídeo' }).getAttribute('href')) === '/editor/auto?project=p1')
  check('flow import: the VP9 file warns that Instagram needs a conversion', (await page.getByText(/convertirlo a MP4 H\.264 \+ AAC/).count()) === 1)
  check('flow import: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 7. Shorts factory approval screen: evidence, auto-render on open, approval → private upload with synthetic content declared.
{
  const server = serve(8797, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8'), 'seed.js': readFileSync(path.join(dir, 'shorts.seed.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'shorts.entry.tsx'), undefined, { 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': 'undefined' }) })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const dialogs = []
  page.on('dialog', d => { dialogs.push(d.message()); d.accept() })
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
  await page.goto('http://127.0.0.1:8797/shorts')
  await page.getByRole('heading', { name: 'La cucharadita más pesada del universo' }).waitFor({ timeout: 20000 })
  check('shorts: the prepared Short is selected and shows zero spend', (await page.getByText(/Coste de generación: 0 USD/).count()) === 1)
  check('shorts: verified sources are visible with their links and the rejected one is explained', (await page.getByRole('link', { name: 'nasa.gov' }).count()) === 1 && (await page.getByRole('link', { name: 'esa.int' }).count()) === 1 && (await page.getByText(/Dominio sin clasificar como fiable/).count()) === 1 && (await page.getByText('Fuentes del dato (2 verificadas)').count()) === 1)
  check('shorts: hook/fact controls are shown', (await page.getByText(/Gancho y dato principal en los primeros 2 s/).count()) === 1 && (await page.getByText('Cumple').count()) >= 2)
  check('shorts: interest evidence separates observed, calculated and inferred', (await page.getByText('Observado').count()) >= 1 && (await page.getByText('Calculado').count()) >= 1 && (await page.getByText('Inferido').count()) >= 1)
  check('shorts: missing music is explained without blocking', (await page.getByText(/la búsqueda de música libre no está activada/).count()) === 1 && (await page.locator('details:not([open]) code', { hasText: 'FREESOUND_API_KEY' }).count()) === 1)
  check('shorts: approval is disabled until the render exists', await page.getByRole('button', { name: /Aprobar \(subida privada\)/ }).isDisabled())
  // The render starts by itself when the screen opens and is saved to the Library.
  await page.waitForFunction(() => window.__DB.assets.some(a => a.source_provider === 'browser-render'), null, { timeout: 90000 })
  await page.getByText('Vídeo renderizado y guardado en la Biblioteca.').waitFor({ timeout: 20000 })
  check('shorts: render ran by itself on open and was saved', (await db()).assets.some(a => a.source_provider === 'browser-render'))
  const approveBtn = page.getByRole('button', { name: /Aprobar \(subida privada\)/ })
  check('shorts: approval enabled after the render', await approveBtn.isEnabled())
  check('shorts: nothing was sent to YouTube yet', (await page.evaluate(() => window.__PUBLISH_CALLS.length)) === 0)
  await approveBtn.click()
  await page.getByRole('button', { name: /Subir a YouTube \(privado\)/ }).waitFor({ timeout: 10000 })
  const afterApprove = await db()
  const job = afterApprove.publication_jobs[0]
  check('shorts: the publication job is private, synthetic-declared and tied to the render', job.payload.privacyStatus === 'private' && job.payload.containsSyntheticMedia === true && job.payload.madeForKids === false && afterApprove.assets.find(a => a.id === job.payload.videoAssetId)?.source_provider === 'browser-render', job)
  check('shorts: the description lists the verified sources and not the rejected one', job.payload.description.includes('https://www.nasa.gov/neutron') && !job.payload.description.includes('blog-raro'))
  check('shorts: approval needed an explicit confirmation dialog and recorded APROBAR', dialogs.length === 1 && /PRIVADO/.test(dialogs[0]) && (await page.evaluate(() => window.__PUBLISH_CALLS))[0].body.confirm === 'APROBAR')
  check('shorts: still not uploaded after approving', (await page.evaluate(() => window.__PUBLISH_CALLS.filter(c => c.action === 'publish').length)) === 0 && afterApprove.shorts_factory_items.find(i => i.id === 'it1').status === 'approved')
  await page.getByRole('button', { name: /Subir a YouTube \(privado\)/ }).click()
  await page.getByText(/Subido como privado: https:\/\/www.youtube.com\/watch\?v=dQw4w9WgXcQ/).waitFor({ timeout: 10000 })
  const published = (await db()).shorts_factory_items.find(i => i.id === 'it1')
  check('shorts: upload happens only on the second explicit click and stores the video id', published.status === 'published' && published.video_id === 'dQw4w9WgXcQ' && Boolean(published.published_at), published)
  await page.getByRole('button', { name: /Por qué el cielo es azul/ }).click()
  check('shorts: observed 7-day retention is shown as observed data', (await page.getByText(/71\.4%/).count()) >= 1 && (await page.getByText(/Observado \(YouTube Analytics, 2026-09-21 → 2026-09-27\)/).count()) === 1)
  check('shorts: the learning panel waits for enough measured Shorts', (await page.getByText(/Hacen falta 5 Shorts publicados/).count()) === 1)
  check('shorts: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 8. Manual editor reachable from the main menu: pick a saved edit or start an empty one, with separate tracks.
{
  const server = serve(8798, { 'setup.js': readFileSync(path.join(dir, 'manual-picker.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx'), undefined, { 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': 'undefined' }) })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8798/editor/manual')
  await page.getByRole('heading', { name: 'Montaje nuevo' }).waitFor({ timeout: 20000 })
  check('manual picker: without a job id it offers new and saved edits instead of an error', (await page.getByText(/Falta el montaje/).count()) === 0 && (await page.getByText('Montaje de prueba').count()) === 1)
  check('manual picker: a saved edit links to the editor', (await page.getByRole('link', { name: 'Abrir' }).getAttribute('href')) === '/editor/manual?job=job9')
  await page.getByLabel('Título').fill('Mi corto')
  await page.getByLabel('Formato').selectOption('9:16')
  await page.getByRole('button', { name: 'Crear montaje vacío' }).click()
  await page.waitForURL(/job=new-/, { timeout: 15000 })
  await page.getByRole('button', { name: 'Guardar montaje' }).waitFor({ timeout: 20000 })
  const created = (await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))).render_jobs.find(j => j.composition.title === 'Mi corto')
  check('manual picker: the empty edit is stored as a manual draft in the chosen format', created?.status === 'draft' && created.output_format === '9:16' && created.composition.editedManually === true && created.composition.clips.length === 0, created)
  const tracks = await page.locator('[aria-label^="Pista de"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  check('manual picker: separate tracks for video/images, voice, music and effects', ['Pista de vídeo', 'Pista de Voz', 'Pista de Música', 'Pista de Efectos'].every(t => tracks.includes(t)), tracks)
  // An automatic edit with no voices opens in manual mode as it is: no "voices were moved" notice and nothing to save.
  await page.goto('http://127.0.0.1:8798/editor/manual?job=job9')
  await page.getByRole('button', { name: 'Guardar montaje' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(500)
  check('manual picker: an edit without voices opens without a false "voices moved" notice or unsaved state', (await page.getByText(/las voces pasaron a la pista/).count()) === 0 && (await page.getByText('Cambios sin guardar').count()) === 0)
  check('manual picker: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 9. Investigación: filters are a DRAFT until the one button; that button applies AND runs the search with its cost shown; hidden results are explained.
// The YouTube-backed API routes are MOCKED here (tests/browser/research-fixtures.mjs): no quota is spent; this proves the screen, not the live integration.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/market-intelligence/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '')
  const server = serve(8799, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8'), 'app.js': code })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  const state = { mode: 'ok', requests: [], used: 0 }, requests = state.requests
  page.on('pageerror', e => errors.push(e.message))
  await installResearchRoutes(page, state)
  await page.goto('http://127.0.0.1:8799/market-intelligence')
  await page.addStyleTag({ content: css })
  const tab = name => page.getByRole('tab', { name })
  const pick = async (label, search, option) => { await page.getByRole('button', { name: label, exact: true }).click(); await page.getByLabel(`Buscar en ${label}`).fill(search); await page.getByRole('checkbox', { name: option }).check(); await page.keyboard.press('Escape') }
  const go = () => page.getByRole('button', { name: /^Aplicar/ })
  const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const topicReqs = () => requests.filter(r => r.includes('/topic'))

  // Entering: cheap and automatic; nothing expensive.
  await page.getByText('Corto viral de gatos').first().waitFor({ timeout: 20000 })
  check('research: entering loads only the cheap official chart of one country', requests.filter(r => r.includes('/trending')).length === 1 && requests.every(r => !r.includes('/topic') && !r.includes('/youtube?')), requests)
  check('research: the seven sections (the Comparador was folded into Nichos) are in the navigation, above the filters', (await page.getByRole('tab').count()) === 7 && (await page.getByRole('tab', { name: 'Comparador' }).count()) === 0 && /Qué quieres investigar/.test(await body()) && !/1 · Qué quieres investigar/.test(await body()))
  check('research: the cost of the action is always shown in units AND searches against both daily limits', (await page.getByLabel('Coste de esta acción').count()) >= 1 && /unidades y \d+ búsqueda/.test((await page.getByLabel('Coste de esta acción').first().innerText())) && /10\.000 unidades y 100 búsquedas/.test((await page.getByLabel('Coste de esta acción').first().innerText())))
  check('research: the panel separates what is free from what spends quota, and explains the units', (await page.getByText('Gasta cuota').count()) >= 1 && (await page.getByText('Gratis').count()) >= 1 && (await page.getByText(/¿Qué son las «unidades» de YouTube/).count()) === 1)
  { const legends = await page.locator('legend').allInnerTexts(); const nums = legends.map(l => /^(\d) · /.exec(l)?.[1]).filter(Boolean).map(Number); check('research: filter steps are numbered 1..n without repeats or gaps', nums.length > 0 && nums.every((n, i) => n === i + 1), JSON.stringify(legends)) }
  check('research: the button starts disabled with "Sin filtros"', await go().isDisabled() && (await page.getByText('Sin filtros', { exact: true }).count()) >= 1)
  check('research: discovery names its market, shows the nine recommendation sections, and says analyses are missing instead of inventing them', /Recomendaciones para España/.test(await body()) && (await page.locator('details.recoSection').count()) === 9 && (await page.getByText(/necesitan analizar nichos/).count()) === 1)
  const thumbHrefs = await page.locator('.recoSection .thumb').evaluateAll(els => els.map(e => e.getAttribute('href')))
  check('research: recommendations from the official chart show real videos with the official YouTube thumbnail and a link to YouTube', thumbHrefs.length >= 1 && thumbHrefs.every(h => /^https:\/\/www\.youtube\.com\/watch\?v=/.test(h)) && (await page.locator('.recoSection .thumb img').first().getAttribute('src')).startsWith('https://i.ytimg.com/vi/'), thumbHrefs)

  // Prueba A: draft → one button that applies and loads.
  const before = requests.length
  await pick('Países', 'Estados', /Estados Unidos/); await pick('Países', 'Alemania', /Alemania/); await pick('Países', 'Australia', /Australia/)
  check('research: picking countries runs no query and is marked as not applied', requests.length === before && (await page.getByText('Cambios sin aplicar').count()) >= 1 && (await page.getByText(/siguen con los filtros anteriores/).count()) === 1, requests.slice(before))
  check('research: the button states what it will do and its cost before running', (await go().innerText()).includes('Aplicar y cargar tendencias de 3 países (6 unidades · 0 búsquedas)'))
  await go().click()
  await page.getByText(/Aplicados · 3 activos/).waitFor({ timeout: 20000 })
  await page.getByText('Best gadgets and tech review 2026').first().waitFor({ timeout: 20000 })
  check('research: applying loads exactly the three charts (6 units) and shows the filters as active chips', requests.filter(r => /trending\?region=(US|DE|AU)/.test(r)).length === 3 && (await page.getByRole('button', { name: 'Quitar País: Alemania' }).count()) === 1, requests)
  check('research: the pending badge is gone and the home country data is no longer shown (regression)', (await page.getByText('Cambios sin aplicar').count()) === 0 && (await page.getByText('Corto viral de gatos').count()) === 0)
  await page.getByRole('button', { name: 'Quitar País: Alemania' }).click()
  check('research: removing a country with its chip updates results at once without spending quota', (await page.getByRole('button', { name: 'Quitar País: Alemania' }).count()) === 0 && (await page.getByText(/Aktien kaufen/).count()) === 0 && requests.filter(r => /trending/.test(r)).length === 4)
  check('research: no AND/OR switch for a single value; it appears with two niches, explained on demand', (await page.getByRole('group', { name: 'Lógica de Nichos' }).count()) === 0)
  await pick('Nichos', 'tecno', /Tecnología/); await pick('Nichos', 'inteligencia', /Inteligencia artificial/); await pick('Nichos', 'finan', /Finanzas/)
  check('research: with two or more niches the OR/AND switch appears', (await page.getByRole('group', { name: 'Lógica de Nichos' }).count()) === 1 && (await page.getByText('¿Qué significa?').count()) >= 1)
  await go().click()
  check('research: niches combined with countries narrow the list (no pasta recipe)', (await page.getByText('Receta de pasta fácil').count()) === 0)
  await page.getByLabel('RPM estimado mínimo').fill('10'); await page.getByLabel('RPM estimado máximo').fill('2')
  check('research: an impossible RPM range is explained and blocks the button', (await page.getByRole('alert').getByText(/RPM: el mínimo \(10\) es mayor que el máximo \(2\)/).count()) === 1 && await go().isDisabled())
  await page.getByLabel('RPM estimado máximo').fill(''); await page.getByLabel('RPM estimado mínimo').fill('4'); await go().click()
  check('research: the RPM range appears as an active chip', (await page.getByRole('button', { name: /Quitar RPM estimado/ }).count()) === 1)
  await tab('Monetización').click(); await tab('Tendencias internacionales').click()
  check('research: applied filters survive changing section', (await page.getByRole('button', { name: 'Quitar País: Australia' }).count()) === 1 && (await page.getByRole('button', { name: 'Quitar Nicho: Tecnología' }).count()) === 1)
  await page.getByRole('button', { name: 'Restablecer filtros' }).click()
  check('research: reset clears everything at once', (await page.getByText('Sin filtros', { exact: true }).count()) >= 1 && (await page.getByRole('button', { name: /^Quitar/ }).count()) === 0)

  // Prueba: the button of a search section applies AND searches (the reported problem), with typed topics.
  await tab('Nichos').click()
  const noSearchYet = topicReqs().length
  await page.getByLabel(/Temas o subnichos/).fill('historia medieval, música de moda, tema sin público')
  check('research: typing topics runs nothing, and the plan above the button shows topics, markets and cost (612 units)', topicReqs().length === noSearchYet && (await page.getByText(/Se buscará:/).count()) === 1 && (await page.getByText(/3 análisis nuevos × 204 = 612 unidades/).count()) === 1)
  check('research: the button names the cost and stays disabled until the cost is confirmed', (await go().innerText()).includes('Aplicar y buscar (612 unidades · 6 búsquedas)') && await go().isDisabled())
  await page.getByRole('checkbox', { name: /gastará 612 unidades/ }).check()
  await go().click()
  await page.getByRole('article', { name: 'Análisis de historia medieval' }).waitFor({ timeout: 20000 })
  await page.getByText(/Resultados actualizados: 3 análisis nuevos/).waitFor({ timeout: 20000 })
  const opp = page.getByRole('article', { name: 'Análisis de historia medieval' }), sat = page.getByRole('article', { name: 'Análisis de música de moda' }), none = page.getByRole('article', { name: 'Análisis de tema sin público' })
  check('research: running shows "Resultados actualizados" with the units spent', (await page.getByText(/Resultados actualizados: 3 análisis nuevos \(612 unidades\)/).count()) === 1)
  check('research: demand + little supply = opportunity with its reasons', (await opp.locator('.pill', { hasText: /^Oportunidad$/ }).count()) === 1 && (await opp.getByText(/Demanda 72\/100/).count()) === 1)
  check('research: demand + dominant competition = saturated', (await sat.getByText('Saturado', { exact: true }).count()) === 1)
  check('research: little supply with no demand is NOT an opportunity and says so', (await none.getByText('Sin demanda', { exact: true }).count()) === 1 && (await none.getByText(/no es una oportunidad/).count()) === 1)
  check('research: each card shows market, window, source, date, confidence and evidence kinds', (await opp.getByText(/recientes = últimos 30 días/).count()) === 1 && (await opp.locator('summary', { hasText: /Evidencia y confianza \(media\)/ }).count()) === 1 && (await opp.locator('.pill', { hasText: 'Mundial' }).count()) === 1)
  check('research: one request per topic and no more', topicReqs().length - noSearchYet === 3, requests)
  check('research: each card lists the videos and channels behind the conclusion with links, dates and the researched country and language', (await opp.getByLabel('Vídeos y canales que respaldan').count()) === 1 && (await opp.getByRole('table', { name: 'Vídeos de historia medieval' }).locator('tbody tr').count()) >= 1 && (await opp.getByRole('table', { name: 'Vídeos de historia medieval' }).getByRole('link').count()) >= 2 && /país pedido/.test(await opp.getByLabel('Vídeos y canales que respaldan').innerText()))
  check('research: the income estimate is labelled ESTIMATED, advertising only, with a formula and assumptions, and never presented as real income', (await opp.getByLabel('Ingresos potenciales').count()) === 1 && /solo publicidad/.test(await opp.getByLabel('Ingresos potenciales').innerText()) && /no son ingresos reales/.test(await opp.getByLabel('Ingresos potenciales').innerText()))
  check('research: data, estimates and unknowns are told apart', (await opp.getByLabel('Qué es dato y qué es estimación').count()) === 1 && /DESCONOCIDO/.test((await opp.getByLabel('Qué es dato y qué es estimación').textContent()) ?? ''))
  // Regression: analyses hidden by a filter were dropped silently after a paid run.
  await pick('Nichos', 'tecno', /Tecnología/); await go().click()
  const hid = page.getByRole('status', { name: 'Resultados ocultos por filtros' })
  check('research: analyses excluded by a filter are counted and explained, never dropped silently (regression)', (await hid.getByText(/3 de 3 análisis ocultos por tus filtros/).count()) === 1 && (await hid.getByText(/nichos: 3/).count()) === 1)
  await hid.getByRole('button', { name: /Mostrar todos de todas formas/ }).click()
  // The sample inspector: every video, accepted or not, with link and reason, filterable, exportable.
  const card = page.getByRole('article', { name: 'Análisis de historia medieval' })
  await card.locator('summary', { hasText: /Más detalle/ }).click()
  await card.getByText(/Muestra: 3 vídeos examinados \(1 aceptados · 1 dudosos · 1 descartados\)/).click()
  const tableRows = () => card.getByRole('table', { name: 'Muestra de historia medieval' }).locator('tbody tr')
  check('research: the sample inspector lists every video with its state, link and reason', (await tableRows().count()) === 3 && (await card.getByRole('link', { name: 'Who is Isa? Jesus in the Quran explained' }).getAttribute('href')) === 'https://www.youtube.com/watch?v=s2' && (await card.getByText(/«ISA» aquí es religión \(palabras: jesus, quran\)/).count()) === 1)
  await card.getByRole('button', { name: /^Descartados/ }).click()
  check('research: the inspector filters by state (discarded shows only the discarded one)', (await tableRows().count()) === 1)
  await card.getByRole('button', { name: /^Dudosos/ }).click()
  check('research: dubious videos are explained as «sin pruebas», not as wrong', (await tableRows().count()) === 1 && (await card.getByText('Sin pruebas del significado buscado').count()) === 1)
  const sdl = page.waitForEvent('download'); await card.getByRole('button', { name: 'Descargar muestra (.csv)' }).click()
  const scsv = readFileSync(await (await sdl).path(), 'utf8')
  check('research: the sample can be downloaded with every video', scsv.split('\n').length === 4 && /^estado,motivo,detalle,título,canal,enlace/.test(scsv) && /descartado,sentido/.test(scsv))
  check('research: "show all anyway" brings them back', (await page.getByRole('article', { name: 'Análisis de historia medieval' }).count()) === 1)
  await page.getByRole('button', { name: 'Restablecer filtros' }).click()
  await page.getByText('Resultado del análisis').click()
  await page.getByLabel('Demanda (mín. 0–100)').fill('150')
  check('research: an out-of-range analysis threshold is explained and blocks the button', (await page.getByRole('alert').getByText(/Demanda: el valor tiene que estar entre 0 y 100/).count()) === 1 && await go().isDisabled())
  await page.getByLabel('Demanda (mín. 0–100)').fill('75')
  await page.getByLabel('Competencia (máx. 0–100)').fill('60')
  await go().click()
  const hid2 = page.getByRole('status', { name: 'Resultados ocultos por filtros' })
  check('research: demand and competition thresholds filter the analyses (only the opportunity with demand 72 is out, the saturated one fails competition) and say why', (await page.getByRole('button', { name: 'Quitar Demanda: ≥ 75' }).count()) === 1 && (await hid2.getByText(/demanda: \d/).count()) === 1 && (await hid2.getByText(/competencia: \d/).count()) === 1)
  await page.getByRole('button', { name: 'Quitar Demanda: ≥ 75' }).click(); await page.getByRole('button', { name: 'Quitar Competencia: ≤ 60' }).click()
  check('research: removing the threshold chips brings every analysis back', (await hid2.count()) === 0 && (await page.getByRole('article', { name: /^Análisis de/ }).count()) >= 3)
  await page.getByRole('button', { name: 'Tabla' }).click()
  check('research: table view lists all three topics', (await page.getByRole('cell', { name: 'música de moda' }).count()) === 1)
  await page.getByRole('button', { name: 'Gráfico' }).click()
  check('research: chart view renders', (await page.getByRole('img', { name: /Gráfico de Oportunidad/ }).count()) === 1)
  await page.getByRole('button', { name: 'Tarjetas' }).click()
  const again = requests.length
  await page.getByLabel(/Temas o subnichos/).fill('historia medieval')
  check('research: repeating an analysed topic is free and the button says it will show cached results', (await page.getByText(/Todo está ya guardado de búsquedas anteriores: no gasta cuota/).count()) === 1 && (await go().innerText()).includes('Aplicar y mostrar (ya guardado, gratis)'))
  await go().click()
  check('research: showing cached results makes no request and says nothing new was fetched', requests.length === again && (await page.getByText(/ya estaba todo guardado de antes/).count()) === 1)
  await page.getByLabel('Periodo').selectOption('90')
  check('research: changing the period makes the same topic a new paid analysis with that window', (await page.getByText(/1 análisis nuevo × 204 = 204 unidades/).count()) === 1)
  await go().click()
  await page.getByText(/recientes = últimos 90 días/).first().waitFor({ timeout: 20000 })
  check('research: the 90-day window is sent to the server', requests.some(r => r.includes('/topic') && r.includes('days=90')), requests)
  await page.getByRole('button', { name: 'Restablecer filtros' }).click()

  // No topics typed: the button proposes ideas per market, in each market's language.
  await page.getByLabel(/Temas o subnichos/).fill('')
  await pick('Países', 'Alemania', /Alemania/); await pick('Países', 'Estados', /Estados Unidos/)
  await pick('Nichos', 'inteligencia', /Inteligencia artificial/)
  await page.getByLabel('Ideas por mercado').fill('2')
  check('research: with no typed topics the plan proposes ideas (2 per market × 2 markets = 4 analyses, 816 units) and says they are proposals', (await page.getByText(/ideas propuestas por Cerebro Studio/).count()) === 1 && (await page.getByText(/4 análisis nuevos × 204 = 816 unidades/).count()) === 1)
  await page.getByRole('checkbox', { name: /gastará 816 unidades/ }).check()
  const pre = requests.length
  await go().click()
  await page.getByText(/Resultados actualizados: 4 análisis nuevos/).waitFor({ timeout: 20000 })
  const newTopics = requests.slice(pre).filter(r => r.includes('/topic')).map(r => new URL('http://x' + r).searchParams)
  check('research: German ideas are searched in Germany and English ones in the United States', newTopics.some(p => p.get('region') === 'DE' && p.get('lang') === 'de' && /KI/.test(p.get('q'))) && newTopics.some(p => p.get('region') === 'US' && p.get('lang') === 'en' && /AI/.test(p.get('q'))), newTopics.map(p => p.toString()))
  await page.getByRole('button', { name: 'Restablecer filtros' }).click()

  // Scoped filters per section and Guardadas.
  await tab('Descubrir oportunidades').click()
  const recoSecs = await page.locator('details.recoSection > summary').allInnerTexts()
  check('research: after analysing, the recommendation sections fill with niche cards, each with representative videos and its reason', (await page.getByRole('article', { name: 'Recomendación de nicho: historia medieval' }).count()) >= 1 && (await page.getByRole('article', { name: 'Recomendación de nicho: historia medieval' }).first().locator('.videoTile').count()) >= 2 && (await page.getByText(/Por qué:/).count()) >= 1, recoSecs)
  const allHrefs = await page.locator('.recoSection .thumb').evaluateAll(els => els.map(e => e.getAttribute('href')))
  check('research: the same video is never shown twice on the page (regression: repeated videos across sections)', new Set(allHrefs).size === allHrefs.length && allHrefs.length >= 3, allHrefs)
  check('research: the nine sections follow the requested order', ['mayor demanda', 'desatendidos', 'emergentes', 'monetización', 'menor competencia', 'internacionales', 'canales pequeños', 'Shorts', 'vídeos largos'].every((w, i) => recoSecs[i]?.toLowerCase().includes(w.toLowerCase())), recoSecs)
  await tab('Monetización').click()
  check('research: the Monetización section only offers the filters that act on it', (await page.getByRole('button', { name: 'Idiomas', exact: true }).count()) === 0 && (await page.getByRole('button', { name: 'Países', exact: true }).count()) === 1 && (await page.getByLabel('RPM estimado mínimo').count()) === 1)
  await tab('Guardadas').click()
  check('research: Guardadas shows no filters, only a note', (await page.getByRole('form', { name: 'Filtros de investigación' }).count()) === 0)

  // Keywords with sources.
  await tab('Palabras clave').click()
  check('research: keywords state plainly that there are no search volumes and which sources are missing', (await page.getByText(/no hay volúmenes de búsqueda/).count()) === 1 && (await page.getByText(/Google Trends/).count()) >= 1)
  await page.getByLabel('Palabra clave (hasta 3)').fill('historia medieval')
  check('research: for keywords the button is a search button with the cached cost', (await go().innerText()).includes('Aplicar y mostrar (ya guardado, gratis)'))
  await go().click()
  await page.getByLabel('Ver resultados de').selectOption({ index: 0 })
  check('research: related phrases, questions and emerging terms come with source and date', (await page.getByRole('cell', { name: 'historia medieval' }).count()) >= 1 && (await page.getByText('¿Por qué cayó el imperio?').count()) >= 1 && (await page.getByText(/Fuente: YouTube Data API/).count()) >= 1)
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: /Exportar palabras clave/ }).click()
  check('research: keywords export to CSV', /palabras-clave-historia-medieval\.csv$/.test((await dl).suggestedFilename()))

  // Monetisation: never presented as real.
  await tab('Monetización').click()
  check('research: the three RPM states are explained, and VERIFICADO is declared unavailable', (await page.getByText(/No disponible aún/).count()) === 1 && (await page.locator('.tag.estimado').count()) >= 1 && (await page.locator('.tag.desconocido').count()) >= 1)
  check('research: education scenario = 100k views × $10.22 per 1000 = $1.022 (consistent thousands separator)', (await page.getByRole('table', { name: 'Escenarios de ingresos' }).getByText('$1.022').count()) >= 1 && (await page.getByRole('table', { name: 'Escenarios de ingresos' }).getByText('$10.220').count()) >= 1)
  await page.getByLabel('Nicho para el escenario').selectOption('motor')
  check('research: an unknown niche shows DESCONOCIDO and asks for your own RPM', (await page.getByText(/Este nicho es DESCONOCIDO/).count()) === 1 && (await page.getByRole('table', { name: 'Escenarios de ingresos' }).count()) === 0)
  await page.getByLabel('Tu RPM').fill('4')
  check('research: your own RPM gives exact scenarios (500k × $4 = $2.000)', (await page.getByRole('table', { name: 'Escenarios de ingresos' }).getByText('$2.000').count()) >= 1)
  await page.getByLabel('Tu RPM').fill('')
  await page.getByLabel('Nicho para el escenario').selectOption('gaming'); await page.getByLabel('Formato del escenario').selectOption('short')
  check('research: Shorts apply the disclosed 3–14 % adjustment', (await page.getByText(/Ajuste de Shorts: 3–14 %/).count()) >= 1)
  await page.getByLabel('País de la audiencia').selectOption('CH')
  check('research: Switzerland has no per-country RPM table, so it says nothing instead of inventing a range', (await page.getByText(/Suiza: contenido general/).count()) === 0)
  await page.getByLabel('RPM estimado mínimo').fill('50'); await go().click()
  check('research: an RPM range that matches no niche says so instead of an empty table', (await page.getByText(/Ningún nicho cumple el RPM estimado/).count()) === 1)
  await page.getByRole('button', { name: 'Restablecer filtros' }).click()

  // Same niche in three countries, with differing coverage flagged.
  await tab('Tendencias internacionales').click()
  await pick('Países', 'Estados', /Estados Unidos/); await pick('Países', 'Alemania', /Alemania/); await pick('Países', 'Australia', /Australia/)
  await page.getByLabel('Tema a comparar').fill('historia medieval')
  await page.getByRole('checkbox', { name: /gastará/ }).check().catch(() => {})
  await go().click()
  await page.getByText(/Resultados actualizados: 3 análisis nuevos/).waitFor({ timeout: 30000 })
  await page.getByText(/Mayor oportunidad calculada para/).waitFor({ timeout: 20000 })
  check('research: the same niche is analysed in each of the three markets', (await page.getByRole('article', { name: 'Análisis de historia medieval' }).count()) >= 3)
  check('research: the results warn that coverage is uneven when markets differ (Australia has a small sample)', (await page.getByText(/Cobertura desigual/).count()) === 1)

  // Competition: the search text lives in the panel; one button; cost shown; states.
  await tab('Competencia y canales').click()
  check('research: the video search has no duplicate country/language boxes and says where it will search', (await page.getByLabel('Código de país').count()) === 0 && (await page.getByText(/se busca en/i).count()) >= 1)
  await page.getByLabel('Búsqueda en YouTube').fill('herramientas de inteligencia artificial')
  check('research: the search plan shows its cost for the three markets (306 units, no confirmation needed)', (await page.getByText(/3 mercados × 102 = 306 unidades/).count()) === 1 && (await go().innerText()).includes('Aplicar y buscar (306 unidades · 3 búsquedas)'))
  const sReq = requests.length
  await go().click()
  await page.getByText(/Resultados actualizados: \d+ vídeos/).waitFor({ timeout: 20000 })
  const sr = requests.slice(sReq).filter(r => r.includes('/youtube?'))
  check('research: one search request per applied market', sr.length === 3 && sr.every(r => r.includes('max=25')) && ['US', 'DE', 'AU'].every(c => sr.some(r => r.includes(`region=${c}`))), sr)
  state.mode = 'down'
  await go().click()
  await page.getByRole('alert').getByText(/Consulta fallida/).first().waitFor({ timeout: 10000 }).catch(() => {})
  check('research: a failed search is reported as failed with the reason and offers a retry', (await page.getByRole('alert').getByText(/Consulta fallida: .*YOUTUBE_API_KEY/).count()) >= 1 && (await page.getByRole('button', { name: 'Reintentar lo que falló' }).count()) >= 1)
  // The failure notice belongs to the section where it happened: changing section drops it.
  await tab('Palabras clave').click()
  check('research: a failure notice does not follow the person to another section', (await page.getByRole('alert').getByText(/Consulta fallida/).count()) === 0 && (await page.getByRole('button', { name: 'Reintentar lo que falló' }).count()) === 0)
  state.mode = 'ok'

  // Budget error.
  state.mode = 'budget'
  await tab('Nichos').click()
  await page.getByLabel(/Temas o subnichos/).fill('tema nuevo')
  await page.getByRole('checkbox', { name: /gastará 612 unidades/ }).check()
  await go().click()
  await page.getByRole('alert').getByText(/Consulta fallida/).first().waitFor({ timeout: 10000 }).catch(() => {})
  check('research: when the daily budget is exhausted the screen says the query failed and why', (await page.getByRole('alert').getByText(/Consulta fallida: .*Presupuesto diario de Investigación agotado/).count()) >= 1)
  state.mode = 'ok'
  await page.getByLabel(/Temas o subnichos/).fill('')

  // Guided research: 20 per market in six markets, as a budgeted, resumable queue, with a report.
  await page.getByRole('button', { name: 'Restablecer filtros' }).click()
  state.used = 0; await page.evaluate(() => localStorage.removeItem('cerebro.research.ledger')); await page.reload(); await page.getByRole('tab').first().waitFor({ timeout: 20000 }); await page.addStyleTag({ content: css }); await tab('Nichos').click()
  for (const [q, o] of [['Estados', /Estados Unidos/], ['Alemania', /Alemania/], ['Australia', /Australia/], ['Reino', /Reino Unido/], ['Canad', /Canadá/], ['Suiza', /Suiza/]]) await pick('Países', q, o)
  check('research: when the button would search, a second button applies the filters without searching', (await page.getByRole('button', { name: 'Solo aplicar filtros (sin buscar)' }).count()) === 1)
  const beforeApply = requests.length
  await page.getByRole('button', { name: 'Solo aplicar filtros (sin buscar)' }).click()
  await page.getByText(/Aplicados · 6 activos/).waitFor({ timeout: 20000 })
  check('research: applying only costs nothing', requests.length === beforeApply)
  // The browser keeps its own tally of what it spent (searches above cost 306 units): start the guided test from a fresh day.
  await page.evaluate(() => localStorage.removeItem('cerebro.research.ledger')); await page.reload(); await page.getByRole('tab').first().waitFor({ timeout: 20000 }); await page.addStyleTag({ content: css }); await tab('Nichos').click()
  const guided = page.getByRole('region', { name: 'Investigación guiada' })
  await guided.getByRole('button', { name: /Preparar plan \(120 análisis\)/ }).click()
  await guided.getByText(/hacen falta/).waitFor({ timeout: 10000 })
  check('research: guided research proposes 20 per market in six markets (120 analyses) and prices the whole plan', (await guided.getByText(/\d+ análisis pendientes × 204 = [\d.]+ unidades/).count()) === 1 && (await guided.getByRole('table', { name: 'Progreso del plan' }).locator('tbody tr').count()) === 6)
  check('research: it tells how many days the plan needs at the daily cap', (await guided.getByText(/hacen falta 5 días/).count()) === 1)
  const used0 = topicReqs().length
  await guided.getByRole('checkbox', { name: /gastará/ }).check()
  await guided.getByRole('button', { name: /Ejecutar lo que cabe hoy \(29 análisis/ }).click()
  await page.getByRole('table', { name: 'Progreso del plan' }).getByRole('cell', { name: '5', exact: true }).first().waitFor({ timeout: 60000 }).catch(() => {})
  await guided.getByText(/Hoy no queda presupuesto/).waitFor({ timeout: 90000 })
  const ran = topicReqs().slice(used0).map(r => new URL('http://x' + r).searchParams)
  check('research: it runs only what fits in today\'s budget (29 × 204 = 5.916 of 6.000 units) and then waits for tomorrow', ran.length === 29 && (await guided.getByText(/Hoy no queda presupuesto para otro análisis/).count()) === 1, ran.length)
  check('research: the first 29 jobs follow the plan order, each market in its own language (US/AU/UK/CA in English, DE/CH in German)', ran.every(p => (['DE', 'CH'].includes(p.get('region')) ? p.get('lang') === 'de' : p.get('lang') === 'en')), ran.map(p => p.toString()).slice(0, 3))
  const rows = await guided.getByRole('table', { name: 'Progreso del plan' }).locator('tbody tr').allInnerTexts()
  check('research: the progress table lists the six markets with planned, done and pending', rows.length === 6 && rows[0].includes('20'), rows)
  const mdDl = page.waitForEvent('download')
  await guided.getByRole('button', { name: 'Exportar informe (Markdown)' }).click()
  const mdFile = await mdDl; const mdPath = await mdFile.path()
  const md = readFileSync(mdPath, 'utf8')
  check('research: the report is generated by the app with method, limits, per-market tables and per-analysis evidence', /Informe de investigación de nichos/.test(md) && /## Método y límites/.test(md) && /## Estados Unidos|## Alemania/.test(md) && /Fecha de consulta/.test(md) && /Parámetros/.test(md))
  check('research: the report never presents RPM as verified and marks editorial viability as not measured', !/RPM verificado:/.test(md) && /criterio editorial, no medido/.test(md) && /ESTIMADO|DESCONOCIDO/.test(md))
  const csvDl = page.waitForEvent('download')
  await guided.getByRole('button', { name: 'Exportar informe (CSV)' }).click()
  const csv = readFileSync(await (await csvDl).path(), 'utf8')
  const doneNow = (await guided.getByRole('table', { name: 'Progreso del plan' }).locator('tbody tr').allInnerTexts()).reduce((t, r) => t + Number(r.split('\t')[2]), 0)
  check('research: the CSV has one row per finished analysis with the promised columns', csv.split('\n').length === doneNow + 1 && doneNow >= 29 && /rpm_estado/.test(csv.split('\n')[0]) && /fuente/.test(csv.split('\n')[0]), { lines: csv.split('\n').length, doneNow })
  // The plan and the analyses survive closing the page (stored in this browser): research can resume another day.
  await page.reload(); await page.getByRole('tab').first().waitFor({ timeout: 20000 }); await page.addStyleTag({ content: css })
  await tab('Nichos').click()
  const guided2 = page.getByRole('region', { name: 'Investigación guiada' })
  const rows2 = await guided2.getByRole('table', { name: 'Progreso del plan' }).locator('tbody tr').allInnerTexts()
  const pend = async () => Number((await guided2.getByText(/\d+ análisis pendientes/).first().innerText()).match(/(\d+) análisis pendientes/)[1])
  const pending1 = await pend()
  check('research: after a reload the guided plan and its finished analyses are still there', rows2.length === 6 && rows2.reduce((t, r) => t + Number(r.split('\t')[2]), 0) === doneNow && pending1 === 120 - doneNow, { rows2, pending1, doneNow })
  state.used = 0; await page.evaluate(() => localStorage.removeItem('cerebro.research.ledger')); await page.reload(); await page.getByRole('tab').first().waitFor({ timeout: 20000 }); await page.addStyleTag({ content: css }); await tab('Nichos').click()
  await page.getByRole('region', { name: 'Investigación guiada' }).getByText(/ha usado hoy 0 de las/).waitFor({ timeout: 10000 }).catch(async e => { console.log('DEBUG', await page.getByRole('region', { name: 'Investigación guiada' }).getByText(/Hoy has usado/).allInnerTexts(), await page.evaluate(() => localStorage.getItem('cerebro.research.ledger'))); throw e })
  await guided2.getByRole('checkbox', { name: /gastará/ }).check()
  await guided2.getByRole('button', { name: /Ejecutar lo que cabe hoy \(29 análisis/ }).click()
  await guided2.getByText(new RegExp(`${pending1 - 29} análisis pendientes`)).waitFor({ timeout: 90000 })
  check('research: the next day the queue continues where it stopped, skipping what is already analysed (29 more, none repeated)', topicReqs().length - used0 === 58 && (await pend()) === pending1 - 29, { requests: topicReqs().length - used0 })

  // Persistence and favourites.
  check('research: applied filters and the active section survive a reload', (await page.getByRole('button', { name: 'Quitar País: Suiza' }).count()) === 1 && (await page.getByRole('tab', { selected: true }).innerText()) === 'Nichos')
  await page.getByText('Favoritos (0)').click()
  await page.getByLabel('Nombre de la combinación').fill('Mis seis mercados')
  await page.getByRole('button', { name: 'Guardar combinación' }).click()
  await page.getByRole('button', { name: 'Restablecer filtros' }).click()
  await page.getByLabel('Aplicar combinación guardada').selectOption({ label: 'Mis seis mercados' })
  check('research: a saved favourite restores the six countries as applied filters', (await page.getByRole('button', { name: 'Quitar País: Canadá' }).count()) === 1 && (await page.getByRole('button', { name: 'Quitar País: Suiza' }).count()) === 1)
  check('research: no page errors', errors.length === 0, errors)
  await page.close(); await context.close(); server.close()
}

// 10. Campañas: answer the nine questions partially, get a strategy, change budget/platforms without starting again, save, reload, export. No ad API is touched.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/campaigns/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '')
  // Before migration 20261015120000 the `campaigns` table does not exist: the page must keep working from this browser only.
  const server = serve(8800, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + "\nwindow.__MISSING_TABLES = ['campaigns']", 'app.js': code })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = [], outbound = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/campaigns/connections', route => { outbound.push('connections'); return route.fulfill({ json: { networks: [{ network: 'google_ads', credentialsPresent: false, adapterImplemented: false, state: 'no_disponible', message: 'No disponible: faltan la aprobación de la plataforma y la conexión. Puedes diseñar y guardar la campaña igualmente.' }, { network: 'meta_ads', credentialsPresent: false, adapterImplemented: false, state: 'no_disponible', message: 'No disponible: faltan la aprobación de la plataforma y la conexión. Puedes diseñar y guardar la campaña igualmente.' }, { network: 'tiktok_ads', credentialsPresent: false, adapterImplemented: false, state: 'no_disponible', message: 'No disponible: faltan la aprobación de la plataforma y la conexión. Puedes diseñar y guardar la campaña igualmente.' }] } }) })
  page.on('request', r => { if (/(googleads\.googleapis\.com|ads\.google\.com|facebook\.com|business-api\.tiktok\.com|tiktokapis\.com)$/i.test(new URL(r.url()).hostname)) outbound.push(r.url()) })
  await page.goto('http://127.0.0.1:8800/campaigns')
  await page.addStyleTag({ content: css })
  const tab = name => page.getByRole('tab', { name })
  await page.getByRole('button', { name: '+ Nueva campaña' }).first().click()
  check('campaigns: it starts with the nine questions and says none is answered', (await page.getByText('0 de 9 preguntas respondidas').count()) === 1 && (await page.locator('fieldset.campaignQuestion').count()) === 9)
  // Partial answers: only what is known.
  await page.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Un canal' })
  await page.getByLabel('Nombre', { exact: true }).fill('Umbral del Hito')
  await page.getByLabel('Objetivo principal', { exact: true }).selectOption({ label: 'Suscriptores / seguidores' })
  check('campaigns: partial answers are counted (2 of 9)', (await page.getByText('2 de 9 preguntas respondidas').count()) === 1)
  check('campaigns: it recommends how to complete the strategy (platforms, budget pilot, duration)', await page.getByRole('region', { name: 'Recomendaciones para completar la estrategia' }).getByText(/Plataformas sugeridas/).count() === 1 && await page.getByText(/piloto de aprendizaje/).count() === 1 && await page.getByText(/Duración sugerida para este objetivo: 28 días/).count() === 1)
  await page.getByRole('button', { name: 'Usar plataformas sugeridas' }).click()
  await page.getByLabel('Presupuesto total', { exact: true }).fill('900')
  await page.getByLabel('Presupuesto diario máximo', { exact: true }).fill('40')
  await page.getByLabel('Duración (días)', { exact: true }).fill('28')
  await page.getByLabel('Métrica', { exact: true }).selectOption({ label: 'Suscriptores' })
  await page.getByLabel('Cantidad esperada', { exact: true }).fill('600')
  check('campaigns: after answering budget, cap, duration and goal the counter updates (8 of 9, audience still open)', (await page.getByText(/[78] de 9 preguntas respondidas/).count()) === 1)
  await tab('Estrategia').click()
  const wasMode = await page.getByText(/Campaña (mixta|de pago|orgánica)/).first().innerText()
  check('campaigns: the strategy explains each platform with reasons', (await page.locator('article.platformCard').count()) === 6 && (await page.locator('article.platformCard.chosen').count()) >= 2 && (await page.getByText(/criterio editorial/).count()) > 0, wasMode)
  // Modify platforms, goal and budget without starting again.
  await page.getByRole('article', { name: 'Meta Ads (Instagram y Facebook)' }).getByRole('button').click()
  await tab('Presupuesto y calendario').click()
  const split = page.getByRole('table', { name: 'Reparto del presupuesto' })
  check('campaigns: removing Meta Ads recomputes the split: only Google Ads remains as paid, plus the 10 % reserve', (await split.getByText('Reserva').count()) === 1 && (await split.getByText('Meta Ads (Instagram y Facebook)').count()) === 0 && (await split.getByText('Google Ads (YouTube y Búsqueda)').count()) === 1)
  check('campaigns: the calendar shows preparation, test, optimisation, scale and closing', (await page.locator('ol.calendar > li').count()) === 5)
  await tab('Resultados y reglas').click()
  check('campaigns: three scenarios are shown with the warning that they are not real data', (await page.getByRole('table', { name: 'Escenarios' }).locator('tbody tr').count()) === 3 && (await page.getByText(/no con datos reales/).count()) === 1)
  const baseBefore = await page.getByRole('table', { name: 'Escenarios' }).locator('tbody tr').nth(1).innerText()
  await page.getByLabel(/CPM \(EUR por 1.000 impresiones\)/).first().fill('2')
  const baseAfter = await page.getByRole('table', { name: 'Escenarios' }).locator('tbody tr').nth(1).innerText()
  check('campaigns: editing an assumption recomputes the scenarios', baseBefore !== baseAfter)
  check('campaigns: stop, optimise and expand rules are present', (await page.getByRole('heading', { name: 'detener', exact: false }).count()) >= 1 && (await page.getByText('Entonces').count()) >= 5)
  await tab('Brief').click()
  await page.getByLabel('Presupuesto total', { exact: true }).fill('1800')
  await tab('Presupuesto y calendario').click()
  check('campaigns: changing the budget keeps every other answer (no restart)', (await page.getByText(/1\.800 EUR/).count()) >= 1 && (await page.getByText(/28 días/).count()) >= 1)
  // Goal against estimate, project kind and concentration of a thin budget.
  await tab('Resultados y reglas').click()
  check('campaigns: the goal is compared with the estimate and the difference is explained', (await page.getByRole('note', { name: 'Objetivo frente a estimación' }).getByText(/Realista|Ambicioso|Poco realista/).count()) === 1 && (await page.getByText(/lo que quieres conseguir; los escenarios son lo que el presupuesto compra/).count()) >= 1)
  await tab('Brief').click()
  check('campaigns: the project kind is detected and can be changed', (await page.locator('#campaign-kind option').first().innerText()).includes('Detectar automáticamente') && (await page.locator('#campaign-kind option').count()) === 7)
  await tab('Estrategia').click()
  await page.getByRole('article', { name: 'Meta Ads (Instagram y Facebook)' }).getByRole('button').click()
  await tab('Brief').click(); await page.getByLabel('Presupuesto total', { exact: true }).fill('100')
  await tab('Presupuesto y calendario').click()
  const conc = page.getByRole('note', { name: 'Concentración del presupuesto' })
  check('campaigns: a thin budget over two paid platforms is concentrated on one and says why', (await conc.getByText('Presupuesto concentrado en una plataforma.').count()) === 1 && (await page.getByText(/En espera: se activa cuando/).count()) === 1)
  await conc.getByRole('checkbox').check()
  check('campaigns: keeping the split is an explicit exception, and the report records it', (await conc.getByText('Reparto mantenido por excepción.').count()) === 1 && (await page.getByText(/Excepción confirmada por ti/).count()) >= 1)
  await conc.getByRole('checkbox').uncheck()
  await tab('Brief').click(); await page.getByLabel('Presupuesto total', { exact: true }).fill('1800')
  await tab('Conexiones').click()
  await page.getByText(/No disponible: faltan la aprobación/).first().waitFor({ timeout: 10000 })
  check('campaigns: the three ad connections are shown as NOT available with requirements and official docs', (await page.locator('article .stateBadge', { hasText: 'No disponible' }).count()) === 3 && (await page.getByRole('link', { name: 'Documentación oficial' }).count()) === 3 && (await page.getByText('Ninguna conexión publicitaria está activa').count()) === 1)
  await tab('Contenido y creatividades').click()
  check('campaigns: creative pieces link to existing Studio sections', (await page.getByRole('link', { name: 'Abrir Guiones' }).count()) === 1 && (await page.getByRole('link', { name: 'Crear miniaturas' }).count()) <= 1 && (await page.getByRole('link', { name: 'Abrir Editor' }).count()) === 1)
  // Save without a connection, reload, duplicate, export.
  await page.reload(); await page.addStyleTag({ content: css })
  check('campaigns: the campaign is still there after a reload (saved with no ad connection)', (await page.locator('#campaign-select option', { hasText: 'Umbral del Hito' }).count()) === 0 ? (await page.locator('#campaign-select option').count()) === 1 : true)
  await page.getByLabel('Presupuesto total', { exact: true }).waitFor({ timeout: 10000 })
  check('campaigns: the answers survive the reload', (await page.getByLabel('Presupuesto total', { exact: true }).inputValue()) === '1800' && (await page.getByLabel('Nombre', { exact: true }).inputValue()) === 'Umbral del Hito')
  await page.getByRole('button', { name: 'Duplicar' }).click()
  check('campaigns: duplicating creates a second campaign', (await page.locator('#campaign-select option').count()) === 2)
  await tab('Informe').click()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar informe (.md)' }).click()
  const file = await dl
  const text = readFileSync(await file.path(), 'utf8')
  check('campaigns: the exported report has all sections and says nothing was published', file.suggestedFilename().endsWith('.md') && /## 8\. Escenarios estimados/.test(text) && /no se ha publicado ningún anuncio/.test(text) && /## 10\. Conexiones publicitarias/.test(text), file.suggestedFilename())
  // From Investigación: the idea arrives with its evidence, and the URL is cleaned so a reload does not create another campaign.
  const p2 = await context.newPage(); await p2.route('**/api/campaigns/connections', r => r.fulfill({ json: { networks: [] } }))
  await p2.goto('http://127.0.0.1:8800/campaigns?topic=huerto%20en%20casa&country=DE&lang=de&verdict=oportunidad&demand=71&competition=32'); await p2.addStyleTag({ content: css })
  await p2.getByText('Viene de Investigación.').waitFor({ timeout: 10000 })
  check('campaigns: an opportunity sent from Investigación arrives with topic, country and its evidence', (await p2.getByLabel('Nombre', { exact: true }).inputValue()) === 'huerto en casa' && (await p2.getByText(/veredicto de Investigación: oportunidad, demanda 71\/100, competencia 32\/100/).count()) === 1 && (await p2.getByText('2 de 9 preguntas respondidas').count()) + (await p2.getByText('3 de 9 preguntas respondidas').count()) === 1)
  const optionsBefore = await p2.locator('#campaign-select option').count()
  await p2.reload(); await p2.getByLabel('Nombre', { exact: true }).waitFor({ timeout: 10000 })
  check('campaigns: reloading after arriving from Investigación does not create a second campaign', (await p2.locator('#campaign-select option').count()) === optionsBefore)
  await p2.close()
  check('campaigns: without the table it says the account copy is not active yet', (await page.getByText(/guardado en la cuenta aún no está activado/).count()) === 1)
  check('campaigns: no request went to any advertising platform', outbound.every(o => o === 'connections'), outbound)
  check('campaigns: no page errors', errors.length === 0, errors)
  await page.close(); await context.close(); server.close()
}

// 10b. Campañas with the `campaigns` table: legacy browser campaigns are uploaded with uuid ids, account campaigns appear here,
// edits are saved to the account and deleting removes the row. Uses the in-memory mock database; nothing leaves the machine.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/campaigns/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const remote = { id: '11111111-1111-4111-8111-111111111111', owner_id: 'u1', name: 'Remota', status: 'lista', brief: { name: 'Remota', totalBudget: 300 }, notes: '', project_id: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' }
  const server = serve(8801, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + `\nwindow.__DB.campaigns = [${JSON.stringify(remote)}]`, 'app.js': code })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
  await context.addInitScript(() => { try { if (!localStorage.getItem('cerebro.campaigns.v1')) localStorage.setItem('cerebro.campaigns.v1', JSON.stringify([{ id: 'cmp_legacy1', brief: { name: 'Local antigua' }, status: 'borrador', notes: '', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' }])) } catch { /* ignore */ } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/campaigns/connections', r => r.fulfill({ json: { networks: [] } }))
  await page.goto('http://127.0.0.1:8801/campaigns')
  await page.getByText('Guardadas en tu cuenta y en este navegador.').waitFor({ timeout: 10000 })
  const rows = () => page.evaluate(() => (window.__DB.campaigns ?? []).map(r => ({ id: r.id, name: r.name, owner: r.owner_id })))
  let r = await rows()
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  check('campaigns cloud: the account campaign is shown next to the browser one', (await page.locator('#campaign-select option', { hasText: 'Remota' }).count()) === 1 && (await page.locator('#campaign-select option', { hasText: 'Local antigua' }).count()) === 1)
  check('campaigns cloud: the legacy browser campaign is uploaded once, with a uuid id and the owner', r.length === 2 && r.some(x => x.name === 'Local antigua' && uuid.test(x.id) && x.owner === 'u1'), r)
  const local = JSON.parse(await page.evaluate(() => localStorage.getItem('cerebro.campaigns.v1')))
  check('campaigns cloud: the browser copy now uses the same uuid ids', local.length === 2 && local.every(c => uuid.test(c.id)))
  await page.locator('#campaign-select').selectOption({ label: 'Local antigua · borrador' })
  await page.getByLabel('Nombre', { exact: true }).fill('Local editada')
  await page.waitForFunction(() => (window.__DB.campaigns ?? []).some(x => x.brief?.subjectName === 'Local editada'), null, { timeout: 8000 }).catch(() => {})
  check('campaigns cloud: an edit is saved to the account after a short pause', await page.evaluate(() => (window.__DB.campaigns ?? []).some(x => x.brief?.subjectName === 'Local editada')))
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: 'Eliminar' }).click()
  await page.waitForFunction(() => (window.__DB.campaigns ?? []).length === 1, null, { timeout: 8000 })
  r = await rows()
  check('campaigns cloud: deleting removes the row from the account', r.length === 1 && r[0].name === 'Remota', r)
  check('campaigns cloud: no page errors', errors.length === 0, errors)
  await page.close(); await context.close(); server.close()
}

await browser.close()
if (failures.length) { console.error(`${failures.length} browser check(s) failed`); process.exit(1) }
console.log('All browser checks passed.')
