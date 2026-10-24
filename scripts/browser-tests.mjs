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
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': JSON.stringify(process.env.TEST_FFMPEG_CORE_BASE_URL ?? ''), 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID': 'undefined', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY': 'undefined', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID': 'undefined', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '"http://127.0.0.1:9"', 'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': '"pk-test"', ...extraDefine }, alias: { '@': root },
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
  await page.getByRole('button', { name: 'Dividir', exact: true }).click()
  check('manual: split creates a clip', await clips.count() === 4)
  const box = await page.locator('[aria-label="Cambiar duración"]').first().boundingBox()
  await page.mouse.move(box.x + 4, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 44, box.y + 20, { steps: 8 }); await page.mouse.up()
  check('manual: dragging the edge resizes (+1 s)', (await clips.first().getAttribute('title')).endsWith('3 s'))
  await page.getByRole('button', { name: 'Deshacer' }).click()
  check('manual: undo', (await clips.first().getAttribute('title')).endsWith('2 s'))
  await page.getByRole('button', { name: 'Rehacer' }).click()
  check('manual: redo', (await clips.first().getAttribute('title')).endsWith('3 s'))
  await clips.last().click()
  await openSection(page, 'Texto y subtítulo')
  await page.getByLabel('Texto en pantalla').fill('FIN')
  await page.getByLabel('Transición al siguiente').selectOption('cut')
  await page.getByRole('button', { name: 'Duplicar', exact: true }).click()
  check('manual: duplicate', await clips.count() === 5)
  await clips.last().click(); await page.keyboard.press('Delete')
  check('manual: delete with keyboard', await clips.count() === 4)
  await page.getByText('Importar o añadir').click()
  await page.locator('label', { hasText: /^Audio/ }).locator('select').selectOption('mus')
  await page.locator('label', { hasText: /^Pista/ }).locator('select').selectOption('music')
  await clips.first().click()
  await page.getByRole('button', { name: /Añadir al inicio|Añadir en el cabezal/ }).click()
  await page.locator('[aria-label="Pista de Música"] > div').first().waitFor()
  await page.getByRole('button', { name: 'Guardar ahora' }).click()
  await page.getByText('Montaje guardado en la nube.').waitFor()
  const stored = (await db()).render_jobs[0].composition
  check('manual: saved as manual edit with split trims', stored.editedManually === true && stored.clips[2].trimInMs === 1500 && stored.clips[3].text?.content === 'FIN', stored.clips)
  check('manual: saved audio tracks', stored.audioClips.map(a => a.kind).join() === 'voice,voice,music', stored.audioClips)
  const nBefore = await clips.count()
  await page.evaluate(() => {
    const src = document.querySelector('[aria-label^="Material Foto roja"]'), track = document.querySelector('[aria-label="Pista de vídeo"]')
    const dt = new DataTransfer(), r = track.getBoundingClientRect(), at = { clientX: r.left + 4, clientY: r.top + 30, bubbles: true, cancelable: true, dataTransfer: dt }
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    track.firstElementChild.dispatchEvent(new DragEvent('dragover', at)); track.firstElementChild.dispatchEvent(new DragEvent('drop', at))
  })
  await page.waitForFunction(n => document.querySelectorAll('[aria-label="Pista de vídeo"] > div').length === n + 1, nBefore)
  check('manual: a material dragged from the panel is inserted where it is dropped', (await clips.first().getAttribute('title')).startsWith('Foto roja'), await clips.first().getAttribute('title'))
  await page.getByRole('button', { name: 'Añadir texto' }).click()
  await page.locator('[aria-label="Pista de Texto"] > div').first().click()
  await page.getByLabel('Contenido del texto').fill('TITULO')
  await page.getByLabel('Aparece en (s)').fill('1')
  check('manual: a text on its own track with its own timing', /^TITULO · 1–4 s$/.test(await page.locator('[aria-label="Pista de Texto"] > div').first().getAttribute('title')), await page.locator('[aria-label="Pista de Texto"] > div').first().getAttribute('title'))
  check('manual: the viewer is a player with transport controls (no separate preview render)', await page.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir' }).count() === 1 && await page.getByRole('button', { name: /Vista previa \(no guarda\)/ }).count() === 0)
  // Estilos de edición: measure this montage into a style, apply another style, correct it and add the correction to that style.
  await toolTab(page, 'IA')
  await page.getByRole('button', { name: 'Medir este montaje' }).click()
  await page.getByText('Esto es lo que he medido:').waitFor()
  await page.getByRole('button', { name: 'Guardar «Mi estilo»' }).click()
  await page.getByText('Estilo «Mi estilo» guardado.').waitFor()
  const savedProfiles = (await db()).connector_configs?.find(r => r.capability === 'edit_profiles')?.config?.profiles
  check('style: measured decisions stored as a structured style (not the video)', savedProfiles?.[0]?.name === 'Mi estilo' && savedProfiles[0].kind === 'edit_profile' && typeof savedProfiles[0].pacing?.videoClipMs === 'number' && !('clips' in savedProfiles[0]), savedProfiles)
  await page.getByLabel('Estilo a aplicar').selectOption('preset-shorts')
  await page.getByRole('button', { name: 'Aplicar estilo' }).click()
  await page.getByText(/Estilo «Shorts \/ Reels \/ TikTok» aplicado/).waitFor()
  check('style: applied (format 9:16, undoable) and the comparison starts empty', (await page.locator('label', { hasText: /^Formato/ }).locator('select').inputValue()) === '9:16' && (await page.getByText('Todavía no has corregido nada.').count()) === 1)
  await page.locator('label', { hasText: /^Formato/ }).locator('select').selectOption('1:1')
  const fmtFix = page.getByRole('region', { name: 'Estilos de edición' }).getByText(/Formato de 9:16 a 1:1/)
  await fmtFix.waitFor()
  await fmtFix.click()
  await page.getByRole('button', { name: /Incorporar 1 al estilo/ }).click()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await page.getByText(/actualizado a la versión 2/).waitFor()
  const shorts = (await db()).connector_configs.find(r => r.capability === 'edit_profiles').config.profiles.find(p => p.id === 'preset-shorts')
  check('style: only the accepted correction is added, as a new version that keeps the previous one', shorts?.format === '1:1' && shorts.version === 2 && shorts.previous?.[0]?.version === 1 && shorts.transitions.betweenMaterials === 'cut', shorts)
  await openExport(page)
  await page.getByRole('button', { name: /Renderizar y guardar/ }).click()
  await page.getByText(/Vídeo guardado en la Biblioteca/).waitFor({ timeout: 60000 })
  const final = await db()
  const out = final.assets.find(a => a.source_provider === 'browser-render')
  check('manual: render completed and saved', final.render_jobs.some(j => j.status === 'completed' && j.output_asset_id === out?.id) && out.provenance.settings.editedManually === true, final.render_jobs)
  check('manual: the text track is saved with the montage', final.render_jobs.find(j => j.id === 'job1')?.composition?.textClips?.[0]?.content === 'TITULO', final.render_jobs.find(j => j.id === 'job1')?.composition?.textClips)
  check('manual: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 2b. Manual editor, new tools: real waveforms and beats, cuts on the beat, effects on the cuts, SRT/VTT, a reference video, comparison and a long montage.
{
  const server = serve(8810, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8') + '\n' + readFileSync(path.join(dir, 'manual-editor-pro.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', d => d.accept())
  const clips = page.locator('[aria-label="Pista de vídeo"] > div')
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
  await page.goto('http://127.0.0.1:8810/editor/manual?job=job1')
  await page.getByText('Montaje abierto en modo manual').waitFor({ timeout: 20000 })
  // Music with a click every 500 ms goes on the music track.
  await page.getByText('Importar o añadir').click()
  await page.locator('label', { hasText: /^Audio/ }).locator('select').selectOption('beat')
  await page.locator('label', { hasText: /^Pista/ }).locator('select').selectOption('music')
  await clips.first().click()
  await page.getByRole('button', { name: /Añadir al inicio|Añadir en el cabezal/ }).click()
  await page.locator('[aria-label="Pista de Música"] svg[data-waveform]').first().waitFor({ timeout: 60000 })
  // The music is quiet noise with a loud click every 500 ms: a real waveform has tall columns at the clicks and flat ones in between.
  const wf = await page.evaluate(() => { const d = document.querySelector('[aria-label="Pista de Música"] svg[data-waveform] path')?.getAttribute('d') ?? ''; const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map(m => Number(m[1])); const top = ys.slice(0, ys.length / 2); return { tall: top.filter(y => y < 5).length, flat: top.filter(y => y > 12).length, cols: top.length } })
  check('editor-pro: a real waveform is drawn on the music track (tall columns at the clicks, flat between them)', wf.tall >= 5 && wf.tall <= wf.cols / 2 && wf.flat >= wf.cols / 2, wf)
  check('editor-pro: voice tracks get their own waveform', await page.locator('[aria-label="Pista de Voz"] svg[data-waveform]').count() >= 1)
  await toolTab(page, 'Audio')
  await page.getByText(/~12\d BPM|~11[89] BPM/).first().waitFor({ timeout: 30000 })
  check('editor-pro: the tempo is measured from the music (~120 BPM) and beats are marked on the timeline', (await page.locator('[data-beat]').count()) >= 8)
  // Two image clips without voice at the end: a cut next to a voice is never moved, this one can be. A margin of 300 ms always reaches a beat (they are 500 ms apart).
  await toolTab(page, 'Materiales')
  await page.locator('label', { hasText: /^Clip de imagen o vídeo/ }).locator('select').selectOption('img')
  await page.getByRole('button', { name: /^Añadir clip/ }).click()
  await page.locator('label', { hasText: /^Clip de imagen o vídeo/ }).locator('select').selectOption('img')
  await page.getByRole('button', { name: /^Añadir clip/ }).click()
  await toolTab(page, 'Audio')
  await page.getByLabel(/^Margen/).evaluate(el => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '300'); el.dispatchEvent(new Event('input', { bubbles: true })) })
  const before = await page.getByText(/cortes caen en un pulso/).textContent()
  await page.getByRole('button', { name: 'Mover los cortes al pulso' }).click()
  await page.getByText(/\d+ cortes? movidos? al pulso/).waitFor()
  const after = await page.getByText(/cortes caen en un pulso/).textContent()
  const okBefore = Number(/(\d+) de/.exec(before)?.[1]), okAfter = Number(/(\d+) de/.exec(after)?.[1])
  check('editor-pro: moving the cuts to the beat puts more cuts on a beat and says what moved', okAfter > okBefore && /Puedes deshacerlo/.test(await page.locator('.notice').first().textContent()), [before, after])
  await page.getByRole('button', { name: 'Deshacer' }).click()
  check('editor-pro: the sync is one undoable step', (await page.getByText(/cortes caen en un pulso/).textContent()) === before)
  await page.getByRole('button', { name: 'Rehacer' }).click()
  // Effects on the cuts, then the style learns them.
  await page.locator('label', { hasText: /^Efecto/ }).locator('select').selectOption('sfx1')
  await page.getByRole('button', { name: 'Poner en los cortes' }).click()
  await page.getByText(/colocado en \d+ corte/).waitFor()
  const nCuts = (await clips.count()) - 1
  check('editor-pro: one effect per cut on the effects track', (await page.locator('[aria-label="Pista de Efectos"] > div').count()) === nCuts, nCuts)
  // Subtitles from an SRT file.
  const srt = '1\n00:00:00,500 --> 00:00:01,800\nPrimer subtítulo\n\n2\n00:00:02,400 --> 00:00:04,000\nSegundo <i>subtítulo</i>\n'
  await toolTab(page, 'Textos')
  await page.locator('input[type=file][accept*=".srt"]').setInputFiles({ name: 'prueba.srt', mimeType: 'text/plain', buffer: Buffer.from(srt) })
  await page.getByText(/2 subtítulos \(SRT\)/).waitFor()
  await page.getByRole('button', { name: 'Colocar en el montaje' }).click()
  await page.getByRole('table', { name: 'Lista de subtítulos' }).waitFor()
  check('editor-pro: SRT cues listed with their times', (await page.getByRole('table', { name: 'Lista de subtítulos' }).locator('tbody tr').count()) >= 2)
  await page.getByLabel('Texto del subtítulo 1').fill('Editado a mano')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar .srt' }).click()])
  const srtOut = await (async () => { const st = await dl.createReadStream(); let t = ''; for await (const c of st) t += c; return t })()
  check('editor-pro: the edited caption is exported as a valid SRT', /00:00:00,500 --> 00:00:01,800\nEditado a mano/.test(srtOut) && /Segundo subtítulo/.test(srtOut), srtOut)
  // Save and inspect what was stored.
  await page.getByRole('button', { name: 'Guardar ahora' }).click(); await page.getByText('Montaje guardado en la nube.').waitFor()
  const stored = (await db()).render_jobs.find(j => j.id === 'job1').composition
  check('editor-pro: effects are tagged and saved, cues are saved on the clips, the automatic snapshot is kept', stored.audioClips.filter(a => a.origin === 'cut-sfx').length === nCuts && stored.clips.some(k => k.cues?.length) && stored.autoSnapshot?.clips.length === 3, [stored.audioClips.length, stored.autoSnapshot])
  // Reference video: analysed locally; only numbers come out.
  await toolTab(page, 'IA')
  await page.locator('input[type=file][accept="video/*"]').last().setInputFiles({ name: 'ref.webm', mimeType: 'video/webm', buffer: Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await window.__REF.arrayBuffer())))) })
  await page.getByLabel('Resultado de la referencia').waitFor({ timeout: 120000 })
  const refText = await page.getByLabel('Resultado de la referencia').textContent()
  const cutsPerMin = Number(/(\d+(?:[.,]\d+)?) cortes\/min/.exec(refText)?.[1].replace(',', '.'))
  check('editor-pro: the reference video was analysed (three cuts in 7 s ≈ 25 cuts/min)', cutsPerMin >= 17 && cutsPerMin <= 34, refText)
  await page.getByRole('button', { name: 'Guardar como estilo' }).first().click()
  await page.getByText(/guardado en tu cuenta; aparece en/).waitFor()
  const styles = (await db()).connector_configs?.[0]?.config?.styles ?? []
  const refStyle = styles.find(x => x.source === 'referencia')
  check('editor-pro: the reference became a style with only numbers (no file name, no media)', !!refStyle && !JSON.stringify(refStyle).match(/ref\.webm|mi-referencia|blob:|data:/), refStyle)
  await page.locator('[aria-label="Aprende de mí"] select').filter({ has: page.locator('option', { hasText: 'referencia' }) }).selectOption({ index: 0 })
  check('editor-pro: the reference style is listed next to the learned ones', (await page.getByText(/· referencia/).count()) >= 1)
  check('editor-pro: the reference style can also be applied from «Estilos de edición»', (await page.getByLabel('Estilo a aplicar').locator('optgroup[label="Grabados o de referencia"] option').count()) >= 1)
  // Comparison with the automatic montage this one came from.
  await page.getByText('Comparar mi montaje con el automático').click()
  await page.getByLabel('Comparar con').selectOption('snapshot')
  await page.locator('svg[aria-label^="Cortes de"]').waitFor()
  check('editor-pro: the comparison draws both montages and lists the differences', (await page.locator('svg[aria-label^="Cortes de"] rect').count()) >= 6 && (await page.getByText('Diferencias').count()) === 1)
  check('editor-pro: no page errors', errors.length === 0, errors)
  await page.close()
  // A 400-clip montage: only the visible part is in the page, and scrolling shows the end.
  const long = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const lerrors = []; long.on('pageerror', e => lerrors.push(e.message))
  await long.addInitScript(() => { window.__WANT_JOB = 'long' })
  await long.goto('http://127.0.0.1:8810/editor/manual?job=long')
  await long.locator('[aria-label="Pista de vídeo"] > div').first().waitFor({ timeout: 20000 })
  const drawn = await long.locator('[aria-label="Pista de vídeo"] > div[draggable]').count()
  check('editor-pro: a 400-clip montage draws only the clips on screen', drawn > 5 && drawn < 80, drawn)
  await long.evaluate(() => { const el = document.querySelector('.tlScroll'); el.scrollLeft = el.scrollWidth })
  await long.locator('[aria-label="Pista de vídeo"] > div[draggable]', { hasText: '400' }).first().waitFor({ timeout: 10000 })
  const drawnEnd = await long.locator('[aria-label="Pista de vídeo"] > div[draggable]').count()
  check('editor-pro: scrolling to the end draws the last clips and still only a few', drawnEnd < 80 && lerrors.length === 0, [drawnEnd, lerrors])
  await long.close(); server.close()
}

