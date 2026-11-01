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
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': JSON.stringify(process.env.TEST_FFMPEG_CORE_BASE_URL ?? ''), 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID': 'undefined', 'process.env.NEXT_PUBLIC_DROPBOX_APP_KEY': 'undefined', 'process.env.NEXT_PUBLIC_CONTACT_EMAIL': 'undefined', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY': 'undefined', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID': 'undefined', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '"http://127.0.0.1:9"', 'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': '"pk-test"', ...extraDefine }, alias: { '@': root },
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
    if (scripts[name]) { r.writeHead(200, { 'content-type': name.endsWith('.css') ? 'text/css' : 'text/javascript' }); return r.end(scripts[name]) }
    r.writeHead(200, { 'content-type': 'text/html' })
    // A «.css» key is the app's real stylesheet (layout tests); everything else is a script.
    r.end(`<!doctype html><meta charset="utf-8">${Object.keys(scripts).filter(s => s.endsWith('.css')).map(s => `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${s}">`).join('')}<div id="root"></div>${Object.keys(scripts).filter(s => !s.endsWith('.css')).map(s => `<script src="/${s}"></script>`).join('')}`)
  }).listen(port)
}

const failures = []
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failures.push(name) }
// Editor workspace: open a collapsible property group / a tool tab the way a user does (one click on its header or tab).
async function openSection(page, title) {
  const b = page.locator('button.edSectionHead', { hasText: title }).first()
  await b.waitFor()
  if (await b.getAttribute('aria-expanded') === 'false') await b.click()
}
async function openExport(page) {
  const b = page.getByRole('button', { name: 'Exportar', exact: true })
  if (await b.getAttribute('aria-expanded') === 'false') await b.click()
  await page.locator('#ed-export').waitFor()
}
const toolTab = (page, name) => page.getByRole('tablist', { name: 'Herramientas' }).getByRole('tab', { name, exact: true }).click()
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
{
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '')
  const server = serve(8828, { 'app.css': css, 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', d => d.accept())
  const open = async () => { await page.goto('http://127.0.0.1:8828/editor/manual?job=job1'); await page.getByText('Montaje abierto en modo manual').or(page.getByRole('region', { name: 'Barra del editor' })).first().waitFor({ timeout: 20000 }); await page.waitForTimeout(300) }
  await open()
  const w = sel => page.evaluate(s => document.querySelector(s)?.getBoundingClientRect().width ?? -1, sel)
  const side = () => page.evaluate(() => document.querySelector('.studio')?.getAttribute('data-sidebar'))
  const clips = page.locator('[aria-label="Pista de vídeo"] > [data-ref^="clip:"]')
  const head = () => page.locator('#ed-props h3').textContent()
  const expanded = title => page.locator('button.edSectionHead', { hasText: title }).first().getAttribute('aria-expanded')

  const centre = () => page.evaluate(() => { const c = document.querySelector('canvas.playerCanvas'); return [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data].slice(0, 3) })
  await page.waitForTimeout(1200)
  const still = await centre()
  check('viewer: paused at 0:00 it shows the first picture, not the black of the opening fade', still[0] > 150 && still[2] < 90, still)
  // Sidebar: fixed → automatic → hidden; the editor really gets the space and never jumps while it opens temporarily.
  const peek = () => page.evaluate(() => document.querySelector('.studio')?.hasAttribute('data-peek'))
  const radio = name => page.getByRole('radiogroup', { name: 'Comportamiento de la barra lateral' }).getByRole('radio', { name })
  const work0 = await w('.edWork'), side0 = await w('.sidebar')
  check('sidebar: starts fixed with names and the pin pressed', await side() === 'pinned' && side0 > 200 && await page.locator('.sidebar .navItem span').first().isVisible() && await page.getByRole('button', { name: /Desfijar la barra lateral/ }).getAttribute('aria-pressed') === 'true', [await side(), side0])
  await page.getByRole('button', { name: /Desfijar la barra lateral/ }).click()
  await page.mouse.move(900, 500); await page.waitForTimeout(600)
  const work1 = await w('.edWork'), side1 = await w('.sidebar')
  check('sidebar: unpinning makes it automatic: a thin icon rail, and the editor grows by what it freed', await side() === 'auto' && side1 <= 62 && !(await page.locator('.sidebar .navItem span').first().isVisible()) && work1 - work0 >= side0 - side1 - 4, { work0, work1, side0, side1 })
  const tip = await page.locator('.sidebar .navItem').first().getAttribute('title')
  const rail = await page.locator('.sidebar').boundingBox()
  await page.mouse.move(rail.x + 20, rail.y + 200); await page.waitForTimeout(300)
  const opened = await peek() && (await w('.sidebar')) > 200 && await page.locator('.sidebar .navItem span').first().isVisible()
  check('sidebar: automatic opens over the page when the pointer reaches it (editor width unchanged) and every icon has a tooltip with its name', opened && Math.abs((await w('.edWork')) - work1) < 2 && /^\S.+ — /.test(tip ?? ''), [opened, await w('.sidebar'), tip])
  await page.mouse.move(rail.x + 30, rail.y + 260); await page.waitForTimeout(200)
  const stillOpen = await peek()
  await page.mouse.move(1000, 500); await page.waitForTimeout(150)
  const notYet = await peek()
  await page.waitForTimeout(500)
  check('sidebar: moving inside keeps it open; leaving closes it after a short delay (no flicker)', stillOpen && notYet && !(await peek()), [stillOpen, notYet])
  await page.getByRole('button', { name: 'Mostrar la barra lateral' }).click()
  await page.waitForTimeout(100)
  await page.mouse.move(1000, 500); await page.waitForTimeout(700)
  const keepsFocus = await peek()
  await page.keyboard.press('Escape')
  check('sidebar: the top button opens it with the keyboard focus inside; it does not close while it is being used, Escape closes it', keepsFocus && !(await peek()) && await page.evaluate(() => document.activeElement?.classList.contains('sideToggle')))
  await page.locator('.sidebar').hover(); await page.waitForTimeout(250)
  await radio('Oculta').click()
  await page.mouse.move(1000, 500); await page.waitForTimeout(300)
  const work2 = await w('.edWork')
  check('sidebar: hidden leaves no empty column (the editor takes the whole width) and a small button stays on the left edge', await side() === 'hidden' && !(await page.locator('.sidebar').isVisible()) && work2 > work1 + 40 && (await page.evaluate(() => document.querySelector('.content').getBoundingClientRect().left)) < 40 && await page.locator('.sideEdge').isVisible(), { work1, work2 })
  await page.reload(); await page.getByRole('region', { name: 'Barra del editor' }).waitFor({ timeout: 20000 })
  check('sidebar: the choice is remembered after reloading', await side() === 'hidden')
  await page.locator('.sideEdge').click(); await page.waitForTimeout(200)
  const overEdit = await page.locator('.sidebar').isVisible() && Math.abs((await w('.edWork')) - work2) < 2
  await page.getByRole('button', { name: 'Fijar la barra lateral' }).click()
  check('sidebar: the edge button shows it over the editor and the pin keeps it open', overEdit && await side() === 'pinned' && (await w('.sidebar')) > 200)
  // Touch: a tap on the rail opens it without following a link; a tap outside closes it.
  await radio('Automática').click(); await page.mouse.move(1000, 500); await page.waitForTimeout(600)
  const touch = await browser.newContext({ viewport: { width: 1200, height: 900 }, hasTouch: true })
  const tp = await touch.newPage()
  await tp.addInitScript(() => localStorage.setItem('cerebro-sidebar', 'auto'))
  await tp.goto('http://127.0.0.1:8828/editor/manual?job=job1'); await tp.getByRole('region', { name: 'Barra del editor' }).waitFor({ timeout: 20000 })
  const url0 = tp.url()
  await tp.locator('.sidebar .navItem').nth(2).tap(); await tp.waitForTimeout(200)
  const tOpen = await tp.evaluate(() => document.querySelector('.studio').hasAttribute('data-peek')) && tp.url() === url0
  await tp.locator('.edViewer').tap({ position: { x: 300, y: 20 } }); await tp.waitForTimeout(200)
  check('sidebar: on a touch screen a tap opens the rail (without navigating) and a tap outside closes it', tOpen && !(await tp.evaluate(() => document.querySelector('.studio').hasAttribute('data-peek'))), { tOpen, url0, url: tp.url(), side: await tp.evaluate(() => [document.querySelector('.studio')?.getAttribute('data-sidebar'), document.querySelector('.studio')?.hasAttribute('data-peek')]) })
  await touch.close()
  await page.getByRole('button', { name: 'Fijar la barra lateral' }).click()

  // Context: photo, video, audio, text, transition and nothing selected show different tools.
  await clips.nth(0).click()
  check('properties: a photo shows its groups («Foto» and «Transición» open, the advanced ones closed)', /foto/.test(await head()) && await expanded('Foto') === 'true' && await expanded('Transición') === 'true' && await expanded('Color y efectos') === 'false' && await page.getByLabel('Volumen del vídeo', { exact: false }).count() === 0, await head())
  await clips.nth(1).click()
  check('properties: a video adds its own tools (start in the video, speed, volume)', /vídeo/.test(await head()) && await page.getByLabel(/Volumen del vídeo/).first().isVisible() && await page.locator('#ed-props').getByLabel(/^Velocidad/).isVisible(), await head())
  await page.locator('[aria-label="Pista de Voz"] > div').first().click()
  check('properties: an audio clip shows sound and automation groups, not picture tools', /^Audio/.test(await head()) && await expanded('Sonido') === 'true' && await page.locator('button.edSectionHead', { hasText: 'Automatización' }).count() === 1 && await page.locator('button.edSectionHead', { hasText: 'Color y efectos' }).count() === 0, await head())
  await page.getByRole('button', { name: 'Añadir texto', exact: true }).click()
  check('properties: a text shows its text and style groups', await head() === 'Texto' && await expanded('Estilo y animación') === 'true' && await page.getByLabel('Contenido del texto').isVisible())
  await clips.nth(0).click()
  await toolTab(page, 'Transiciones')
  await page.getByRole('option', { name: 'Transición Disolvencia' }).click()
  check('properties: choosing a transition opens and highlights the transition tools of that cut', await expanded('Transición') === 'true' && await page.getByLabel('Transición al siguiente').inputValue() === 'dissolve')
  await page.locator('.playerTime').click(); await page.keyboard.press('Escape')
  check('properties: with nothing selected the project properties are shown', await head() === 'Proyecto' && await expanded('Proyecto') === 'true' && await page.getByLabel(/Hook inicial/).isVisible(), await head())

  // Collapsible groups: open, close, remembered.
  await clips.nth(0).click()
  await page.locator('button.edSectionHead', { hasText: 'Color y efectos' }).click()
  const brilloOpen = await page.getByLabel('Brillo').isVisible()
  await page.locator('button.edSectionHead', { hasText: 'Transición' }).click()
  check('groups: one click opens a closed group and closes an open one', brilloOpen && await expanded('Transición') === 'false' && !(await page.getByLabel('Transición al siguiente').isVisible()), { brilloOpen, t: await expanded('Transición'), v: await page.getByLabel('Transición al siguiente').isVisible() })

  // Tabs.
  const tabs = ['Materiales', 'Transiciones', 'Efectos', 'Textos', 'Audio', 'IA']
  const shown = []
  for (const t of tabs) { await toolTab(page, t); shown.push(await page.locator('.edTabPanel:not([hidden])').getAttribute('data-tabpanel')) }
  check('tabs: the six tool tabs each show their own panel', shown.join() === 'materials,transitions,effects,texts,audio,ai', shown)
  check('tabs: Audio has the mixer and IA the style tools', await page.getByRole('region', { name: 'Estilos de edición' }).isVisible())
  await toolTab(page, 'Efectos')
  await clips.nth(0).click()
  await page.getByRole('group', { name: 'Looks de color' }).getByRole('button', { name: 'Blanco y negro' }).click()
  check('effects: a look from «Efectos» is applied to the selected clip (same value in its properties)', await page.getByLabel('Filtro').inputValue() === 'mono')

  // Resizable and hideable panels.
  const left0 = await w('#ed-tools')
  await page.getByRole('separator', { name: 'Ancho del panel de herramientas' }).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  const left1 = await w('#ed-tools')
  await page.evaluate(() => window.scrollTo(0, 0))
  const sp = await page.getByRole('separator', { name: 'Ancho del panel de propiedades' }).boundingBox()
  sp.y = Math.max(sp.y, 0) + 140
  const right0 = await w('#ed-props')
  await page.mouse.move(sp.x + 4, sp.y + 60); await page.mouse.down(); await page.mouse.move(sp.x - 76, sp.y + 60, { steps: 6 }); await page.mouse.up()
  const right1 = await w('#ed-props')
  check('panels: tools and properties are resized (keyboard and dragging)', left1 - left0 >= 55 && right1 - right0 >= 70, { left0, left1, right0, right1 })
  const stage0 = await page.evaluate(() => document.querySelector('.playerStage').getBoundingClientRect().height)
  await page.getByRole('separator', { name: 'Alto del visor' }).focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowUp')
  const stage1 = await page.evaluate(() => document.querySelector('.playerStage').getBoundingClientRect().height)
  check('panels: the viewer height is adjustable', stage1 < stage0 - 30, { stage0, stage1 })
  await toolTab(page, 'Transiciones')
  const viewer0 = await w('.edViewer')
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click()
  const viewerHidden = await w('.edViewer')
  const toolsGone = !(await page.locator('#ed-tools').isVisible())
  await page.getByRole('button', { name: 'Herramientas', exact: true }).click()
  check('panels: hiding the library gives its width to the viewer and showing it again restores it on the same tab', toolsGone && viewerHidden > viewer0 + 200 && await page.locator('.edTabPanel:not([hidden])').getAttribute('data-tabpanel') === 'transitions' && Math.abs((await w('#ed-tools')) - left1) < 2, { viewer0, viewerHidden })

  // Workspace modes.
  await page.getByLabel('Espacio de trabajo').selectOption('wide')
  await page.waitForTimeout(200)
  check('modes: «Pantalla amplia» hides both side panels and the sidebar', !(await page.locator('#ed-tools').isVisible()) && !(await page.locator('#ed-props').isVisible()) && await side() === 'hidden')
  await page.getByLabel('Espacio de trabajo').selectOption('audio')
  check('modes: «Audio» brings the panels and the sidebar back with the mixer on screen', await side() === 'pinned' && await page.getByRole('region', { name: 'Mezclador' }).isVisible())
  await page.getByLabel('Espacio de trabajo').selectOption('effects')
  check('modes: «Efectos» opens the effects tab with a wider properties panel', await page.locator('.edTabPanel:not([hidden])').getAttribute('data-tabpanel') === 'effects' && (await w('#ed-props')) >= 430)
  await page.getByLabel('Espacio de trabajo').selectOption('edit')

  // Tool search.
  await clips.nth(1).click()
  const search = async (q, pick) => { await page.keyboard.press('Control+k'); await page.keyboard.type(q); if (pick) await page.getByRole('option', { name: pick, exact: true }).click(); else await page.keyboard.press('Enter'); await page.waitForTimeout(200) }
  await page.locator('.playerTime').click()
  await page.keyboard.press('Control+k')
  check('search: Ctrl+K focuses «Buscar herramienta»', await page.evaluate(() => document.activeElement?.id) === 'tool-search')
  await page.keyboard.press('Escape')
  if (await expanded('Transición') === 'true') await page.locator('button.edSectionHead', { hasText: 'Transición' }).click()
  const wasClosed = await expanded('Transición') === 'false'
  await search('Transición')
  check('search: «Transición» opens the transition tools of the selected clip', wasClosed && await expanded('Transición') === 'true', { wasClosed, now: await expanded('Transición'), q: await page.getByLabel('Buscar herramienta').inputValue(), focus: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)) })
  await search('Volumen')
  check('search: «Volumen» goes to the volume of the selected video', await page.locator('[data-tool="volume"]').isVisible() && await expanded('Vídeo') === 'true')
  await search('Recortar', 'Recortar / duración')
  check('search: «Recortar» goes to the trim fields', await page.locator('[data-tool="trim"]').isVisible())
  await search('Subtítulos', 'Subtítulos')
  check('search: «Subtítulos» opens the Textos tab with the subtitles', await page.locator('.edTabPanel:not([hidden])').getAttribute('data-tabpanel') === 'texts')
  await search('Zoom', 'Zoom de la imagen')
  check('search: «Zoom» opens framing and movement', await expanded('Encuadre y movimiento') === 'true' && await page.locator('[data-tool="zoom"]').isVisible())
  await search('Exportar')
  check('search: «Exportar» opens the export panel', await page.locator('#ed-export').isVisible() && await page.getByLabel('Resolución').isVisible())
  await page.getByRole('button', { name: 'Cerrar exportación' }).click()

  // Layout remembered after reloading; playback, timeline and saving still work.
  const before = { left: await w('#ed-tools'), right: await w('#ed-props'), tab: await page.locator('.edTabPanel:not([hidden])').getAttribute('data-tabpanel') }
  await page.getByRole('button', { name: 'Guardar ahora' }).click()
  await page.getByText('Montaje guardado en la nube.').waitFor()
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB.render_jobs[0].composition)))
  await open()
  const after = { left: await w('#ed-tools'), right: await w('#ed-props'), tab: await page.locator('.edTabPanel:not([hidden])').getAttribute('data-tabpanel') }
  check('layout: panel sizes, tab and open groups are remembered after reloading', Math.abs(after.left - before.left) < 2 && Math.abs(after.right - before.right) < 2 && after.tab === before.tab, { before, after })
  check('saving: the montage saved from the new workspace keeps the edits (look and transition)', saved.clips[0].filters?.saturation === 0 && saved.clips[0].transition === 'dissolve', saved.clips[0])
  const bar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  await bar.getByRole('button', { name: 'Reproducir' }).click(); await page.waitForTimeout(1200); await bar.getByRole('button', { name: 'Pausa' }).click()
  const t = await page.locator('.playerTime b').textContent()
  check('player: still plays in the new layout', t !== '0:00.0' && t !== '00:00.0', t)
  const n0 = await clips.count()
  await clips.nth(0).click(); await page.keyboard.press('Control+d')
  check('timeline: still edits (Ctrl+D duplicates)', await clips.count() === n0 + 1)
  check('workspace: no page errors (desktop)', errors.length === 0, errors)

  // The viewer sits right on top of the timeline (no export panel or empty space between them) on common screen sizes.
  for (const [vw, vh] of [[1366, 768], [1500, 1000], [1920, 1080]]) {
    const fresh = await browser.newContext()
    const p = await fresh.newPage()
    await p.addInitScript(() => localStorage.removeItem('cerebro-editor-layout'))
    await p.setViewportSize({ width: vw, height: vh })
    await p.goto('http://127.0.0.1:8828/editor/manual?job=job1'); await p.getByRole('region', { name: 'Barra del editor' }).waitFor({ timeout: 20000 }); await p.waitForTimeout(1000)
    const g = await p.evaluate(() => { const v = document.querySelector('.edViewer .playerControls').getBoundingClientRect(), t = document.querySelector('.timelinePanel').getBoundingClientRect(), tr = document.querySelector('[aria-label="Pista de vídeo"]').getBoundingClientRect(), st = document.querySelector('.playerStage').getBoundingClientRect(); return { gap: Math.round(t.top - v.bottom), timelineTop: Math.round(t.top), firstTrackBottom: Math.round(tr.bottom), stageH: Math.round(st.height), vh: innerHeight } })
    console.log('LAYOUT', vw, vh, JSON.stringify(g))
    const ctlRows = await p.evaluate(() => { const cs = [...document.querySelector('.playerControls').children].map(e => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2) }); return cs.filter((v, i) => cs.findIndex(x => Math.abs(x - v) < 10) === i).length })
    check(`layout ${vw}×${vh}: the player controls take at most two rows (one on wide screens)`, ctlRows <= (vw >= 1900 ? 1 : 2), ctlRows)
    await fresh.close().catch(() => {})
    check(`layout ${vw}×${vh}: the timeline starts right under the viewer controls and its main video track is on screen with the viewer, without scrolling`, g.gap <= 24 && g.firstTrackBottom <= vh && g.stageH >= 200, g)
  }
  // Tablet and phone with the real stylesheet: no horizontal scroll, viewer first, groups still toggle, search reachable.
  for (const [name, vw, vh] of [['tablet', 820, 1180], ['mobile', 390, 844]]) {
    const p = await ctx.newPage()
    await p.setViewportSize({ width: vw, height: vh })
    const errs = []
    p.on('pageerror', e => errs.push(e.message))
    await p.goto('http://127.0.0.1:8828/editor/manual?job=job1'); await p.getByRole('region', { name: 'Barra del editor' }).waitFor({ timeout: 20000 }); await p.waitForTimeout(400)
    const m = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, viewerTop: document.querySelector('.edViewer').getBoundingClientRect().top, toolsTop: document.querySelector('#ed-tools')?.getBoundingClientRect().top ?? 1e9, splitters: [...document.querySelectorAll('.edSplit.vertical')].filter(e => e.getBoundingClientRect().width > 0).length }))
    await p.locator('[aria-label="Pista de vídeo"] > [data-ref^="clip:"]').nth(0).click()
    const was = await p.getByLabel('Brillo').isVisible()
    await p.locator('button.edSectionHead', { hasText: 'Color y efectos' }).click()
    const toggled = (await p.getByLabel('Brillo').isVisible()) !== was
    await p.getByLabel('Buscar herramienta').fill('Exportar'); await p.keyboard.press('Enter'); await p.waitForTimeout(250)
    check(`${name}: the workspace fits ${vw} px (no horizontal scroll), the viewer comes first, groups toggle and the search works`, m.over <= 1 && m.viewerTop < m.toolsTop && m.splitters === 0 && toggled && await p.locator('#ed-export').isVisible() && errs.length === 0, { m, toggled, errs })
    await p.close()
  }
  await ctx.close(); server.close()
}
await browser.close(); process.exit(failures.length ? 1 : 0)
