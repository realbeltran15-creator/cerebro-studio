/**
 * End-to-end check of the manual editor with REAL media, driven in a real Chromium like a person would:
 * import a video → upload music and an effect → open the manual editor → set the length → adjust levels → save →
 * close and reopen → render → analyse the exported file with ffprobe/ffmpeg.
 *
 * What is real: the pages, the import and upload code, the editor, the in-browser renderer (MediaRecorder + WebAudio),
 * the media files and the analysis of the result. What is NOT real: Supabase and the storage bucket (replaced by an
 * in-browser stand-in, see tests/browser/lofi.setup.js), because this needs a logged-in account.
 * Run with `npm run test:e2e-lofi`. Needs ffmpeg and ffprobe on the PATH and a Chromium (CHROMIUM_PATH or Playwright's).
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const dir = path.join(root, 'tests/browser')
const chrome = process.env.CHROMIUM_PATH || (() => {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  const d = existsSync(base) && readdirSync(base).find(n => /^chromium-\d+/.test(n))
  return d ? path.join(base, d, 'chrome-linux/chrome') : null
})()
const have = cmd => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0
if (!chrome || !existsSync(chrome) || !have('ffmpeg') || !have('ffprobe')) { console.log('E2E lo-fi skipped: needs Chromium, ffmpeg and ffprobe.'); process.exit(0) }

const failures = []
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failures.push(name) }
const work = process.env.E2E_OUT || mkdtempSync(path.join(os.tmpdir(), 'cerebro-lofi-'))
mkdirSync(work, { recursive: true })

// ---------- 1. Free test media, generated locally (no download, no provider, no credit) ----------
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
// A 6 s lo-fi style loop: slow warm gradient, film grain and a soft vignette, no audio of its own.
// VP9/WebM on purpose: the Chromium that ships with this test environment has no H.264 decoder (Chrome and Edge do), so it could not play an MP4.
ff('-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x2b1d3f:c1=0xe9a67a:c2=0x5a3e6b:speed=0.03:d=6:r=30', '-vf', 'noise=alls=14:allf=t+u,vignette=PI/5,format=yuv420p', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-deadline', 'realtime', '-cpu-used', '8', '-an', path.join(work, 'lofi-clip.webm'))
// 8 s of mellow music: a slow Am7 → Fmaj7 pad with tremolo, low-passed and echoed, stereo 44.1 kHz.
ff('-f', 'lavfi', '-i', 'aevalsrc=0.20*sin(2*PI*220*t)+0.16*sin(2*PI*261.63*t)+0.14*sin(2*PI*329.63*t)+0.12*sin(2*PI*392*t):s=44100:d=8', '-af', 'tremolo=f=0.6:d=0.4,lowpass=f=1400,aecho=0.7:0.6:350:0.35,volume=0.9,aformat=channel_layouts=stereo', path.join(work, 'lofi-music.wav'))
// A 1.2 s rain-drop / vinyl crackle effect: filtered white noise with a fast attack and release, clearly louder than the music.
ff('-f', 'lavfi', '-i', 'anoisesrc=d=1.2:c=white:a=0.9:r=44100', '-af', 'highpass=f=2500,afade=t=in:d=0.02,afade=t=out:st=0.9:d=0.3,volume=1.4,aformat=channel_layouts=stereo', path.join(work, 'lofi-sfx.wav'))

ff('-f', 'lavfi', '-i', 'color=c=0x3b2a50:s=640x360:d=1', '-frames:v', '1', path.join(work, 'extra-image.png'))
ff('-f', 'lavfi', '-i', 'sine=f=660:d=1.5', '-ac', '2', path.join(work, 'extra-tone.wav'))

// ---------- 2. App bundle ----------
const bundle = async () => (await build({
  entryPoints: [path.join(dir, 'lofi.entry.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL': '""', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID': 'undefined', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY': 'undefined', 'process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID': 'undefined' }, alias: { '@': root },
  plugins: [{ name: 'mocks', setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, () => ({ path: path.join(dir, 'mocks/next.tsx') }))
    b.onResolve({ filter: /^(@|\.\.\/\.\.)\/?(lib\/supabase\/client)$|^@\/lib\/supabase\/client$/ }, () => ({ path: path.join(dir, 'mocks/supabase.ts') }))
  } }],
})).outputFiles[0].text
const appJs = await bundle()
const setupJs = readFileSync(path.join(dir, 'lofi.setup.js'), 'utf8')
const server = http.createServer((q, r) => {
  const name = q.url.split('?')[0].slice(1)
  if (name === 'setup.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(setupJs) }
  if (name === 'app.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(appJs) }
  r.writeHead(200, { 'content-type': 'text/html' })
  r.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/setup.js"></script><script src="/app.js"></script>')
}).listen(8799)

// ---------- 3. Drive the app ----------
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('dialog', d => d.accept())
const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__DB)))
const base = 'http://127.0.0.1:8799'
const last = a => a[a.length - 1]

try {
  // A. Import the video the way the Flow import does it.
  await page.goto(`${base}/import`)
  await page.getByText('Importar vídeos creados en Google Flow').waitFor({ timeout: 20000 })
  await page.setInputFiles('#flow-files', path.join(work, 'lofi-clip.webm'))
  await page.getByLabel(/Confirmo que creé estos vídeos/).check()
  await page.getByRole('button', { name: /Importar 1 seleccionado/ }).click()
  await page.getByText(/1 vídeo\(s\) importados/).waitFor({ timeout: 30000 })
  const afterImport = await db()
  const video = afterImport.assets.find(a => a.asset_type === 'video')
  check('A. the video was imported into the Library with its real duration', Boolean(video) && video.provenance.durationSeconds >= 5.5 && video.provenance.durationSeconds <= 6.5 && video.provenance.mimeType === 'video/webm', video?.provenance)
  const editHref = await page.getByRole('link', { name: 'Editar en el Editor manual' }).getAttribute('href')
  check('A. the import offers "Editar en el Editor manual" with that file', /^\/editor\/manual\?project=p1&assets=/.test(editHref) && editHref.includes(video.id), editHref)

  // A2. Upload music and an effect on the real Audio page ("Subir con licencia").
  await page.goto(`${base}/audio?project=p1`)
  await page.getByRole('button', { name: /Subir con licencia/ }).click()
  for (const [file, kind, title] of [['lofi-music.wav', 'music', 'Pad lo-fi'], ['lofi-sfx.wav', 'sfx', 'Gotas de lluvia']]) {
    await page.locator('#audio-kind').selectOption(kind)
    await page.locator('#audio-license').selectOption('owned')
    await page.setInputFiles('#audio-file', path.join(work, file))
    await page.locator('#audio-title').fill(title)
    await page.getByRole('button', { name: 'Añadir al proyecto' }).click()
    await page.waitForFunction(t => window.__DB.assets.some(a => a.provenance?.title === t), title, { timeout: 30000 }).catch(async e => { throw new Error(`${e.message.split('\n')[0]} | pantalla: ${(await page.locator('.error, .notice, [role=alert], [role=status]').allInnerTexts()).join(' / ').slice(0, 300)}`) })
  }
  const all = await db()
  const music = all.assets.find(a => a.asset_type === 'music'), sfx = all.assets.find(a => a.asset_type === 'sfx')
  check('A. music and effect were uploaded and stored with their files', Boolean(music && sfx) && music.provenance.durationSeconds > 7 && sfx.provenance.durationSeconds > 1, { music: music?.provenance, sfx: sfx?.provenance })

  // B. Library → Editor manual: the link from the import opens an edit with the video already on the timeline.
  await page.goto(`${base}${editHref}`)
  await page.getByRole('button', { name: 'Guardar montaje' }).waitFor({ timeout: 30000 })
  check('B. the manual editor opened by itself with the video on the picture track', (await page.locator('[aria-label="Pista de vídeo"] > div').count()) === 1)

  // C. Edit: length to 5 s, music + effect, levels, save.
  await page.locator('[aria-label="Pista de vídeo"] > div').first().click()
  await page.locator('label', { hasText: /^Duración \(s\)/ }).locator('input').first().fill('5')
  const addAudio = async (assetId, kind) => {
    await page.locator('label', { hasText: /^Audio/ }).locator('select').selectOption(assetId)
    await page.locator('label', { hasText: /^Pista/ }).locator('select').selectOption(kind)
    await page.getByRole('button', { name: /Añadir al inicio/ }).click()
  }
  await addAudio(music.id, 'music')
  await page.locator('[aria-label="Pista de Música"] > div').first().click()
  await page.locator('label', { hasText: /^Volumen \(/ }).locator('input').fill('0.35')
  await addAudio(sfx.id, 'sfx')
  await page.locator('[aria-label="Pista de Efectos"] > div').first().click()
  await page.locator('label', { hasText: /^Inicio \(s\)/ }).locator('input').fill('2')
  await page.locator('label', { hasText: /^Volumen \(/ }).locator('input').fill('0.8')
  await page.getByRole('button', { name: 'Guardar montaje' }).click()
  await page.getByText('Montaje guardado.').waitFor({ timeout: 10000 })
  const saved = await db()
  const job = last(saved.render_jobs.filter(j => j.status === 'draft'))
  const comp = job.composition
  const sfxClip = comp.audioClips.find(a => a.kind === 'sfx'), musicClip = comp.audioClips.find(a => a.kind === 'music')
  check('C. the edit was saved with 5 s of video, music at 35% and the effect at 2 s / 80%', comp.clips.length === 1 && Math.round(comp.clips[0].durationMs) === 5000 && Math.abs(musicClip.volume - 0.35) < 0.001 && Math.abs(sfxClip.volume - 0.8) < 0.001 && Math.abs((sfxClip.startMs ?? 0) - 2000) < 5, comp)

  // D. Close and reopen: everything must come back from the stored edit.
  await page.goto(`${base}/editor/manual`)
  await page.getByRole('heading', { name: /Montajes guardados/ }).waitFor({ timeout: 20000 })
  await page.getByRole('link', { name: 'Abrir' }).first().click()
  await page.getByRole('button', { name: 'Guardar montaje' }).waitFor({ timeout: 30000 })
  check('D. reopening from the list loads the edit (the "Abrir" button works)', (await page.locator('[aria-label="Pista de vídeo"] > div').count()) === 1 && (await page.locator('[aria-label="Pista de Música"] > div').count()) === 1 && (await page.locator('[aria-label="Pista de Efectos"] > div').count()) === 1)
  await page.locator('[aria-label="Pista de Efectos"] > div').first().click()
  check('D. the effect kept its start (2 s) and volume (80%) after reopening', (await page.locator('label', { hasText: /^Inicio \(s\)/ }).locator('input').inputValue()) === '2' && (await page.getByText(/Volumen \(80%\)/).count()) === 1)

  // E. Export, then analyse the real file.
  await page.getByRole('button', { name: /Renderizar y guardar/ }).click()
  await page.getByText(/Vídeo guardado en la Biblioteca/).waitFor({ timeout: 90000 })
  const rendered = (await db()).assets.find(a => a.source_provider === 'browser-render')
  check('E. a render was produced and saved in the Library', Boolean(rendered), null)
  const b64 = await page.evaluate(async p => { const blob = await window.__getBlob(p); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s) }, rendered.storage_path)
  const ext = /mp4/.test(rendered.provenance.mimeType ?? '') ? 'mp4' : 'webm'
  const out = path.join(work, `lofi-export.${ext}`)
  writeFileSync(out, Buffer.from(b64, 'base64'))
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', out]).toString())
  const v = probe.streams.find(s => s.codec_type === 'video'), au = probe.streams.find(s => s.codec_type === 'audio')
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { encoding: 'utf8' })
  // The container header must carry the length (MediaRecorder leaves it out; the app adds it). Also measure the real length from the packets.
  const headerDuration = Number(probe.format.duration)
  const lastPts = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', out]).toString().trim().split('\n').filter(Boolean).pop())
  const dur = Number.isFinite(headerDuration) ? headerDuration : lastPts
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 64 * 1024 * 1024 })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  const win = 1600 // 100 ms
  const rms = []
  for (let i = 0; i + win <= samples.length; i += win) { let s = 0; for (let k = 0; k < win; k++) s += (samples[i + k] / 32768) ** 2; rms.push(Math.sqrt(s / win)) }
  const audioSeconds = samples.length / 16000
  const db20 = x => 20 * Math.log10(Math.max(x, 1e-6))
  const avg = (a, from, to) => a.slice(Math.round(from * 10), Math.round(to * 10)).reduce((x, y) => x + y, 0) / Math.max(1, Math.round(to * 10) - Math.round(from * 10))
  const musicBefore = avg(rms, 0.3, 1.7), sfxWindow = avg(rms, 2.1, 2.9), musicAfter = avg(rms, 3.6, 4.7)
  const onset = (rms.findIndex((x, i) => i >= 8 && x > musicBefore * 3) / 10)
  console.log(`   file: ${out}\n   container ${probe.format.format_name}, video ${v?.codec_name} ${v?.width}x${v?.height}, audio ${au?.codec_name} ${au?.sample_rate} Hz, duration ${dur.toFixed(2)} s in the header (last video frame at ${lastPts.toFixed(2)} s, audio ${audioSeconds.toFixed(2)} s)\n   music level ${db20(musicBefore).toFixed(1)} dBFS before, effect window ${db20(sfxWindow).toFixed(1)} dBFS, music after ${db20(musicAfter).toFixed(1)} dBFS, effect onset ${onset.toFixed(1)} s`)
  check('E. the exported file decodes without errors', decoded.status === 0 && !decoded.stderr.trim(), decoded.stderr.slice(0, 200))
  check('E. it has a video stream and an audio stream', Boolean(v && au), probe.streams.map(s => s.codec_type))
  check('E. the file header declares its duration (players can show the length and seek)', Number.isFinite(headerDuration), { headerDuration })
  check('E. its duration is about 5 s (4.6–5.8) in the header, the picture and the audio', dur >= 4.6 && dur <= 5.8 && lastPts >= 4.4 && lastPts <= 5.8 && audioSeconds >= 4.5 && audioSeconds <= 5.8, { dur, lastPts, audioSeconds })
  check('E. the music is present before and after the effect', db20(musicBefore) > -55 && db20(musicAfter) > -55, { before: db20(musicBefore), after: db20(musicAfter) })
  check('E. the effect is clearly audible and starts at about 2 s (±0.4 s)', sfxWindow > musicBefore * 3 && Math.abs(onset - 2) <= 0.4, { onset, ratio: sfxWindow / musicBefore })
  check('E. the picture is not black (the lo-fi video is in the render)', await (async () => {
    const frame = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1.5', '-i', out, '-frames:v', '1', '-vf', 'scale=16:9,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 })
    const mean = frame.reduce((a, b) => a + b, 0) / frame.length
    return mean > 25
  })(), null)

  // F. Importing from inside the editor, with the file picker and by dropping files on the timeline.
  const before = await db()
  const clipsBefore = before.render_jobs.find(j => j.id === job.id).composition.clips.length
  await page.locator('#mi-akind').selectOption('sfx')
  await page.setInputFiles('#mi-files', [path.join(work, 'extra-image.png'), path.join(work, 'extra-tone.wav')])
  await page.getByText(/2 archivo\(s\) importados a la Biblioteca y añadidos a la línea de tiempo/).waitFor({ timeout: 30000 })
  const afterPick = await db()
  check('F. the file picker in the editor stored an image and an audio file in the Library', afterPick.assets.some(a => a.asset_type === 'image' && a.provenance.originalFilename === 'extra-image.png') && afterPick.assets.some(a => a.asset_type === 'sfx' && a.provenance.originalFilename === 'extra-tone.wav'), afterPick.assets.map(a => `${a.asset_type}:${a.provenance?.originalFilename}`))
  check('F. the image became a new clip and the audio a new block on the effects track', (await page.locator('[aria-label="Pista de vídeo"] > div').count()) === clipsBefore + 1 && (await page.locator('[aria-label="Pista de Efectos"] > div').count()) === 2)
  const dropped = await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped-image.png', { type: 'image/png' }))
    const target = document.querySelector('[aria-label="Pista de vídeo"]').closest('section')
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    return true
  }, readFileSync(path.join(work, 'extra-image.png')).toString('base64'))
  await page.waitForFunction(() => window.__DB.assets.some(a => a.provenance?.originalFilename === 'dropped-image.png'), null, { timeout: 30000 })
  check('F. dropping a file on the timeline imports it and adds a clip', dropped && (await page.locator('[aria-label="Pista de vídeo"] > div').count()) === clipsBefore + 2)
  await page.getByRole('button', { name: 'Guardar montaje' }).click()
  await page.getByText('Montaje guardado.').waitFor({ timeout: 10000 })
  check('no page errors during the whole walk-through', errors.length === 0, errors)
} catch (e) {
  await page.screenshot({ path: path.join(work, 'failure.png'), fullPage: true }).catch(() => undefined)
  const where = await page.evaluate(() => ({ url: location.pathname + location.search, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 500) })).catch(() => null)
  check(`walk-through interrupted: ${String(e.message).split('\n')[0]}`, false, { errors, where })
} finally {
  await browser.close(); server.close()
}
console.log(`\nFiles kept in ${work}`)
if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1) }
console.log('E2E lo-fi passed.')