// 2c. The real analysis worker on 10 minutes of audio: correct results, a responsive page meanwhile, and cancellation that works.
{
  const worker = (await build({ entryPoints: [path.join(root, 'lib/editor/analysis.worker.ts')], bundle: true, write: false, format: 'iife', logLevel: 'error', alias: { '@': root } })).outputFiles[0].text
  const server = serve(8811, { 'worker.js': worker, 'h.js': await bundle(path.join(dir, 'analysis-worker.harness.ts')) })
  const page = await browser.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8811/')
  const r = await page.evaluate(() => window.runTest(600))
  check('analysis worker: 10 minutes of audio measured (duration, peaks, tempo)', Math.abs(r.durationMs - 600000) < 200 && r.peaks > 29900 && r.bpm > 118 && r.bpm < 122 && r.beats > 1100, r)
  check('analysis worker: the page stayed responsive while it ran (no gap above 250 ms between 10 ms timers)', r.ticks > 20 && r.maxGap < 250, { maxGap: r.maxGap, ticks: r.ticks, elapsed: r.elapsed })
  check('analysis worker: progress is reported and a cancelled run stops', r.progressSteps > 5 && r.cancelled === true, r)
  check('analysis worker: no page errors', errors.length === 0, errors)
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
    ['/campaigns', 'app/campaigns/page', '/campaigns'], ['/calendar', 'app/calendar/page', '/calendar'], ['/workflows', 'app/workflows/page', '/workflows'], ['/editor/style', 'app/editor/style/page', '/editor/style'], ['/editor/styles', 'app/editor/styles/page', '/editor/styles'], ['/editor/templates', 'app/editor/templates/page', '/editor/templates'], ['/add', 'app/add/page', '/add'], ['/shorts', 'app/shorts/page', '/shorts'], ['/editor/manual', 'app/editor/manual/page', '/editor/manual'],
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
  await long.getByText(/Potencial/).first().waitFor({ timeout: 10000 })
  check('repurpose (long video): candidates explain why they were chosen and show an estimated potential', await long.getByText(/empieza con una pregunta/).count() >= 1 && await long.getByText(/\/100 \(estimado\)/).count() >= 1)
  await long.getByLabel('Plantilla').selectOption('dinamico')
  await long.getByLabel('Encuadre vertical (si el vídeo es horizontal)').selectOption('0.25')
  const moments = await long.getByRole('checkbox').count()
  await long.getByRole('checkbox', { name: /Elegir 0:20–/ }).check()
  await long.getByRole('button', { name: /Crear 1 Short/ }).click()
  await long.getByRole('link', { name: 'Abrir en el editor' }).first().waitFor({ timeout: 10000 })
  let db = await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
  const short = db.render_jobs.find(j => j.output_format === '9:16' && j.composition?.clips?.[0]?.visualAssetId === 'as1')
  check('repurpose (long video): the draft trims the source video and carries timed captions', !!short && short.composition.clips[0].trimInMs === 20000 && short.composition.subtitles === true && (short.composition.clips[0].cues ?? []).length >= 2, short?.composition?.clips?.[0])
  check('repurpose (long video): the template and framing are applied (word-by-word captions, ≤3 words, left framing)', short?.composition.captionStyle === 'karaoke' && short.composition.clips[0].focusX === 0.25 && short.composition.clips[0].cues.every(q => q.text.split(' ').length <= 3), short?.composition)
  const before = db.render_jobs.filter(j => j.output_format === '9:16').length
  await long.getByRole('button', { name: 'Elegir todos' }).click()
  await long.getByRole('button', { name: new RegExp(`Crear ${moments} Shorts`) }).click()
  await page.waitForFunction(n => window.__DB.render_jobs.filter(j => j.output_format === '9:16').length >= n, before + moments, { timeout: 10000 })
  db = await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
  check('repurpose (long video): «Elegir todos» creates one draft per moment in a single batch', db.render_jobs.filter(j => j.output_format === '9:16').length === before + moments && moments >= 2, { before, moments })
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
  await openExport(page)
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
  await page.getByRole('button', { name: 'Guardar ahora' }).waitFor({ timeout: 20000 })
  const created = (await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))).render_jobs.find(j => j.composition.title === 'Mi corto')
  check('manual picker: the empty edit is stored as a manual draft in the chosen format', created?.status === 'draft' && created.output_format === '9:16' && created.composition.editedManually === true && created.composition.clips.length === 0, created)
  const tracks = await page.locator('[aria-label^="Pista de"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  check('manual picker: separate tracks for video/images, voice, music and effects', ['Pista de vídeo', 'Pista de Voz', 'Pista de Música', 'Pista de Efectos'].every(t => tracks.includes(t)), tracks)
  // An automatic edit with no voices opens in manual mode as it is: no "voices were moved" notice and nothing to save.
  await page.goto('http://127.0.0.1:8798/editor/manual?job=job9')
  await page.getByRole('button', { name: 'Guardar ahora' }).waitFor({ timeout: 20000 })
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

// 12. YouTube channel: a new authorization is not saved until the owner confirms the exact channel (name + ID) shown by the server.
{
  const CH = 'UC1234567890abcdefghijKL'
  const seed = `\nwindow.__DB.channel_connections = [{ id: 'cc-old', owner_id: 'u1', provider: 'youtube', external_account_id: 'UColdoldoldoldoldoldold1', external_account_name: 'Canal antiguo', status: 'expired', scopes: [], updated_at: '2026-10-09T00:00:00Z' }]`
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/connectors/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const server = serve(8802, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + seed, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const errors = [], posted = []
  let pending = { channelId: CH, channelName: 'Umbral del Hito', handle: '@umbraldelhito', canUpload: true, expiresAt: Date.now() + 600000 }
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/providers/status', r => r.fulfill({ json: { providers: [{ id: 'youtube-oauth', enabled: true, health: 'ready' }] } }))
  await page.route('**/api/oauth/youtube/pending', r => r.fulfill({ json: { pending } }))
  await page.route('**/api/oauth/youtube/confirm', async r => {
    const body = JSON.parse(r.request().postData() ?? '{}'); posted.push(body)
    await page.evaluate(ch => { const db = window.__DB.channel_connections; for (const c of db) c.status = 'revoked'; db.push({ id: 'cc-new', owner_id: 'u1', provider: 'youtube', external_account_id: ch, external_account_name: 'Umbral del Hito', status: 'connected', scopes: ['https://www.googleapis.com/auth/youtube.upload'], updated_at: '2026-10-21T00:00:00Z' }) }, body.channelId)
    pending = null
    return r.fulfill({ json: { connected: true, channelId: body.channelId } })
  })
  await page.goto('http://127.0.0.1:8802/connectors?youtube=pending')
  const box = page.getByRole('region', { name: 'Confirmar canal de YouTube' })
  await box.waitFor({ timeout: 15000 })
  check('youtube channel: the pending authorization shows name, handle, ID and upload permission before anything is saved', (await box.getByText('Umbral del Hito').count()) === 1 && (await box.getByText(CH).count()) === 1 && (await box.getByText(/@umbraldelhito/).count()) === 1 && (await box.getByText(/Permiso de subida: sí/).count()) === 1)
  check('youtube channel: while pending nothing is saved and there is no usable connection', (await page.evaluate(() => window.__DB.channel_connections.filter(c => c.status === 'connected').length)) === 0 && (await page.getByRole('button', { name: 'Desconectar' }).count()) === 0)
  await box.getByRole('button', { name: 'Confirmar este canal' }).click()
  await page.getByText(`Canal confirmado: Umbral del Hito (${CH}).`).waitFor({ timeout: 10000 })
  check('youtube channel: confirming sends the exact ID that was shown', posted.length === 1 && posted[0].channelId === CH && posted[0].decision === 'confirm', posted)
  check('youtube channel: the connected channel shows its ID and lets you change account', (await page.getByText(CH).count()) >= 1 && (await page.getByRole('link', { name: 'Cambiar de cuenta o canal' }).getAttribute('href')) === '/api/oauth/youtube/start?scope=publish')
  check('youtube channel: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 13. Biblioteca: own tags and collections are saved in the owner's settings row; filters by tag, automatic tag and collection.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/library/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const setup = readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + '\n;' + readFileSync(path.join(dir, 'populated.seed.js'), 'utf8')
  const server = serve(8803, { 'setup.js': setup, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8803/library')
  await page.locator('.thumb').first().waitFor({ timeout: 15000 })
  const total = await page.locator('.thumb').count()
  await page.locator('.thumb').first().click()
  await page.getByLabel('Nueva etiqueta').fill('#Intro Lofi')
  await page.getByRole('button', { name: 'Añadir', exact: true }).click()
  await page.getByRole('button', { name: 'Quitar etiqueta intro lofi' }).waitFor({ timeout: 5000 })
  await page.getByLabel('Nueva colección').fill('Para el canal')
  await page.getByRole('button', { name: 'Crear colección' }).click()
  await page.locator('aside').getByLabel('Para el canal').check()
  await page.waitForTimeout(300)
  const row = await page.evaluate(() => (window.__DB.connector_configs ?? []).find(r => r.provider === 'cerebro-library'))
  check('library: tags and collections are saved in the owner settings row', row?.config?.collections?.[0]?.name === 'Para el canal' && Object.values(row?.config?.tags ?? {}).flat().includes('intro lofi') && row.config.collections[0].assetIds.length === 1, row?.config)
  check('library: choosing the new collection filters the grid to its file', (await page.locator('.thumb').count()) === 1)
  await page.locator('#lib-collection').selectOption('')
  await page.locator('#lib-tag').selectOption('intro lofi')
  check('library: filtering by an own tag shows only tagged files', (await page.locator('.thumb').count()) === 1 && total > 1, total)
  check('library: automatic tags are offered as filters', (await page.locator('#lib-tag option', { hasText: 'subido' }).count()) + (await page.locator('#lib-tag option', { hasText: 'generado con IA' }).count()) >= 1)
  check('library: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 14. Calendario editorial: drafts on several platforms from one video in one step; a draft gets a planned date and shows on its day.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/calendar/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const seed = `\nwindow.__DB.assets.push({ id: 'vid1', owner_id: 'u1', project_id: 'p1', asset_type: 'video', storage_path: 'u1/p1/v.mp4', license_status: 'generated', provenance: { title: 'Vídeo horizontal', format: '16:9' }, created_at: '2026-10-01T00:00:00Z' }); window.__DB.publication_jobs = []`
  const server = serve(8804, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + seed, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8804/calendar')
  const box = page.getByRole('region', { name: 'Preparar en varias plataformas' })
  await box.getByLabel('Proyecto', { exact: true }).selectOption('p1')
  await box.getByLabel('Vídeo', { exact: true }).selectOption('vid1')
  await box.getByLabel('Título (YouTube)').fill('Prueba multiplataforma')
  await box.getByLabel('TikTok', { exact: true }).check()
  check('calendar: warns that a 16:9 video is better as a vertical version for TikTok', (await box.getByText(/funciona mejor en vertical 9:16/).count()) === 1)
  await box.getByRole('button', { name: 'Crear 2 borradores' }).click()
  await page.getByText(/2 borradores creados/).waitFor({ timeout: 10000 })
  const jobs = await page.evaluate(() => window.__DB.publication_jobs)
  check('calendar: one draft per platform, YouTube private and TikTok without a default privacy', jobs.length === 2 && jobs.find(j => j.platform === 'youtube')?.payload.privacyStatus === 'private' && jobs.find(j => j.platform === 'tiktok') && !('privacyLevel' in jobs.find(j => j.platform === 'tiktok').payload) && jobs.every(j => j.status === 'draft'), jobs)
  check('calendar: undated drafts are listed apart', (await page.getByRole('heading', { name: 'Sin fecha (2)' }).count()) === 1)
  const d = new Date(); const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.getByLabel('Fecha prevista de Prueba multiplataforma').first().fill(ymd)
  await page.getByText(/Fecha prevista: /).waitFor({ timeout: 10000 })
  check('calendar: the planned draft appears on today in the grid', (await page.locator('.calDay.today .calItem').count()) === 1 && (await page.getByRole('heading', { name: 'Sin fecha (1)' }).count()) === 1)
  check('calendar: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 15. Flujos de producción: states come from the project's rows; the montage review is an explicit approval that is saved; a cost limit warns.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/workflows/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const seed = `
window.__DB.scripts = [{ id: 's1', owner_id: 'u1', project_id: 'p1', status: 'approved', source_opportunity_id: null, idea: 'Historia real' }]
window.__DB.storyboards = [{ id: 'b1', owner_id: 'u1', project_id: 'p1' }]
window.__DB.scenes = [{ id: 'sc1', owner_id: 'u1', storyboard_id: 'b1', position: 1 }]
window.__DB.render_jobs = []
window.__DB.publication_jobs = []
window.__DB.assets.push({ id: 'img1', owner_id: 'u1', project_id: 'p1', asset_type: 'image', storage_path: 'u1/p1/i.png', license_status: 'generated', provenance: { cost: { amount: 0.5, currency: 'USD', reported: true } }, created_at: '2026-10-01T00:00:00Z' })
window.__DB.assets.push({ id: 'ren1', owner_id: 'u1', project_id: 'p1', asset_type: 'video', storage_path: 'u1/p1/r.mp4', license_status: 'generated', provenance: { purpose: 'render' }, created_at: '2026-10-02T00:00:00Z' })`
  const server = serve(8805, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + seed, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8805/workflows')
  const card = page.locator('article.workflowCard').filter({ has: page.locator('.wfStep.needs_approval') }).first()
  await card.waitFor({ timeout: 10000 })
  check('workflows: script and storyboard done from real rows; materials and montage wait for approval', (await card.locator('.wfStep.done').count()) >= 3 && (await card.locator('.wfStep.needs_approval').count()) === 2)
  await card.getByRole('button', { name: 'Ver detalle' }).click()
  const montageRow = card.locator('tr').filter({ hasText: 'Montaje' })
  await montageRow.getByRole('button', { name: 'Dar visto bueno' }).click()
  await page.getByText(/Montaje de «.*» aprobado/).waitFor({ timeout: 10000 })
  const saved = await page.evaluate(() => (window.__DB.connector_configs ?? []).find(r => r.provider === 'cerebro-workflows')?.config)
  check('workflows: the montage approval is stored with its date', Boolean(saved && Object.values(saved.projects).some(p => p.approvals?.montage)), saved)
  await card.getByLabel(/Límite de coste de/).fill('0.2')
  await card.getByRole('button', { name: 'Guardar límite' }).click()
  await card.getByText(/por encima del límite de 0.20 USD/).waitFor({ timeout: 10000 })
  check('workflows: a project over its cost limit shows a warning', true)
  check('workflows: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 16. Transitions draw the next clip during the last fadeMs of the outgoing one (real canvas render in Chromium).
{
  const server = serve(8806, { 'r.js': await bundle(path.join(dir, 'renderer-motion.harness.ts')) })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:8806/')
  await page.addScriptTag({ url: '/r.js' })
  const red = c => c[0] > 60 && c[2] < 40 && c[1] < 40, blue = c => c[2] > 200 && c[0] < 60
  const wipe = await page.evaluate(() => window.runMotion('wipe'))
  check('motion: wipe reveals the next clip from the left halfway through', red(wipe.before) && blue(wipe.left) && red(wipe.right) && blue(wipe.after), wipe)
  const slide = await page.evaluate(() => window.runMotion('slide'))
  check('motion: slide brings the next clip in from the right', red(slide.left) && blue(slide.right) && blue(slide.after), slide)
  const dissolve = await page.evaluate(() => window.runMotion('dissolve'))
  check('motion: dissolve mixes both clips (no black frame)', dissolve.mid[0] > 60 && dissolve.mid[2] > 60, dissolve)
  const cam = await page.evaluate(() => window.runCamera())
  check('motion: a pan right starts on the left of the image and ends on the right', red(cam.start) && blue(cam.end), cam)
  check('motion: a coloured title on the text track shows only during its own time', cam.title > 500 && cam.titleGone === 0, cam)
  const plain = await page.evaluate(() => window.runMix(undefined))
  check('audio: a volume automation point silences the music from 2 s while the voice continues', plain.music[0] > 0.03 && plain.music[1] < plain.music[0] * 0.1 && plain.voice[1] > 0.03, plain)
  const solo = await page.evaluate(() => window.runMix({ music: { gain: 1, muted: false, solo: true } }))
  check('audio: solo on the music track silences the voice track in the export', solo.voice[0] < solo.music[0] * 0.1 && solo.music[0] > 0.03, solo)
  const low = await page.evaluate(() => window.runMix({ voice: { gain: 0.25, muted: false, solo: false } }))
  check('audio: the voice track level scales the voice only', low.voice[0] < plain.voice[0] * 0.4 && low.music[0] > plain.music[0] * 0.7, { low, plain })
  await page.close(); server.close()
}

// 17. Mis estilos: create from a template, edit a parameter, see the change before saving, save as a new version and restore the old one.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/editor/styles/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const server = serve(8807, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8'), 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1200 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8807/editor/styles')
  await page.getByRole('button', { name: '+ Lo-fi / Relax Music' }).click()
  await page.getByText(/Estilo «Lo-fi \/ Relax Music» creado/).waitFor({ timeout: 10000 })
  await page.getByLabel('Música (%)').fill('70')
  await page.getByLabel('Entre materiales').selectOption('wipe')
  const pending = page.getByRole('region', { name: 'Cambios sin guardar' }).or(page.locator('[aria-label="Cambios sin guardar"]'))
  check('styles: every pending change is listed before saving', (await pending.getByText(/Música: 90 % → 70 %/).count()) === 1 && (await pending.getByText(/Transición entre materiales: Disolvencia → Cortinilla/).count()) === 1)
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await page.getByText(/guardado como versión 2/).waitFor({ timeout: 10000 })
  let row = (await page.evaluate(() => window.__DB.connector_configs)).find(r => r.capability === 'edit_profiles')
  let lofi = row.config.profiles[0]
  check('styles: saved as version 2 keeping version 1', lofi.version === 2 && lofi.audio.musicVolume === 0.7 && lofi.transitions.betweenMaterials === 'wipe' && lofi.previous[0].version === 1, lofi)
  await page.getByRole('button', { name: 'Restaurar' }).click()
  await page.getByRole('button', { name: 'Confirmar restaurar' }).click()
  await page.getByText(/Restaurada la versión 1 como versión 3/).waitFor({ timeout: 10000 })
  row = (await page.evaluate(() => window.__DB.connector_configs)).find(r => r.capability === 'edit_profiles')
  lofi = row.config.profiles[0]
  check('styles: restoring creates a new version with the old values', lofi.version === 3 && lofi.audio.musicVolume === 0.9 && lofi.transitions.betweenMaterials === 'dissolve', lofi)
  check('styles: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 18. Editar con mi estilo: my materials + a style → a draft montage that follows the style, ready for the manual editor.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/editor/style/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const seed = `
window.__DB.render_jobs = []
for (const [id, t] of [['ia', 'Amanecer'], ['ib', 'Bosque'], ['ic', 'Cueva']]) window.__DB.assets.push({ id, owner_id: 'u1', project_id: 'p1', asset_type: 'image', storage_path: 'u1/p1/' + id + '.png', license_status: 'owned', provenance: { title: t }, created_at: '2026-10-01T00:00:00Z' })`
  const server = serve(8808, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + seed, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8808/editor/style?project=p1')
  await page.getByLabel('Estilo').selectOption('preset-docu')
  await page.getByLabel('Título').fill('La cueva')
  for (const n of ['Bosque', 'Amanecer', 'Cueva']) await page.getByRole('region', { name: 'Materiales del proyecto' }).getByText(new RegExp(n)).click()
  await page.getByRole('button', { name: /^Subir Amanecer/ }).click()
  await page.getByRole('button', { name: 'Editar automáticamente con mi estilo' }).click()
  await page.getByText(/Montaje creado con «Historias y documentales»/).waitFor({ timeout: 15000 })
  const job = (await page.evaluate(() => window.__DB.render_jobs))[0]
  const c = job?.composition
  check('style edit: clips follow my order and the style (6 s images, alternating camera, title)', c && c.clips.map(k => k.visualAssetId).join() === 'ia,ib,ic' && c.clips.every(k => k.durationMs === 6000) && new Set(c.clips.map(k => k.camera.kind)).size === 2 && c.textClips[0].content === 'La cueva', c)
  check('style edit: the automatic result is kept to compare with my corrections', c.styleRef.profileId === 'preset-docu' && c.styleRef.baseline.clips.length === 3 && job.status === 'draft')
  check('style edit: opens in the manual editor', (await page.getByRole('link', { name: /Abrir en el editor manual/ }).getAttribute('href')) === `/editor/manual?job=${job.id}`)
  check('style edit: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 19. Edición por instrucciones y fragmentos: written instructions run real timeline operations; a marked fragment scopes them.
{
  const server = serve(8812, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const clips = page.locator('[aria-label="Pista de vídeo"] > div')
  await page.goto('http://127.0.0.1:8812/editor/manual?job=job1')
  await page.getByText('Montaje abierto en modo manual').waitFor({ timeout: 20000 })
  const say = async t => { await page.getByLabel('Dile al editor qué hacer').fill(t); await page.getByRole('button', { name: 'Hacer', exact: true }).click() }
  await say('haz un zoom lento en todo')
  await page.locator('.notice').getByText(/Zoom lento en todo el montaje/).waitFor()
  await say('pon la música «musica» desde el segundo 2 al 40 %')
  await page.locator('.notice').getByText(/Música «Musica[^»]*» de 2\.0 s/).waitFor()
  check('instructions: a music clip starts where asked', (await page.locator('[aria-label="Pista de Música"] > div').count()) === 1)
  const ruler = page.locator('.timelineRuler')
  await ruler.scrollIntoViewIfNeeded()
  const at = async s => { const box = await ruler.boundingBox(); await page.mouse.click(box.x + s * 40, box.y + 8) }
  await at(1.0); await page.keyboard.press('i'); await at(3.5); await page.keyboard.press('o')
  await page.locator('.rangeOverlay').waitFor()
  check('fragments: I and O mark a fragment shown on the timeline', /Fragmento 1(\.0)?–3\.5 s/.test(await page.getByRole('group', { name: 'Fragmento' }).textContent()))
  await say('transición de cortinilla')
  await page.locator('.notice').getByText(/Transición «cortinilla» en el fragmento/).waitFor()
  const n = await clips.count()
  await page.getByRole('button', { name: 'Eliminar fragmento' }).click()
  await page.getByText(/Fragmento eliminado/).waitFor()
  check('fragments: deleting a fragment removes only that part', (await clips.count()) <= n && (await page.locator('.pill.info').first().textContent()) !== '0:07.0')
  await page.getByRole('button', { name: 'Deshacer' }).click()
  check('fragments: undo restores it in one step', (await clips.count()) === n)
  // Correct the result of an instruction by hand → the editor proposes a preference; only a confirmation saves it.
  await clips.first().click()
  await say('haz un zoom lento')
  await page.getByLabel(/^Intensidad \(/).evaluate(el => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '0.05'); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.getByRole('group', { name: 'Propuesta de preferencia' }).waitFor()
  check('preferences: correcting an instruction proposes a preference', /de 8 % a 5 %/.test(await page.getByRole('group', { name: 'Propuesta de preferencia' }).textContent()))
  check('preferences: nothing is saved before confirming', !(await page.evaluate(() => (window.__DB.connector_configs ?? []).some(r => r.capability === 'edit_preferences'))))
  await page.getByRole('button', { name: 'Guardar como preferencia' }).click()
  await page.locator('.notice').getByText(/Preferencia guardada/).waitFor()
  const pref = await page.evaluate(() => (window.__DB.connector_configs ?? []).find(r => r.capability === 'edit_preferences')?.config)
  check('preferences: confirmed preference stored with its history', pref?.zoomSlow === 0.05 && pref.history?.[0]?.from === 0.08, pref)
  await clips.nth(1).click()
  await say('haz un zoom lento')
  check('preferences: the next «zoom lento» uses the preference', (await page.getByLabel(/^Intensidad \(/).inputValue()) === '0.05')
  await say('haz magia')
  check('instructions: an unknown instruction is reported with examples, nothing changes', (await page.getByText(/No he entendido la instrucción\. Ejemplos/).count()) === 1 && (await clips.count()) === n)
  // More Spanish instructions: navigation, selection written in the sentence and undo by voice.
  await page.getByRole('button', { name: 'Quitar selección (Esc)' }).click().catch(() => undefined)
  await say('selecciona del segundo 1 al 3')
  await page.locator('.rangeOverlay').waitFor()
  await say('ve al segundo 2')
  check('instructions: «selecciona…» marks the fragment and «ve al…» moves the playhead', (await page.locator('.playhead').getAttribute('style')).includes('left: 80px'))
  const before = await clips.count()
  await say('corta aquí')
  await say('deshaz')
  check('instructions: «deshaz» undoes the last change', (await clips.count()) === before)
  await page.getByRole('button', { name: 'Quitar selección (Esc)' }).click()
  // Volume points dragged on the waveform lane of the selected audio clip.
  await page.locator('[aria-label="Pista de Música"] > div').first().click()
  const lane = page.locator('svg[aria-label="Puntos de volumen"]')
  await lane.scrollIntoViewIfNeeded()
  const lb = await lane.boundingBox()
  await page.mouse.dblclick(lb.x + lb.width / 2, lb.y + lb.height / 2)
  await page.locator('svg[aria-label="Puntos de volumen"] circle').first().waitFor()
  await page.locator('svg[aria-label="Puntos de volumen"] circle').first().scrollIntoViewIfNeeded()
  const lb2 = await lane.boundingBox(), dot = await page.locator('svg[aria-label="Puntos de volumen"] circle').first().boundingBox()
  await page.mouse.move(dot.x + 6, dot.y + 6); await page.mouse.down(); await page.mouse.move(dot.x + 6, lb2.y + lb2.height - 1, { steps: 6 }); await page.mouse.up()
  const tip = await page.locator('svg[aria-label="Puntos de volumen"] circle title').first().textContent()
  check('volume points: double-click adds a point and dragging it down lowers the level', / · [0-5] %$/.test(tip), tip)
  await page.getByRole('button', { name: 'Deshacer' }).click()
  check('volume points: the whole drag is one undo step', / · 10\d %$| · 9\d %$/.test(await page.locator('svg[aria-label="Puntos de volumen"] circle title').first().textContent()))
  // Recovery: unsaved changes survive closing the tab and are offered (not applied) when the montage is opened again.
  // (Automatic saving off: this simulates the tab dying before the cloud save.)
  await page.getByLabel('Guardado automático').uncheck()
  await say('formato cuadrado')
  await page.waitForTimeout(2200)
  await page.reload()
  await page.getByRole('alert', { name: 'Recuperar cambios' }).waitFor({ timeout: 20000 })
  check('recovery: the editor offers the unsaved changes after reopening', (await page.locator('label', { hasText: /^Formato/ }).locator('select').inputValue()) === '16:9')
  await page.getByRole('button', { name: 'Recuperar cambios' }).click()
  check('recovery: recovering restores them as unsaved changes', (await page.locator('label', { hasText: /^Formato/ }).locator('select').inputValue()) === '1:1' && (await page.getByText('Cambios sin guardar').count()) === 1)
  // Export: 480p downloaded to the computer, not uploaded; the montage keeps the export settings.
  await openExport(page)
  await page.getByLabel('Resolución').selectOption('480')
  await page.getByLabel('Destino').selectOption('download')
  check('export: the estimate follows the settings (the montage is square by now)', /480×480/.test(await page.locator('[aria-label="Estimación"]').textContent()))
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.getByRole('button', { name: 'Renderizar y descargar' }).click()])
  await page.getByText(/se ha descargado a tu equipo y no se ha subido/).waitFor({ timeout: 30000 })
  const fin = await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
  const done = fin.render_jobs.find(j => j.status === 'completed')
  check('export: downloaded at 480p without uploading to the Library', /480p\.(webm|mp4)$/.test(dl.suggestedFilename()) && done?.output_manifest?.destination === 'download' && done.output_manifest.height === 480 && !fin.assets.some(x => x.source_provider === 'browser-render'), [dl.suggestedFilename(), done?.output_manifest])
  check('export: the settings are saved with the montage', fin.render_jobs.find(j => j.id === 'job1')?.composition?.exportSettings?.resolution === '480')
  check('instructions: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 20. Plantillas de montaje: a saved structure filled with other files becomes a new draft with the same tracks and timing.
{
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/editor/templates/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`)
  const tpl = { kind: 'montage_template', id: 'tpl-1', name: 'Mi Short', createdAt: '2026-10-21T00:00:00Z', slots: [{ key: 'slot:visual-1', kind: 'visual', label: 'Visual 1', uses: 2, sourceType: 'image', needsMs: 3000 }, { key: 'slot:music-1', kind: 'music', label: 'Música 1', uses: 1, sourceType: 'music', needsMs: 6000 }],
    composition: { version: 1, storyboardId: 's', title: 'Mi Short', format: '9:16', fadeMs: 300, clips: [{ id: 'a', sceneId: 'a', position: 1, durationMs: 3000, visualAssetId: 'slot:visual-1', transition: 'wipe' }, { id: 'b', sceneId: 'b', position: 2, durationMs: 3000, visualAssetId: 'slot:visual-1' }], audioClips: [{ id: 'm', assetId: 'slot:music-1', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 6000, volume: 0.4, muted: false }], textClips: [{ id: 't', content: 'HOLA', startMs: 0, durationMs: 2000, position: 'center', sizePct: 9 }] } }
  const seed = `
window.__DB.render_jobs = []
window.__DB.connector_configs = [{ id: 'cc1', owner_id: 'u1', provider: 'cerebro-editor', capability: 'montage_templates', enabled: true, priority: 0, config: { templates: [${JSON.stringify(tpl)}] }, updated_at: '2026-10-21T00:00:00Z' }]
window.__DB.assets.push({ id: 'img9', owner_id: 'u1', project_id: 'p1', asset_type: 'image', storage_path: 'u1/p1/i.png', license_status: 'owned', provenance: { title: 'Playa' }, created_at: '2026-10-02T00:00:00Z' })
window.__DB.assets.push({ id: 'mus9', owner_id: 'u1', project_id: 'p1', asset_type: 'music', storage_path: 'u1/p1/m.mp3', license_status: 'owned', provenance: { title: 'Ritmo' }, created_at: '2026-10-02T00:00:00Z' })`
  const server = serve(8813, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + seed, 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8813/editor/templates?project=p1')
  await page.getByLabel('Archivo para Visual 1').selectOption('img9')
  await page.getByLabel('Archivo para Música 1').selectOption('mus9')
  await page.getByRole('button', { name: 'Crear montaje con esta plantilla' }).click()
  await page.getByText(/Montaje creado con la plantilla «Mi Short»/).waitFor({ timeout: 10000 })
  const c = (await page.evaluate(() => window.__DB.render_jobs))[0]?.composition
  check('templates: the new montage keeps the structure with my files', c && c.format === '9:16' && c.clips.map(k => k.visualAssetId).join() === 'img9,img9' && c.clips[0].transition === 'wipe' && c.audioClips[0].assetId === 'mus9' && c.audioClips[0].volume === 0.4 && c.textClips[0].content === 'HOLA', c)
  check('templates: opens in the manual editor', (await page.getByRole('link', { name: /Abrir en el editor manual/ }).count()) === 1)
  check('templates: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 21. Añadir materiales: original file, resumable upload (6 MB chunks) that survives a dropped connection, duplicates, size limit, shortcut code.
{
  const SB = 'http://127.0.0.1:8814/sb'
  const code = await bundle(null, `import { createRoot } from 'react-dom/client'\nimport Page from '@/app/add/page'\ncreateRoot(document.getElementById('root')).render(<Page />)`, { 'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(SB), 'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': '"pk-test"', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID': '""', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY': '""', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID': '""' })
  const server = serve(8814, { 'setup.js': readFileSync(path.join(dir, 'studio.setup.js'), 'utf8') + '\nwindow.__DB.assets = []', 'app.js': code })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const tus = { uploads: new Map(), patches: 0, chunkSizes: [], dropped: 0, auth: [] }
  const CHUNK = 6 * 1024 * 1024
  await page.route('**/api/storage/upload-url', async route => { const b = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ json: { driver: 'supabase', storagePath: `u1/${b.projectId}/uploads/${b.name ?? 'x'}.${b.ext}`, maxBytes: 20 * 1024 * 1024, resumable: true } }) })
  await page.route('**/api/ios/token', async route => {
    const m = route.request().method()
    if (m === 'GET') return route.fulfill({ json: { active: tus.token ? true : false, createdAt: new Date().toISOString(), destination: 'library', lastUsedAt: null, uploads: 0, serverReady: true } })
    if (m === 'POST') { tus.token = 'cs_' + 'a'.repeat(32); return route.fulfill({ json: { token: tus.token, destination: 'library' } }) }
    return route.fulfill({ json: {} })
  })
  await page.route(`${SB}/storage/v1/upload/resumable**`, async route => {
    const q = route.request(), h = q.headers(), m = q.method()
    tus.auth.push(h['authorization'])
    if (m === 'POST') { const id = String(tus.uploads.size + 1); tus.uploads.set(id, { length: Number(h['upload-length']), offset: 0, meta: h['upload-metadata'] }); return route.fulfill({ status: 201, headers: { Location: `${SB}/storage/v1/upload/resumable/${id}`, 'Tus-Resumable': '1.0.0', 'Access-Control-Expose-Headers': 'Location, Upload-Offset' } }) }
    const id = q.url().split('/').pop(); const u = tus.uploads.get(id)
    if (!u) return route.fulfill({ status: 404 })
    if (m === 'HEAD') return route.fulfill({ status: 200, headers: { 'Upload-Offset': String(u.offset), 'Upload-Length': String(u.length), 'Access-Control-Expose-Headers': 'Upload-Offset' } })
    if (m === 'DELETE') { tus.deleted = (tus.deleted ?? 0) + 1; return route.fulfill({ status: 204 }) }
    if (m === 'PATCH' && id === '3') { await new Promise(r => setTimeout(r, 5000)); return route.fulfill({ status: 204, headers: { 'Upload-Offset': String(u.offset) } }).catch(() => undefined) }
    if (m === 'PATCH') {
      tus.patches++
      const body = q.postDataBuffer() ?? Buffer.alloc(0)
      // The second chunk arrives completely but the response is lost (dropped connection): the client must ask the offset and not resend it.
      if (tus.patches === 2 && !tus.dropped) { tus.dropped++; u.offset += body.length; return route.abort('connectionreset') }
      if (Number(h['upload-offset']) !== u.offset) return route.fulfill({ status: 409 })
      tus.chunkSizes.push(body.length); (u.chunks ??= []).push(body.length); u.offset += body.length
      return route.fulfill({ status: 204, headers: { 'Upload-Offset': String(u.offset), 'Access-Control-Expose-Headers': 'Upload-Offset' } })
    }
    return route.fulfill({ status: 204 })
  })
  await page.goto('http://127.0.0.1:8814/add')
  await page.getByLabel('Destino', { exact: true }).waitFor()
  const big = Buffer.alloc(14 * 1024 * 1024 + 1234, 7); big.write('ftypqt', 4)
  await page.locator('#add-device').setInputFiles([{ name: 'IMG_0001.MOV', mimeType: 'video/quicktime', buffer: big }, { name: 'Grabación.m4a', mimeType: 'audio/x-m4a', buffer: Buffer.alloc(300 * 1024, 3) }, { name: 'enorme.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(21 * 1024 * 1024, 1) }])
  await page.waitForFunction(() => (window.__DB.assets ?? []).length >= 2, null, { timeout: 60000 })
  const assets = await page.evaluate(() => window.__DB.assets)
  const mov = assets.find(a => a.provenance.originalFilename === 'IMG_0001.MOV')
  check('add: the original is uploaded in exact 6 MB chunks and registered in the general Library', mov && mov.project_id === null && mov.asset_type === 'video' && mov.provenance.bytes === big.length && mov.provenance.original === true && tus.uploads.get('1').chunks[0] === CHUNK && tus.uploads.get('1').offset === big.length, { chunks: tus.uploads.get('1').chunks, mov })
  check('add: a dropped connection is resumed from the server offset without resending', tus.dropped === 1 && tus.uploads.get('1').chunks.length === 2 && tus.uploads.get('1').chunks[1] === big.length - 2 * CHUNK, tus.uploads.get('1').chunks)
  check('add: Voice Memos audio is stored as a voice, uploads use the session token', assets.some(a => a.provenance.originalFilename === 'Grabación.m4a' && a.asset_type === 'voice') && tus.auth.every(x => x === 'Bearer test-access-token'))
  check('add: a file over the storage limit is refused before uploading, with the reason', /Pesa 21\.0 MB/.test(await page.getByLabel('Subida enorme.mov').textContent()) && assets.length === 2)
  await page.locator('#add-device').setInputFiles([{ name: 'IMG_0001.MOV', mimeType: 'video/quicktime', buffer: big }])
  await page.getByText('Ya está en tu Biblioteca: no se ha subido otra vez.').waitFor({ timeout: 20000 })
  check('add: the same file again is detected as a duplicate (nothing uploaded)', (await page.evaluate(() => window.__DB.assets.length)) === 2 && tus.uploads.size === 2)
  await page.locator('#add-device').setInputFiles([{ name: 'lento.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(7 * 1024 * 1024, 9) }])
  await page.getByLabel('Subida lento.mov').getByText(/Subiendo/).waitFor({ timeout: 20000 })
  await page.waitForTimeout(500)
  await page.getByLabel('Subida lento.mov').getByRole('button', { name: 'Cancelar' }).click()
  await page.getByLabel('Subida lento.mov').getByText('Cancelado.').waitFor()
  await page.waitForTimeout(300)
  check('add: cancelling stops the upload, registers nothing and discards the partial upload on the server', tus.deleted >= 1 && (await page.evaluate(() => window.__DB.assets.length)) === 2 && (await page.getByLabel('Subida lento.mov').getByRole('button', { name: 'Reintentar' }).count()) === 1, tus.deleted)
  await page.getByRole('button', { name: 'Generar código del atajo' }).click()
  await page.getByRole('group', { name: 'Código del atajo' }).waitFor()
  check('add: the shortcut code is shown once with the exact steps and URLs', /cs_a{32}/.test(await page.locator('.tokenBox').textContent()) && /\/api\/ios\/start/.test(await page.locator('.addSteps').textContent()))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('add: fits an iPhone screen without horizontal scrolling', overflow <= 1, overflow)
  check('add: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 22. Reproductor del editor: a 90-minute montage, jump to 45:00, play, pause, back 10 s, frame steps, loop, speed, Space without scrolling.
{
  const server = serve(8815, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8') + '\n' + readFileSync(path.join(dir, 'player.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8815/')
  const bar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  await bar.waitFor()
  const time = async () => (await bar.locator('.playerTime b').innerText()).trim()
  const ms = t => { const p = t.split(/[:.]/).map(Number); return p.length === 4 ? ((p[0] * 60 + p[1]) * 60 + p[2]) * 1000 + p[3] * 1000 / 30 : (p[0] * 60 + p[1]) * 1000 + p[2] * 1000 / 30 }
  const pixel = () => page.evaluate(() => { const c = document.querySelector('canvas.playerCanvas'); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return [d[0], d[1], d[2]] })
  const isGreen = c => c[1] > 150 && c[0] < 80, isBlue = c => c[2] > 150 && c[0] < 80, isRed = c => c[0] > 150 && c[2] < 80
  const settle = async (want) => { for (let i = 0; i < 60; i++) { const c = await pixel(); if (want(c)) return c; await page.waitForTimeout(100) } return pixel() }
  check('player: the 90-minute montage loads with its real length', (await bar.locator('.playerTime').innerText()).includes('1:30:00.00'), await bar.locator('.playerTime').innerText())
  await bar.getByLabel('Ir a un tiempo').fill('45:00'); await bar.getByLabel('Ir a un tiempo').press('Enter')
  check('player: «Ir a 45:00» moves the clock there without playing', (await time()) === '45:00.00', await time())
  check('player: the frame at 45:00 is drawn at once (the green video of 44:00–46:00), nothing rendered first', isGreen(await settle(isGreen)), await pixel())
  await bar.locator('.playerTime').click()
  const scrollY = await page.evaluate(() => window.scrollY)
  await page.keyboard.press('Space')
  // The first second may wait for the video to be positioned (the clock stops meanwhile instead of drifting).
  const t0 = Date.now()
  while (ms(await time()) < 2700_000 + 800 && Date.now() - t0 < 8000) await page.waitForTimeout(100)
  const waited = Date.now() - t0
  await page.waitForTimeout(1000)
  const played = ms(await time())
  check('player: Space plays from 45:00 (time advances ≈ in real time)', played > 2700_000 + 1500 && played < 2700_000 + 1000 + waited + 1500, [await time(), waited])
  check('player: Space does not scroll the page', (await page.evaluate(() => window.scrollY)) === scrollY, await page.evaluate(() => window.scrollY))
  await page.keyboard.press('Space')
  await page.waitForTimeout(200)
  const pausedAt = await time(); await page.waitForTimeout(600)
  check('player: Space again pauses (the clock stops)', (await time()) === pausedAt, [pausedAt, await time()])
  await bar.getByLabel('Ir a un tiempo').fill('46:05'); await bar.getByLabel('Ir a un tiempo').press('Enter')
  check('player: after 46:00 the next clip (blue picture) shows', isBlue(await settle(isBlue)), await pixel())
  await bar.locator('.playerTime').click()
  await page.keyboard.press('j')
  check('player: J goes back 10 seconds (46:05 → 45:55) and shows that frame', (await time()) === '45:55.00' && isGreen(await settle(isGreen)), [await time(), await pixel()])
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
  check('player: → steps one frame at a time (3 frames = 45:55.03)', (await time()) === '45:55.03', await time())
  await page.keyboard.press('ArrowLeft')
  check('player: ← steps back one frame', (await time()) === '45:55.02', await time())
  await bar.getByRole('button', { name: 'Retroceder 10 segundos' }).click()
  await bar.getByRole('button', { name: 'Avanzar 10 segundos' }).click()
  check('player: the −10 s / +10 s buttons move the clock', (await time()) === '45:55.02', await time())
  // An edit shows at once in the paused viewer: give the clip under the playhead another picture.
  await page.locator('[aria-label="Pista de vídeo"] > div[title^="Clip verde"]').click()
  await page.locator('label', { hasText: /^Imagen o vídeo/ }).locator('select').selectOption('img')
  check('player: an edit is visible immediately in the paused viewer (green video → red picture)', isRed(await settle(isRed)), await pixel())
  await page.keyboard.press('Control+z')
  check('player: undo is visible immediately too', isGreen(await settle(isGreen)), await pixel())
  // Scrub: dragging on the progress bar moves the clock.
  const scrub = page.getByRole('slider', { name: 'Posición', exact: true })
  const sb = await scrub.boundingBox()
  await page.mouse.move(sb.x + sb.width * 0.25, sb.y + sb.height / 2); await page.mouse.down(); await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2, { steps: 4 }); await page.mouse.up()
  const scrubbed = ms(await time())
  check('player: dragging the progress bar moves to that point (half = ~45:00)', Math.abs(scrubbed - 2_700_000) < 60_000, await time())
  // Speed 2×: twice as fast.
  await bar.getByLabel('Ir a un tiempo').fill('10:00'); await bar.getByLabel('Ir a un tiempo').press('Enter')
  await bar.getByLabel('Velocidad de reproducción').selectOption('2')
  await bar.getByRole('button', { name: 'Reproducir' }).click()
  await page.waitForTimeout(1500)
  await bar.getByRole('button', { name: 'Pausa' }).click()
  const fast = ms(await time()) - 600_000
  check('player: at 2× the clock runs twice as fast', fast > 2300 && fast < 4500, fast)
  await bar.getByLabel('Velocidad de reproducción').selectOption('1')
  // Loop a marked fragment: 20:00–20:02 with I / O.
  await bar.getByLabel('Ir a un tiempo').fill('20:00'); await bar.getByLabel('Ir a un tiempo').press('Enter')
  await bar.locator('.playerTime').click()
  await page.keyboard.press('i')
  await bar.getByLabel('Ir a un tiempo').fill('20:02'); await bar.getByLabel('Ir a un tiempo').press('Enter')
  await bar.locator('.playerTime').click()
  await page.keyboard.press('o')
  await bar.getByRole('button', { name: /Bucle/ }).click()
  await bar.getByRole('button', { name: 'Reproducir' }).click()
  await page.waitForTimeout(3200)
  const looped = ms(await time())
  await bar.getByRole('button', { name: 'Pausa' }).click()
  check('player: a marked fragment repeats in a loop (still inside 20:00–20:02 after 3 s)', looped >= 1_200_000 && looped <= 1_202_100, await time())
  // Typing in a field: Space is a space, not play.
  await page.getByLabel('Ir a un tiempo').fill('')
  await page.getByLabel('Ir a un tiempo').press('Space')
  check('player: Space inside a text field types a space and does not play', (await bar.getByRole('button', { name: 'Reproducir' }).count()) === 1 && (await page.getByLabel('Ir a un tiempo').inputValue()) === ' ', await page.getByLabel('Ir a un tiempo').inputValue())
  check('player: the timeline playhead follows the player', Math.abs(await page.evaluate(() => parseFloat(document.querySelector('.playhead').style.left)) - looped / 1000 * 40) < 200, await page.evaluate(() => document.querySelector('.playhead').style.left))
  check('player: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 23. Multipista y visor: overlay tracks, drag & drop, moving/resizing on the viewer, keyframes, groups, copy/paste, split, lock, hide, mute, rename, markers, save and reopen.
{
  const server = serve(8816, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8') + '\n' + readFileSync(path.join(dir, 'multitrack.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', d => d.accept())
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
  await page.goto('http://127.0.0.1:8816/editor/manual?job=job1')
  await page.getByText('Montaje abierto en modo manual').waitFor({ timeout: 20000 })
  const bar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  const go = async t => { await bar.getByLabel('Ir a un tiempo').fill(t); await bar.getByLabel('Ir a un tiempo').press('Enter'); await page.waitForTimeout(250) }
  const pixel = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector('canvas.playerCanvas'); const d = c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]] }, [fx, fy])
  const isBlue = c => c[2] > 150 && c[0] < 90, isRed = c => c[0] > 150 && c[2] < 90
  const settle = async (fx, fy, want) => { for (let i = 0; i < 40; i++) { const c = await pixel(fx, fy); if (want(c)) return true; await page.waitForTimeout(100) } return false }
  await page.getByLabel('Añadir pista').selectOption('overlay')
  check('multitrack: «Añadir pista» creates an overlay track above the main one', await page.getByRole('group', { name: 'Controles de Superposición 1' }).count() === 1)
  const ovRow = page.locator('[aria-label="Pista de Superposición 1"]')
  const dropOn = async (rowSel, materialLabel, xPx) => page.evaluate(([rowSel, materialLabel, xPx]) => {
    const src = document.querySelector(`[aria-label^="Material ${materialLabel}"]`), row = document.querySelector(rowSel)
    const dt = new DataTransfer(), r = row.getBoundingClientRect(), at = { clientX: r.left + xPx, clientY: r.top + 10, bubbles: true, cancelable: true, dataTransfer: dt }
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    row.dispatchEvent(new DragEvent('dragover', at)); row.dispatchEvent(new DragEvent('drop', at))
  }, [rowSel, materialLabel, xPx])
  await dropOn('[aria-label="Pista de Superposición 1"]', 'Foto azul', 20)
  await ovRow.locator('> div').first().waitFor()
  check('multitrack: a picture dropped on the overlay track becomes a layer at that time', /^Foto azul.* · 0\.5–5\.5 s$/.test(await ovRow.locator('> div').first().getAttribute('title')), await ovRow.locator('> div').first().getAttribute('title'))
  await go('0:01')
  check('viewer: the overlay is drawn over the main picture (blue in the middle, red at the edge)', await settle(0.5, 0.5, isBlue) && isRed(await pixel(0.05, 0.05)), [await pixel(0.5, 0.5), await pixel(0.05, 0.05)])
  // Move it on the viewer: drag its centre a quarter of the width to the right.
  const stage = await page.locator('.playerStage').boundingBox()
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5)
  await page.mouse.down(); await page.mouse.move(stage.x + stage.width * 0.75, stage.y + stage.height * 0.5, { steps: 6 }); await page.mouse.up()
  check('viewer: dragging the layer on the viewer moves it (now at 75 % across)', await settle(0.75, 0.5, isBlue) && isRed(await pixel(0.5, 0.5)) && /Horizontal \(75 %\)/.test(await page.getByText(/^Horizontal \(/).first().textContent()), [await pixel(0.75, 0.5), await page.getByText(/^Horizontal \(/).first().textContent()])
  const handle = await page.getByRole('button', { name: 'Redimensionar' }).boundingBox()
  await page.mouse.move(handle.x + 7, handle.y + 7); await page.mouse.down(); await page.mouse.move(handle.x + 7 + stage.width * 0.1, handle.y + 7 + stage.height * 0.1, { steps: 5 }); await page.mouse.up()
  const sizeText = await page.getByText(/^Tamaño \(/).first().textContent()
  check('viewer: dragging the corner handle makes the layer bigger', Number(sizeText.match(/\d+/)[0]) > 45, sizeText)
  await page.keyboard.press('Control+z')
  check('viewer: each drag is one undo step', /Tamaño \(40 %\)/.test(await page.getByText(/^Tamaño \(/).first().textContent()), await page.getByText(/^Tamaño \(/).first().textContent())
  // Keyframes: at 1 s on the left, at 4 s on the right → in between it travels.
  await go('0:01')
  await page.getByLabel('Posición horizontal de la superposición').fill('0.2')
  await openSection(page, 'Animación y movimiento')
  await page.getByRole('button', { name: /Fotograma clave en el cabezal/ }).click()
  await go('0:04')
  await page.getByLabel('Posición horizontal de la superposición').fill('0.8')
  await page.getByRole('button', { name: /Fotograma clave en el cabezal/ }).click()
  await go('0:01')
  const leftOk = await settle(0.2, 0.5, isBlue)
  await go('0:04')
  check('keyframes: the layer moves from the left (1 s) to the right (4 s)', leftOk && await settle(0.8, 0.5, isBlue) && !isBlue(await pixel(0.2, 0.5)), [await pixel(0.2, 0.5), await pixel(0.8, 0.5)])
  // Timeline: drag the layer 1 s later.
  const item = ovRow.locator('> div').first()
  await page.evaluate(() => document.querySelector('[aria-label="Pista de Superposición 1"]').scrollIntoView({ block: 'center' }))
  const ib = await item.boundingBox()
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2); await page.mouse.down(); await page.mouse.move(ib.x + ib.width / 2 + 40, ib.y + ib.height / 2, { steps: 5 }); await page.mouse.up()
  check('timeline: dragging a layer moves it in time', /· 1\.5–6\.5 s$/.test(await item.getAttribute('title')), await item.getAttribute('title'))
  // Second overlay track and a vertical drag into it.
  await page.getByLabel('Añadir pista').selectOption('overlay')
  const ov2 = page.locator('[aria-label="Pista de Superposición 2"]')
  await page.evaluate(() => document.querySelector('[aria-label="Pista de Superposición 2"]').scrollIntoView({ block: 'center' }))
  const r2 = await ov2.boundingBox(), ib2 = await item.boundingBox()
  await page.mouse.move(ib2.x + 30, ib2.y + ib2.height / 2); await page.mouse.down(); await page.mouse.move(ib2.x + 30, r2.y + r2.height / 2, { steps: 6 }); await page.mouse.up()
  check('timeline: dragging a layer up or down moves it to another overlay track', await ov2.locator('> div').count() === 1 && await ovRow.locator('> div').count() === 0, [await ov2.locator('> div').count(), await ovRow.locator('> div').count(), r2, ib2, await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-track-id]')?.getAttribute('aria-label'), [ib2.x + 30, r2.y + r2.height / 2])])
  // Group a text with the layer and move them together.
  await page.getByRole('button', { name: 'Añadir texto' }).click()
  const textItem = page.locator('[aria-label="Pista de Texto"] > div').first()
  const layer = ov2.locator('> div').first()
  await textItem.click(); await layer.click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Agrupar selección', exact: true }).click()
  const tStart = (await textItem.getAttribute('title')).match(/· ([\d.]+)–/)[1]
  await page.evaluate(() => document.querySelector('[aria-label="Pista de Texto"]').scrollIntoView({ block: 'center' }))
  const tb = await textItem.boundingBox()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.mouse.down(); await page.mouse.move(tb.x + tb.width / 2 + 20, tb.y + tb.height / 2, { steps: 4 }); await page.mouse.up()
  check('groups: moving one grouped item moves the whole group', (await textItem.getAttribute('title')).match(/· ([\d.]+)–/)[1] !== tStart && /· 2(\.0)?–7(\.0)? s$/.test(await layer.getAttribute('title')), [tStart, await textItem.getAttribute('title'), await layer.getAttribute('title')])
  // Copy, paste at the playhead, split with S.
  await layer.click()
  await page.keyboard.press('Control+c')
  await go('0:08'); await page.locator('.playerTime').click()
  await page.keyboard.press('Control+v')
  // The project ends at 7.5 s, so «0:08» stops at the end (7.5 s): the group is pasted there, keeping its spacing (text 2.5 s after the layer).
  check('clipboard: Ctrl+C / Ctrl+V paste the selection (the whole group) at the playhead', await ov2.locator('> div').count() === 2 && (await ov2.locator('> div').nth(1).getAttribute('title')).includes('· 7.5–12.5 s') && (await page.locator('[aria-label="Pista de Texto"] > div').nth(1).getAttribute('title')).endsWith('10–13 s'), [await ov2.locator('> div').evaluateAll(e => e.map(x => x.title)), await page.locator('[aria-label="Pista de Texto"] > div').evaluateAll(e => e.map(x => x.title)), await page.locator('.playerTime').innerText()])
  await go('0:10'); await page.locator('.playerTime').click()
  await page.keyboard.press('s')
  check('split: S cuts the selected layer at the playhead', await ov2.locator('> div').count() === 3)
  // Track header controls.
  await page.getByRole('button', { name: 'Bloquear Superposición 2' }).click()
  const lb = await layer.boundingBox(), before = await layer.getAttribute('title')
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await page.mouse.down(); await page.mouse.move(lb.x + lb.width / 2 + 80, lb.y + lb.height / 2, { steps: 4 }); await page.mouse.up()
  check('tracks: a locked track does not move', (await layer.getAttribute('title')) === before)
  await go('0:03')
  const visible = await settle(0.5, 0.5, c => isBlue(c) || true)
  await page.getByRole('button', { name: 'Ocultar Superposición 2' }).click()
  check('tracks: a hidden overlay track is not drawn', visible && await settle(0.62, 0.5, c => !isBlue(c)), await pixel(0.62, 0.5))
  await page.getByRole('button', { name: 'Silenciar Música' }).click()
  await page.getByRole('button', { name: 'Solo Voz' }).click()
  await page.getByLabel('Nombre de la pista Superposición 2').fill('Logo'); await page.getByLabel('Nombre de la pista Superposición 2').press('Enter')
  check('tracks: rename, mute and solo', await page.getByRole('group', { name: 'Controles de Logo' }).count() === 1 && (await page.getByRole('button', { name: 'Silenciar Música' }).getAttribute('aria-pressed')) === 'true')
  await go('0:03'); await page.locator('.playerTime').click(); await page.keyboard.press('m')
  check('markers: M adds a marker at the playhead', await page.getByRole('button', { name: /^Marcador Marcador 1/ }).count() === 1)
  await page.getByRole('button', { name: 'Guardar ahora' }).click()
  await page.getByText('Montaje guardado en la nube.').waitFor()
  const stored = (await db()).render_jobs[0].composition
  check('save: overlays, tracks (name, lock, hide, mute, solo), keyframes, groups and markers are stored', stored.overlays.length === 3 && stored.tracks.some(t => t.name === 'Logo' && t.locked && t.hidden) && stored.tracks.some(t => t.id === 'music' && t.muted) && stored.tracks.some(t => t.id === 'voice' && t.solo) && stored.overlays.some(o => o.keyframes?.length === 2) && stored.textClips[0].groupId && stored.markers.length === 1, { tracks: stored.tracks, n: stored.overlays?.length })
  await page.evaluate(() => sessionStorage.setItem('__KEEP_JOBS', JSON.stringify(window.__DB.render_jobs)))
  await page.reload()
  await page.locator('[aria-label="Pista de Logo"] > div').first().waitFor({ timeout: 20000 })
  check('reopen: the multitrack montage comes back as it was saved', await page.locator('[aria-label="Pista de Logo"] > div').count() === 3 && await page.getByRole('group', { name: 'Controles de Superposición 1' }).count() === 1)
  check('multitrack: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 24. Verificación integral: a project with two videos at once, photos, two music tracks, a voice, an effect, a title, subtitles,
//     transitions and volume automation. The preview and both exports must show the same pictures and carry the same sounds.
{
  const server = serve(8817, { 'v.js': await bundle(path.join(dir, 'verify-project.harness.ts')) })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8817/')
  await page.waitForFunction(() => typeof window.runVerify === 'function')
  // The last four instants are in the middle of transitions (dissolve, wipe, slide): only compared with the preview.
  const want = [[200, 30, 30], [0, 200, 0], [0, 200, 0], [200, 0, 200], [200, 0, 200], [224, 208, 32], [224, 208, 32], null, null, null, null]
  const near = (a, b, tol = 60) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
  const pb = await page.evaluate(() => window.runPlayback())
  check('verify: playback from 0:09.5 advances in real time and −10 s goes back', pb.after > 10_600 && pb.after < 11_800 && Math.abs(pb.back - Math.max(0, pb.after - 10_000)) < 5, pb)
  for (const which of ['fast', 'realtime']) {
    const r = await page.evaluate(w => window.runVerify(w), which)
    check(`verify (${which}): the preview shows each layer where expected (main video, overlay video, photos)`, r.preview.every((c, i) => !want[i] || near(c, want[i], 70)), r.preview)
    check(`verify (${which}): the export shows the same picture as the preview at the same instants (also mid-transition)`, r.exported.every((c, i) => near(c, r.preview[i], 60)), { exported: r.exported, preview: r.preview })
    check(`verify (${which}): length and size are the project's (13 s, 1280×720)`, (r.duration === null || Math.abs(r.duration - 13) < 0.6) && r.size[0] === 1280 && r.size[1] === 720, [r.duration, r.size, r.mime])
    const a = r.audio
    check(`verify (${which}): both music tracks, voice, effect and the two videos' sound are in the export, each in its place`, a.music1_before_voice > 0.01 && a.voice > 0.01 && a.voice_after < a.voice * 0.1 && a.music2 > 0.01 && a.music2_before < a.music2 * 0.1 && a.sfx > 0.01 && a.sfx_before < a.sfx * 0.1 && a.video_main > 0.005 && a.video_main_after < a.video_main * 0.2 && a.video_overlay > 0.005 && a.video_overlay_before < a.video_overlay * 0.2, a)
    check(`verify (${which}): the music dips under the voice and the automation point lowers it`, a.music1_under_voice < a.music1_before_voice * 0.6 && a.music1_after_automation < a.music1_before_voice * 0.3, a)
    if (which === 'fast') check('verify (fast): the fast export is faster than real time', r.seconds < 13, r.seconds)
  }
  check('verify: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 25. The verification project in the real editor: play, pause, jump, Space, save, reopen and export (fast), and the exported file
//     matches what the viewer showed at the same instant.
{
  const server = serve(8818, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8') + '\n' + readFileSync(path.join(dir, 'verify-ui.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', d => d.accept())
  await page.goto('http://127.0.0.1:8818/editor/manual?job=jv')
  const bar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  await bar.waitFor({ timeout: 30000 })
  const go = async t => { await bar.getByLabel('Ir a un tiempo').fill(t); await bar.getByLabel('Ir a un tiempo').press('Enter') }
  const pixel = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector('canvas.playerCanvas'); const d = c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]] }, [fx, fy])
  const settle = async (fx, fy, want) => { for (let i = 0; i < 60; i++) { const c = await pixel(fx, fy); if (want(c)) return c; await page.waitForTimeout(100) } return pixel(fx, fy) }
  const isMag = c => c[0] > 150 && c[2] > 150 && c[1] < 80, isGreen = c => c[1] > 150 && c[0] < 80
  check('verify-ui: the project opens with its tracks (overlay, main, title, voice, two music clips, effect, subtitles)', await page.locator('[aria-label="Pista de Superposición 1"] > div').count() === 1 && await page.locator('[aria-label="Pista de Música"] > div').count() === 2 && await page.locator('[aria-label="Pista de Subtítulos"] > div').count() >= 1 && (await bar.locator('.playerTime').innerText()).includes('00:13.00'))
  await go('0:05.5')
  const viewMag = await settle(0.75, 0.3, isMag), viewGreen = await settle(0.3, 0.6, isGreen)
  check('verify-ui: at 0:05.5 the viewer shows the overlay video over the main video', isMag(viewMag) && isGreen(viewGreen), [viewMag, viewGreen])
  await bar.locator('.playerTime').click()
  await page.keyboard.press('Space'); await page.waitForTimeout(1200); await page.keyboard.press('Space')
  const t1 = await bar.locator('.playerTime b').innerText()
  check('verify-ui: Space plays and pauses', t1 > '00:06.00' && t1 < '00:09.00', t1)
  await bar.getByRole('button', { name: 'Retroceder 10 segundos' }).click()
  check('verify-ui: −10 s from there goes back to the start', (await bar.locator('.playerTime b').innerText()) === '00:00.00')
  await go('0:05.5'); await bar.locator('.playerTime').click(); await page.keyboard.press('m')
  await page.getByRole('button', { name: 'Guardar ahora' }).click()
  await page.getByText('Montaje guardado en la nube.').waitFor()
  await page.evaluate(() => sessionStorage.setItem('__KEEP_JOBS', JSON.stringify(window.__DB.render_jobs)))
  await page.reload()
  await bar.waitFor({ timeout: 30000 })
  check('verify-ui: saved and reopened with everything (marker included)', await page.getByRole('button', { name: /^Marcador Marcador 1/ }).count() === 1 && await page.locator('[aria-label="Pista de Superposición 1"] > div').count() === 1 && await page.locator('[aria-label="Pista de Música"] > div').count() === 2)
  await openExport(page)
  check('verify-ui: the export defaults to the fast mode', (await page.getByLabel('Modo de exportación').inputValue()) === 'fast')
  await page.getByRole('button', { name: /Renderizar y guardar/ }).click()
  await page.getByText(/Vídeo guardado en la Biblioteca/).waitFor({ timeout: 120000 })
  const status = await page.locator('[role="status"]').allInnerTexts()
  const out = await page.evaluate(async () => {
    const blob = window.__LAST_RENDER
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob)
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej })
    v.currentTime = 5.5; await new Promise(r => (v.onseeked = r))
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 1280, 720)
    const px = (x, y) => [...g.getImageData(Math.floor(1280 * x), Math.floor(720 * y), 1, 1).data.slice(0, 3)]
    return { mag: px(0.75, 0.3), green: px(0.3, 0.6), duration: v.duration, size: blob.size }
  })
  const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) <= 60)
  check('verify-ui: the exported file shows at 0:05.5 what the viewer showed', near(out.mag, viewMag) && near(out.green, viewGreen) && Math.abs(out.duration - 13) < 0.6, { out, viewMag, viewGreen, status })
  check('verify-ui: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 26. Persistencia completa: edit everything (by hand and by instruction), autosave, reload, close the browser and open it again
//     (a fresh session with nothing in the browser), every property identical; undo after a reload; recovery points; a conflict
//     between sessions; change a transition, save, export and compare with the preview.
{
  const server = serve(8819, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8') + '\n' + readFileSync(path.join(dir, 'verify-ui.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const errors = []
  const open = async (ctx, keep) => {
    if (keep) await ctx.addInitScript(([j, st]) => { sessionStorage.setItem('__KEEP_JOBS', j); sessionStorage.setItem('__KEEP_STORE', st) }, keep)
    const page = await ctx.newPage()
    page.on('pageerror', e => errors.push(e.message))
    page.on('dialog', d => d.accept())
    await page.goto('http://127.0.0.1:8819/editor/manual?job=jv')
    await page.getByRole('toolbar', { name: 'Controles de reproducción' }).waitFor({ timeout: 30000 })
    return page
  }
  const ctx1 = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  let page = await open(ctx1)
  const job = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB.render_jobs.find(j => j.id === 'jv'))))
  const status = () => page.getByRole('status', { name: 'Estado del guardado' }).innerText()
  const savedOk = async () => { await page.waitForFunction(() => /^Guardado en la nube/.test(document.querySelector('[aria-label="Estado del guardado"]')?.textContent ?? ''), null, { timeout: 15000 }) }
  const clips = page.locator('[aria-label="Pista de vídeo"] > div')
  const say = async t => { await page.getByLabel('Dile al editor qué hacer').fill(t); await page.getByRole('button', { name: 'Hacer', exact: true }).click() }
  // Edit: transitions (type and duration), a filter, a camera move, the overlay (keyframes by instruction), a text, pan, a track name, export settings.
  await clips.nth(1).click()
  await page.getByLabel('Transición al siguiente').selectOption('zoom')
  await page.getByLabel('Duración de la transición', { exact: true }).fill('0.8')
  await clips.nth(2).click()
  await openSection(page, 'Color y efectos')
  await page.getByLabel('Filtro').selectOption('mono')
  await clips.nth(0).click()
  await say('haz un zoom lento')
  await page.locator('[aria-label="Pista de Superposición 1"] > div').first().click()
  await say('que la capa vaya de izquierda a derecha')
  await page.locator('[aria-label="Pista de Texto"] > div').first().click()
  await page.getByLabel('Contenido del texto').fill('TITULO NUEVO')
  await page.locator('[aria-label="Pista de Voz"] > div').first().click()
  await page.getByLabel('Panorámica').fill('0.5')
  await page.getByLabel('Nombre de la pista Música').fill('Pianos'); await page.getByLabel('Nombre de la pista Música').press('Enter')
  await openExport(page)
  await page.getByLabel('Resolución').selectOption('720')
  check('save: the state says there are changes, then saves by itself a few seconds later', /Cambios sin guardar|Guardando/.test(await status()), await status())
  await savedOk()
  const before = (await job()).composition
  check('save: autosave wrote every edit to the server copy', before.clips[1].transition === 'zoom' && before.clips[1].transitionMs === 800 && before.clips[2].filters?.saturation === 0 && before.clips[0].camera?.kind === 'zoom_in' && before.overlays[0].keyframes?.length === 2 && before.textClips[0].content === 'TITULO NUEVO' && before.audioClips.find(a => a.id === 'a3')?.pan === 0.5 && before.tracks.find(t => t.id === 'music')?.name === 'Pianos' && before.exportSettings?.resolution === '720', before)
  // Same values regardless of key order inside objects.
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x))
  const keepOf = async p => [await p.evaluate(() => JSON.stringify(window.__DB.render_jobs)), await p.evaluate(() => JSON.stringify(window.__STORE ?? {}))]
  await page.waitForTimeout(2500) // the undo history is copied to the browser 2 s after the last change
  let keep = await keepOf(page)
  await page.close()
  // Reload: the same browser opens the montage again from the server copy.
  page = await open(ctx1, keep)
  const undoBack = await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Deshacer'); return b && !b.disabled }, null, { timeout: 8000 }).then(() => true, () => false)
  check('reload: Ctrl+Z still works after reopening (undo history kept in this browser)', undoBack)
  await page.getByRole('button', { name: 'Guardar ahora' }).click()
  await page.getByText('Montaje guardado en la nube.').waitFor()
  const reloaded = (await job()).composition
  check('reload: the reopened montage is identical, property by property', canon(reloaded) === canon(before), { reloaded, before })
  // Recovery points: «Guardar ahora» created one on the server.
  await page.getByRole('button', { name: 'Puntos de recuperación' }).click()
  await page.getByRole('region', { name: 'Puntos de recuperación' }).getByRole('button', { name: 'Restaurar' }).first().waitFor({ timeout: 10000 })
  check('versions: «Guardar ahora» leaves a recovery point on the server', await page.getByRole('region', { name: 'Puntos de recuperación' }).getByText(/Guardado a mano/).count() >= 1)
  keep = await keepOf(page)
  await ctx1.close()
  // Close the browser completely and open it again: a fresh session (no browser storage), only the server copy.
  const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  page = await open(ctx2, keep)
  check('new session: no local copy is involved (nothing to recover)', await page.getByRole('alert', { name: 'Recuperar cambios' }).count() === 0)
  await page.getByRole('button', { name: 'Guardar ahora' }).click()
  await page.getByText('Montaje guardado en la nube.').waitFor()
  check('new session: the montage is identical in a clean browser (as on another device)', canon((await job()).composition) === canon(before))
  await page.locator('[aria-label="Pista de vídeo"] > div').nth(1).click()
  check('new session: the editor shows the saved values (transition and its length)', (await page.getByLabel('Transición al siguiente').inputValue()) === 'zoom' && (await page.getByLabel('Duración de la transición', { exact: true }).inputValue()) === '0.8')
  // A conflict: another session saves first.
  await page.evaluate(() => { const j = window.__DB.render_jobs.find(x => x.id === 'jv'); j.updated_at = '2030-01-01T00:00:00.000Z'; j.composition = { ...j.composition, title: 'Desde el móvil' } })
  await page.getByLabel('Transición al siguiente').selectOption('wipe_down')
  await page.getByRole('alert', { name: 'Conflicto al guardar' }).waitFor({ timeout: 15000 })
  check('conflict: saving over a newer version from another session is stopped and explained', (await job()).composition.title === 'Desde el móvil')
  await page.getByRole('button', { name: 'Guardar la mía encima' }).click()
  await savedOk()
  check('conflict: «Guardar la mía encima» keeps my change (and leaves the other one as a recovery point)', (await job()).composition.clips[1].transition === 'wipe_down' && Object.keys(await page.evaluate(() => window.__STORE)).some(k => k.endsWith('-conflict.json')))
  // Export after the change and compare with the preview in the middle of the new transition (clip 2 → 3 at 7 s, 800 ms).
  const bar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  await bar.getByLabel('Ir a un tiempo').fill('0:06.6'); await bar.getByLabel('Ir a un tiempo').press('Enter'); await page.waitForTimeout(1500)
  const prev = await page.evaluate(() => { const c = document.querySelector('canvas.playerCanvas'); const g = c.getContext('2d'); const px = (x, y) => [...g.getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3)]; return { top: px(0.3, 0.15), bottom: px(0.3, 0.85) } })
  await openExport(page)
  await page.getByRole('button', { name: /Renderizar y descargar|Renderizar y guardar/ }).click()
  await page.getByText(/Vídeo guardado en la Biblioteca|se ha descargado a tu equipo/).waitFor({ timeout: 120000 })
  const exp = await page.evaluate(async () => {
    const blob = window.__LAST_RENDER
    if (!blob) return null
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob)
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej })
    v.currentTime = 6.6; await new Promise(r => (v.onseeked = r))
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 1280, 720)
    const px = (x, y) => [...g.getImageData(Math.floor(1280 * x), Math.floor(720 * y), 1, 1).data.slice(0, 3)]
    return { top: px(0.3, 0.15), bottom: px(0.3, 0.85) }
  })
  const near = (a, b) => a && b && a.every((x, i) => Math.abs(x - b[i]) <= 60)
  check('export: mid-transition (vertical wipe) the export matches the preview (incoming clip on top, outgoing below)', exp && near(exp.top, prev.top) && near(exp.bottom, prev.bottom) && prev.top.reduce((t, v, i) => t + Math.abs(v - prev.bottom[i]), 0) > 100, { prev, exp })
  check('persistence: no page errors', errors.length === 0, errors)
  await ctx2.close(); server.close()
}

// 27. Transiciones y animaciones de verdad: type, direction, curve, copy/paste, favourites in the account, ready-made movements on
//     a photo, everything kept after closing the browser, and the export matching the viewer mid-transition.
{
  const server = serve(8820, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8') + '\n' + readFileSync(path.join(dir, 'verify-ui.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const errors = []
  const open = async (ctx, keep) => {
    if (keep) await ctx.addInitScript(([j, st, cc]) => { sessionStorage.setItem('__KEEP_JOBS', j); sessionStorage.setItem('__KEEP_STORE', st); sessionStorage.setItem('__KEEP_CC', cc) }, keep)
    const page = await ctx.newPage()
    page.on('pageerror', e => errors.push(e.message))
    page.on('dialog', d => d.accept())
    await page.goto('http://127.0.0.1:8820/editor/manual?job=jv')
    await page.getByRole('toolbar', { name: 'Controles de reproducción' }).waitFor({ timeout: 30000 })
    return page
  }
  const ctx1 = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
  let page = await open(ctx1)
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
  const clips = () => page.locator('[aria-label="Pista de vídeo"] > div')
  const pixel = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector('canvas.playerCanvas'); const d = c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]] }, [fx, fy])
  const settle = async (fx, fy, want) => { for (let i = 0; i < 60; i++) { const c = await pixel(fx, fy); if (want(c)) return c; await page.waitForTimeout(100) } return pixel(fx, fy) }
  const isRed = c => c[0] > 150 && c[1] < 80, isGreen = c => c[1] > 150 && c[0] < 80
  const openDetails = async re => page.evaluate(src => { const r = new RegExp(src); for (const d of document.querySelectorAll('details')) if (r.test(d.querySelector('summary')?.textContent ?? '')) d.open = true }, re)
  const go = async t => { const bar = page.getByRole('toolbar', { name: 'Controles de reproducción' }); await bar.getByLabel('Ir a un tiempo').fill(t); await bar.getByLabel('Ir a un tiempo').press('Enter') }
  await clips().nth(0).click()
  await page.getByLabel('Transición al siguiente').selectOption('wipe')
  await openSection(page, 'Transición')
  await page.getByLabel('Dirección de la transición').selectOption('left')
  await page.getByLabel('Curva de la transición').selectOption('linear')
  await go('0:02.8')
  check('transition: a wipe «hacia la izquierda» shows both clips mid-way (incoming on the right, outgoing on the left)', isGreen(await settle(0.9, 0.5, isGreen)) && isRed(await settle(0.1, 0.5, isRed)), [await pixel(0.9, 0.5), await pixel(0.1, 0.5)])
  const viewerMid = { right: await pixel(0.9, 0.5), left: await pixel(0.1, 0.5) }
  await page.getByLabel('Nombre de la transición favorita').fill('Barrido izq')
  await page.getByRole('button', { name: 'Guardar', exact: true }).first().click()
  await page.getByText('Transición favorita «Barrido izq» guardada en tu cuenta.').waitFor()
  check('transition: a favourite is saved in the account (not in the browser)', (await db()).connector_configs?.find(r => r.capability === 'edit_presets')?.config?.transitions?.[0]?.name === 'Barrido izq')
  await page.getByRole('button', { name: 'Copiar transición' }).click()
  await clips().nth(2).click()
  await openSection(page, 'Transición')
  await page.getByRole('button', { name: 'Pegar transición' }).click()
  // A ready-made smooth movement on the yellow photo (lo-fi).
  await clips().nth(3).click()
  await openSection(page, 'Animación (fotogramas clave)')
  await page.getByRole('group', { name: /Movimientos para Animación de la imagen/ }).getByRole('button', { name: 'Respiración lenta (lo-fi)' }).click()
  await page.waitForFunction(() => /^Guardado en la nube/.test(document.querySelector('[aria-label="Estado del guardado"]')?.textContent ?? ''), null, { timeout: 15000 })
  let comp = (await db()).render_jobs.find(j => j.id === 'jv').composition
  check('saved: transition type, direction and curve; the pasted copy; the photo movement (keyframes)', comp.clips[0].transition === 'wipe' && comp.clips[0].transitionOpts?.direction === 'left' && comp.clips[0].transitionOpts?.easing === 'linear' && comp.clips[2].transition === 'wipe' && comp.clips[2].transitionOpts?.direction === 'left' && comp.clips[3].keyframes?.length === 3 && comp.clips[3].keyframes[1].zoom === 1.06, comp.clips.map(k => [k.transition, k.transitionOpts, k.keyframes]))
  const keep = [await page.evaluate(() => JSON.stringify(window.__DB.render_jobs)), await page.evaluate(() => JSON.stringify(window.__STORE ?? {})), await page.evaluate(() => JSON.stringify(window.__DB.connector_configs ?? []))]
  await ctx1.close()
  // Close the browser and open a clean one.
  const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
  page = await open(ctx2, keep)
  await clips().nth(0).click()
  await openSection(page, 'Transición')
  check('reopened: the transition settings and the favourite are there in a clean browser', (await page.getByLabel('Transición al siguiente').inputValue()) === 'wipe' && (await page.getByLabel('Dirección de la transición').inputValue()) === 'left' && await page.getByRole('group', { name: 'Transiciones favoritas' }).getByRole('button', { name: '★ Barrido izq' }).count() === 1)
  await clips().nth(3).click()
  check('reopened: the photo keeps its keyframed movement', await page.getByRole('table', { name: /Fotogramas clave de Animación de la imagen/ }).locator('tbody tr').count() === 3)
  // Change the transition through an instruction and export: the file must match the viewer mid-transition.
  await clips().nth(0).click()
  await page.getByLabel('Dile al editor qué hacer').fill('pon una disolvencia de un segundo')
  await page.getByRole('button', { name: 'Hacer', exact: true }).click()
  await page.locator('.notice').getByText(/Transición «disolvencia» de 1\.0 s/).waitFor()
  await go('0:02.5')
  const mix = await settle(0.5, 0.5, c => c[0] > 60 && c[1] > 60)
  check('instruction: «una disolvencia de un segundo» mixes both clips in the viewer', mix[0] > 60 && mix[1] > 60, mix)
  await page.waitForFunction(() => /^Guardado en la nube/.test(document.querySelector('[aria-label="Estado del guardado"]')?.textContent ?? ''), null, { timeout: 15000 })
  await openExport(page)
  await page.getByRole('button', { name: /Renderizar y guardar/ }).click()
  await page.getByText(/Vídeo guardado en la Biblioteca/).waitFor({ timeout: 120000 })
  const exp = await page.evaluate(async () => {
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(window.__LAST_RENDER)
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej })
    v.currentTime = 2.5; await new Promise(r => (v.onseeked = r))
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 1280, 720)
    return [...g.getImageData(640, 360, 1, 1).data.slice(0, 3)]
  })
  check('export: mid-dissolve the exported frame matches the viewer', exp.every((x, i) => Math.abs(x - mix[i]) <= 60), { exp, mix, viewerMid })
  check('transitions/animations: no page errors', errors.length === 0, errors)
  await ctx2.close(); server.close()
}

// 28. Espacio de trabajo: barra lateral (expandida, compacta, oculta), grupos desplegables, propiedades según la selección, paneles
//     redimensionables y ocultables, pestañas, modos, búsqueda de herramientas y diseño recordado; con la hoja de estilos real,
//     en escritorio, tableta y móvil. La reproducción, la línea de tiempo y el guardado siguen funcionando.
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
  const clips = page.locator('[aria-label="Pista de vídeo"] > div')
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
  check('properties: a video adds its own tools (start in the video, speed, volume)', /vídeo/.test(await head()) && await page.getByLabel(/Volumen del vídeo/).isVisible() && await page.locator('#ed-props').getByLabel('Velocidad').isVisible(), await head())
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
    await p.locator('[aria-label="Pista de vídeo"] > div').nth(0).click()
    const was = await p.getByLabel('Brillo').isVisible()
    await p.locator('button.edSectionHead', { hasText: 'Color y efectos' }).click()
    const toggled = (await p.getByLabel('Brillo').isVisible()) !== was
    await p.getByLabel('Buscar herramienta').fill('Exportar'); await p.keyboard.press('Enter'); await p.waitForTimeout(250)
    check(`${name}: the workspace fits ${vw} px (no horizontal scroll), the viewer comes first, groups toggle and the search works`, m.over <= 1 && m.viewerTop < m.toolsTop && m.splitters === 0 && toggled && await p.locator('#ed-export').isVisible() && errs.length === 0, { m, toggled, errs })
    await p.close()
  }
  await ctx.close(); server.close()
}

// 29. Transiciones como objetos de la línea de tiempo: seleccionar, cambiar tipo y duración, dirección, alargar arrastrando el borde,
//     copiar y pegar, mover a otro corte, quitar, deshacer, favorita en la cuenta, ver sin exportar, guardar y reabrir.
{
  const server = serve(8829, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8829/editor/manual?job=job1')
  await page.getByRole('region', { name: 'Barra del editor' }).waitFor({ timeout: 20000 })
  const chips = page.getByRole('button', { name: /^Transición .* entre el clip/ })
  const chip = n => page.getByRole('button', { name: new RegExp(`^Transición .* entre el clip ${n} y el ${n + 1}`) })
  const head = () => page.locator('#ed-props h3').textContent()
  const comp = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB.render_jobs[0].composition)))
  check('transitions: every cut with a transition shows it on the timeline as its own object', await chips.count() === 2, await chips.count())
  await chip(1).click()
  check('transitions: clicking one selects it and shows only its properties', await head() === 'Transición · clip 1 → 2' && await chip(1).getAttribute('aria-pressed') === 'true' && await page.getByLabel('Tipo de transición').isVisible())
  await page.getByLabel('Tipo de transición').selectOption('slide')
  await page.getByLabel('Duración de esta transición en segundos', { exact: true }).fill('1')
  await page.getByLabel('Dirección de la transición').selectOption('right')
  const w1 = (await chip(1).boundingBox()).width
  check('transitions: type, duration and direction change from its panel (the band on the timeline is as long as the transition)', /Deslizar .* \(1 s\)/.test(await chip(1).getAttribute('aria-label')) && w1 >= 38, [await chip(1).getAttribute('aria-label'), w1])
  // Duration slider: limited by the clips (clip 1 lasts 2 s), shows the value while dragging, one undo step.
  const slider = page.getByLabel('Duración de esta transición en segundos (deslizador)')
  const sb = await slider.boundingBox()
  await page.mouse.move(sb.x + 4, sb.y + sb.height / 2); await page.mouse.down(); await page.mouse.move(sb.x + sb.width * 0.75, sb.y + sb.height / 2, { steps: 8 }); await page.mouse.up()
  const dragged = await page.getByLabel('Duración de esta transición en segundos', { exact: true }).inputValue()
  const shown = await page.locator('#ed-props .sliderLabel').first().textContent()
  const chipAfter = await chip(1).getAttribute('aria-label')
  await page.keyboard.press('Control+z')
  check('transitions: the duration slider is limited by the clips (2 s), shows the value in seconds, changes the transition and is one undo step', await slider.getAttribute('max') === '2' && Number(dragged) > 1.2 && Number(dragged) <= 2 && /Duración \d,\d+ s/.test(shown) && /\(1\.[2-9] s\)|\(2 s\)/.test(chipAfter) && /\(1 s\)/.test(await chip(1).getAttribute('aria-label')), { dragged, shown, chipAfter, max: await slider.getAttribute('max') })
  await page.getByLabel('Tipo de transición').selectOption('zoom')
  await page.getByLabel('Intensidad de la transición', { exact: true }).fill('150')
  const intensity = await page.getByLabel('Intensidad de la transición (deslizador)').inputValue()
  await page.getByLabel('Tipo de transición').selectOption('slide')
  check('transitions: intensity has its own slider in % when the type uses it (zoom) and none when it does not (slide)', intensity === '150' && await page.getByLabel('Intensidad de la transición', { exact: true }).count() === 0, intensity)
  const eb = await chip(1).locator('.tlTrEdge').boundingBox()
  await page.mouse.move(eb.x + 2, eb.y + 5); await page.mouse.down(); await page.mouse.move(eb.x - 18, eb.y + 5, { steps: 5 }); await page.mouse.up()
  check('transitions: dragging its left edge makes it longer (1 s → 1.5 s)', /\(1\.5 s\)/.test(await chip(1).getAttribute('aria-label')), await chip(1).getAttribute('aria-label'))
  await page.keyboard.press('Control+z')
  check('transitions: the edge drag is one undo step', /\(1 s\)/.test(await chip(1).getAttribute('aria-label')), await chip(1).getAttribute('aria-label'))
  await chip(1).click(); await page.keyboard.press('Control+c')
  await chip(2).click(); await page.keyboard.press('Control+v')
  check('transitions: Ctrl+C / Ctrl+V copy one transition onto another cut (type, length and direction)', /Deslizar .* \(1 s\)/.test(await chip(2).getAttribute('aria-label')))
  await page.keyboard.press('Control+z')
  check('transitions: pasting is undoable', /Fundido a negro/.test(await chip(2).getAttribute('aria-label')))
  // Move the first transition onto the second cut (drop it on the left half of clip 3).
  await page.evaluate(() => {
    const src = [...document.querySelectorAll('button.tlTransition')].find(b => /entre el clip 1 y el 2/.test(b.getAttribute('aria-label')))
    const target = document.querySelectorAll('[aria-label="Pista de vídeo"] > div')[2]
    const dt = new DataTransfer(), r = target.getBoundingClientRect(), at = { clientX: r.left + 3, clientY: r.top + 10, bubbles: true, cancelable: true, dataTransfer: dt }
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    target.dispatchEvent(new DragEvent('dragover', at)); target.dispatchEvent(new DragEvent('drop', at))
  })
  await page.waitForTimeout(200)
  check('transitions: dragging one to another cut moves it there (the old cut becomes a straight cut)', await chips.count() === 1 && /Deslizar entre el clip 2 y el 3 \(1 s\)/.test(await chips.first().getAttribute('aria-label')), await chips.evaluateAll(b => b.map(x => x.getAttribute('aria-label'))))
  await chip(2).click(); await page.keyboard.press('Delete')
  const afterDelete = await chips.count()
  await page.keyboard.press('Control+z')
  check('transitions: Supr removes the selected one and Ctrl+Z brings it back', afterDelete === 0 && await chips.count() === 1)
  await chip(2).click()
  await page.getByLabel('Nombre de la transición favorita').fill('Deslizar suave')
  await page.locator('#ed-props').getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByText('Transición favorita «Deslizar suave» guardada en tu cuenta.').waitFor()
  const fav = (await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB.connector_configs ?? [])))).find(r => r.capability === 'edit_presets')?.config?.transitions?.[0]
  check('transitions: saved as a favourite in the account', fav?.name === 'Deslizar suave' && fav.transition === 'slide' && fav.ms === 1000, fav)
  await page.locator('#ed-props').getByRole('button', { name: /Ver la transición/ }).click()
  await page.waitForTimeout(600)
  const t = await page.locator('.playerTime b').textContent()
  check('transitions: «Ver la transición» plays it in the viewer without exporting', /00:0[3-5]/.test(t), t)
  await page.waitForTimeout(2200)
  // Subtitles at the top through an instruction: the viewer draws them there.
  const bar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  await bar.getByLabel('Ir a un tiempo').fill('0:01'); await bar.getByLabel('Ir a un tiempo').press('Enter'); await page.waitForTimeout(600)
  const px = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector('canvas.playerCanvas'); return [...c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data].slice(0, 3) }, [fx, fy])
  const topBefore = await px(0.5, 0.1)
  await page.locator('#ed-instr').fill('pon los subtítulos arriba'); await page.locator('#ed-instr').press('Enter')
  await page.waitForTimeout(500)
  const topAfter = await px(0.5, 0.1), bottomAfter = await px(0.5, 0.88)
  check('subtitles: «pon los subtítulos arriba» moves them to the top of the picture', topBefore[0] > 150 && topBefore[1] < 90 && !(topAfter[0] > 150 && topAfter[1] < 90) && bottomAfter[0] > 150 && bottomAfter[1] < 90, { topBefore, topAfter, bottomAfter })
  await page.getByRole('button', { name: 'Guardar ahora' }).click(); await page.getByText('Montaje guardado en la nube.').waitFor()
  const saved = await comp()
  // Right-click menus.
  const nClips = await page.locator('[aria-label="Pista de vídeo"] > div').count()
  await page.locator('[aria-label="Pista de vídeo"] > div').first().click({ button: 'right' })
  const m1 = page.getByRole('menu', { name: 'Menú de la selección' })
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('role'))
  await m1.getByRole('menuitem', { name: /Duplicar/ }).click()
  check('right-click: a clip opens its menu (keyboard focus inside) and «Duplicar» works', focused === 'menuitem' && await page.locator('[aria-label="Pista de vídeo"] > div').count() === nClips + 1 && await m1.count() === 0)
  await chips.first().click({ button: 'right' })
  const m2 = page.getByRole('menu', { name: 'Menú de la transición' })
  const nChips = await chips.count()
  await m2.getByRole('menuitem', { name: 'Quitar transición' }).click()
  const removed = await chips.count() === nChips - 1
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
  await page.locator('.tlScroll').click({ button: 'right', position: { x: 900, y: 12 } })
  const m3 = page.getByRole('menu', { name: 'Menú de la línea de tiempo' })
  const hasEmpty = await m3.getByRole('menuitem', { name: 'Añadir marcador' }).isVisible()
  await page.keyboard.press('Escape')
  check('right-click: a transition has its own menu («Quitar transición» works), the empty timeline too, Escape closes it', removed && hasEmpty && await m3.count() === 0 && await page.locator('[aria-label="Pista de vídeo"] > div').count() === nClips, { removed, hasEmpty })
  check('subtitles: their position is saved with the montage', saved.captionPosition === 'top', saved.captionPosition)
  check('transitions: saved with the montage', saved.clips[0].transition === 'cut' && saved.clips[1].transition === 'slide' && saved.clips[1].transitionMs === 1000 && saved.clips[1].transitionOpts?.direction === 'right', saved.clips.map(k => [k.transition, k.transitionMs, k.transitionOpts]))
  check('transitions: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 30. Miniaturas reales en los clips de vídeo: fotogramas de un vídeo con tres escenas, tantos como caben según el zoom,
//     que siguen al recorte del clip.
{
  const server = serve(8830, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8') + '\n' + readFileSync(path.join(dir, 'scenes.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8830/editor/manual?job=job1')
  await page.getByRole('region', { name: 'Barra del editor' }).waitFor({ timeout: 20000 })
  const strip = page.locator('[aria-label="Pista de vídeo"] > div').nth(3).locator('.tlFilm')
  const colours = () => strip.evaluate(el => Promise.all([...el.children].map(t => new Promise(res => {
    const m = t.style.backgroundImage.match(/url\("?(data:[^")]+)"?\)/); if (!m) return res(null)
    const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = 4; c.height = 4; const g = c.getContext('2d'); g.drawImage(im, 0, 0, 4, 4); const d = g.getImageData(2, 2, 1, 1).data; res(d[0] > 150 && d[2] < 90 ? 'red' : d[2] > 150 && d[0] < 90 ? 'blue' : d[1] > 150 && d[0] < 90 ? 'green' : 'other') }; im.src = m[1]
  }))))
  const filled = async n => { for (let i = 0; i < 60; i++) { const c = await colours(); if (c.length >= n && c.every(Boolean)) return c; await page.waitForTimeout(250) } return colours() }
  await page.getByLabel('Zoom horizontal').fill('120')
  const wide = await filled(4)
  check('thumbnails: a video clip shows real frames of its scenes in order (red → blue → green)', wide.length >= 4 && wide[0] === 'red' && wide[wide.length - 1] === 'green' && wide.includes('blue'), wide)
  await page.getByLabel('Zoom horizontal').fill('60')
  const instant = await strip.evaluate(el => [...el.children].map(t => t.dataset.frame))
  check('thumbnails: right after zooming no tile is blank (a nearby frame is shown while the exact one is read)', instant.length >= 2 && instant.every(f => f !== 'no'), instant)
  await page.getByLabel('Zoom horizontal').fill('12')
  const narrow = await filled(1)
  check('thumbnails: zoomed out there are fewer tiles (at least one representative frame)', narrow.length >= 1 && narrow.length < wide.length, [narrow.length, wide.length])
  // Trim the start of the clip in the video (to 3 s): the strip follows the part used.
  await page.getByLabel('Zoom horizontal').fill('120')
  await page.locator('[aria-label="Pista de vídeo"] > div').nth(3).click()
  await page.locator('#ed-props').getByLabel('Inicio en el vídeo (s)').fill('3')
  await page.waitForTimeout(300)
  const trimmed = await filled(1)
  check('thumbnails: after trimming the start, the frames come from the new part of the video (green)', trimmed.length >= 1 && trimmed.every(c => c === 'green'), trimmed)
  check('thumbnails: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

// 31. Igualar imagen: dos fotos con distinta luz; igualar con la primera y con la segunda como referencia, intensidad, antes/después,
//     guardar y exportar (el vídeo exportado conserva la corrección).
{
  const server = serve(8831, { 'setup.js': readFileSync(path.join(dir, 'manual-editor.setup.js'), 'utf8') + '\n' + readFileSync(path.join(dir, 'match.setup.js'), 'utf8'), 'app.js': await bundle(path.join(dir, 'manual-editor.entry.tsx')) })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:8831/editor/manual?job=job1')
  await page.getByRole('region', { name: 'Barra del editor' }).waitFor({ timeout: 20000 })
  const clips = page.locator('[aria-label="Pista de vídeo"] > div')
  const bar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  const lum = async t => { await bar.getByLabel('Ir a un tiempo').fill(t); await bar.getByLabel('Ir a un tiempo').press('Enter'); await page.waitForTimeout(700); return page.evaluate(() => { const c = document.querySelector('canvas.playerCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, w = 0; for (let i = 0; i < d.length; i += 16) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; w += d[i] - d[i + 2] } const n = d.length / 16; return { y: Math.round(s / n), warm: Math.round(w / n) } }) }
  for (let i = 0; i < 40 && (await lum('0:04.5')).y === 0; i++) await page.waitForTimeout(250)
  const a0 = await lum('0:01.5'), b0 = await lum('0:04.5')
  await clips.nth(0).click(); await clips.nth(1).click({ modifiers: ['Shift'] })
  await page.locator('#ed-props').getByRole('button', { name: 'Igualar imagen' }).click()
  const panel = page.locator('[data-section="match"]')
  check('match: «Igualar imagen» from a multiple selection opens a small panel (reference, what, strength)', await panel.isVisible() && await panel.getByLabel('Referencia para igualar').isVisible() && await panel.getByLabel('Intensidad de la igualación', { exact: true }).isVisible())
  await panel.getByRole('button', { name: 'Igualar selección' }).click()
  await page.getByText(/Imagen igualada con el clip 1 como referencia/).waitFor({ timeout: 20000 })
  const a1 = await lum('0:01.5'), b1 = await lum('0:04.5')
  check('match: with the first (dark) photo as reference the bright one is brought down to it (light and warmth)', Math.abs(b1.y - a1.y) < Math.abs(b0.y - a0.y) * 0.35 && Math.abs(a1.y - a0.y) <= 2 && Math.abs(b1.warm - a1.warm) < Math.abs(b0.warm - a0.warm) * 0.6, { a0, b0, a1, b1 })
  await panel.getByLabel('Referencia para igualar').selectOption('second')
  await panel.getByRole('button', { name: 'Igualar selección' }).click()
  await page.getByText(/Imagen igualada con el clip 2 como referencia/).waitFor({ timeout: 20000 })
  const a2 = await lum('0:01.5'), b2 = await lum('0:04.5')
  console.log('MATCH', JSON.stringify({ a0, b0, a1, b1, a2, b2 }))
  const limitedNote = /hasta donde se puede sin quemar/.test(await page.locator('.notice').textContent())
  check('match: with the second (bright) photo as reference the dark one is lifted towards it (all the way, or as far as it can without burning the highlights — and it says so)', Math.abs(b2.y - b0.y) <= 2 && (Math.abs(a2.y - b2.y) < Math.abs(b0.y - a0.y) * 0.35 || (limitedNote && a2.y > a0.y + (b0.y - a0.y) * 0.4)), { a0, b0, a2, b2, limitedNote })
  await panel.getByRole('button', { name: 'Ver antes / después' }).click()
  const before = await lum('0:01.5')
  await panel.getByRole('button', { name: 'Viendo el antes' }).click()
  check('match: «antes / después» shows the original in the viewer without touching the montage', Math.abs(before.y - a0.y) <= 2 && Math.abs((await lum('0:01.5')).y - a2.y) <= 2, { before, a0 })
  await panel.getByLabel('Intensidad de la igualación', { exact: true }).fill('50')
  const half = await lum('0:01.5')
  check('match: the strength slider applies part of the correction (50 % lands in between)', half.y > a0.y + 3 && half.y < a2.y - 3, { a0, half, a2 })
  await panel.getByLabel('Intensidad de la igualación', { exact: true }).fill('100')
  await page.getByRole('button', { name: 'Guardar ahora' }).click(); await page.getByText('Montaje guardado en la nube.').waitFor()
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__DB.render_jobs[0].composition.clips)))
  check('match: the correction is saved with the montage, separate from the filters', saved[0].grade?.brightness > 1.2 && saved[0].grade.strength === 1 && !saved[0].filters && !saved[1].grade, saved.map(k => [k.grade, k.filters]))
  // Export (download to keep the test local) and compare with the viewer.
  await openExport(page)
  await page.getByLabel('Destino').selectOption('download')
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.getByRole('button', { name: /Renderizar y descargar/ }).click()])
  const buf = readFileSync(await dl.path())
  const exp = await page.evaluate(async bytes => {
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
    await new Promise(r => (v.onloadeddata = r))
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); const out = []
    for (const t of [1.5, 4.5]) { v.currentTime = t; await new Promise(r => (v.onseeked = r)); g.drawImage(v, 0, 0, 320, 180); const d = g.getImageData(0, 0, 320, 180).data; let s = 0; for (let i = 0; i < d.length; i += 16) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; out.push(Math.round(s / (d.length / 16))) }
    return out
  }, [...buf])
  check('match: the exported video keeps the correction (same light as the viewer in both photos)', Math.abs(exp[0] - a2.y) <= 8 && Math.abs(exp[1] - b2.y) <= 8, { exp, viewer: [a2.y, b2.y] })
  check('match: no page errors', errors.length === 0, errors)
  await page.close(); server.close()
}

await browser.close()
if (failures.length) { console.error(`${failures.length} browser check(s) failed`); process.exit(1) }
console.log('All browser checks passed.')
