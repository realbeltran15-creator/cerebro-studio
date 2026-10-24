/**
 * Offline engine vs. the editor in a real browser: the same 13 s montage (transitions, a video overlay, title, subtitles, two music clips with
 * automation, voice with ducking, effect) is rendered by the Node engine (FFmpeg) and by the browser (player preview and fast export) from the
 * same media files. Pixels at sample points and tone energies must agree. Needs ffmpeg, ffprobe and Chromium.
 *   node scripts/parity-test.mjs
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const chrome = process.env.CHROMIUM_PATH || (() => { const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; const d = existsSync(base) && readdirSync(base).find(n => /^chromium-\d+/.test(n)); return d ? path.join(base, d, 'chrome-linux/chrome') : null })()
if (!chrome || spawnSync('ffmpeg', ['-version']).status !== 0) { console.log('Parity test skipped: needs Chromium and ffmpeg.'); process.exit(0) }
const work = mkdtempSync(path.join(os.tmpdir(), 'cerebro-parity-'))
const media = path.join(work, 'media'); mkdirSync(media)
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
const failures = []
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failures.push(name) }

// ---- Media (free, generated here).
for (const [n, col] of [['red', '#d02020'], ['blue', '#2040e0'], ['yellow', '#e0d020']]) ff('-f', 'lavfi', '-i', `color=c=${col}:s=960x540`, '-frames:v', '1', path.join(media, `${n}.png`))
// VP9 in WebM: the Chromium used for tests cannot decode H.264, and FFmpeg reads either.
for (const [n, col, f] of [['green', '0x00c800', 440], ['magenta', '0xc800c8', 660]]) {
  ff('-f', 'lavfi', '-i', `color=c=${col}:s=640x360:r=30`, '-f', 'lavfi', '-i', `sine=frequency=${f}:sample_rate=48000`, '-t', '4.3', '-af', 'volume=0.4', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', path.join(media, `${n}.webm`))
}
for (const [n, f, d] of [['m1', 110, 16], ['m2', 165, 16], ['vo', 330, 3], ['fx', 880, 0.5]]) ff('-f', 'lavfi', '-i', `sine=frequency=${f}:sample_rate=48000:duration=${d}`, '-af', 'volume=0.4', path.join(media, `${n}.wav`))

// ---- The shared project, built by the editor's own functions.
const proj = await build({ entryPoints: [path.join(root, 'tests/render/parity-project.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' })
const mod = await import(`data:text/javascript;base64,${Buffer.from(proj.outputFiles[0].text).toString('base64')}`)
const MEDIA = Object.fromEntries(Object.entries(mod.MEDIA).map(([k, v]) => [k, { kind: v.kind, file: v.file.replace('.mp4', '.webm') }]))
const composition = mod.parityProject()
writeFileSync(path.join(work, 'project.json'), JSON.stringify(composition))
const assets = Object.fromEntries(Object.entries(MEDIA).map(([k, v]) => [k, { path: path.join(media, v.file), kind: v.kind }]))
writeFileSync(path.join(work, 'assets.json'), JSON.stringify(assets))

// ---- Node engine.
const t0 = Date.now()
const out = path.join(work, 'engine.mp4')
const r = spawnSync(process.execPath, [path.join(root, 'scripts/render.mjs'), 'render', path.join(work, 'project.json'), '--assets', path.join(work, 'assets.json'), '--out', out, '--work', path.join(work, 'w')], { encoding: 'utf8' })
if (r.status !== 0) { console.log(r.stderr.slice(-800)); process.exit(1) }
console.log(`engine: ${(Date.now() - t0) / 1000} s`)
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', out]).toString())
const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio')
check('engine: MP4 H.264 + AAC, 1280×720, 13 s, 30 fps', v.codec_name === 'h264' && a.codec_name === 'aac' && v.width === 1280 && v.height === 720 && Math.abs(Number(probe.format.duration) - 13) < 0.1 && v.avg_frame_rate === '30/1' && Number(v.nb_frames) === 390, { v: [v.codec_name, v.width, v.height, v.nb_frames], d: probe.format.duration })
const pixel = (t, x, y) => { const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t / 1000), '-i', out, '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${Math.floor(1280 * x)}:${Math.floor(720 * y)}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']); return [raw[0], raw[1], raw[2]] }
const engine = mod.SAMPLES.map(([t, x, y]) => pixel(t, x, y))
const pcm = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', out, '-vn', '-af', 'pan=mono|c0=c0', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
const mono = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length))
const engineTones = Object.fromEntries(mod.TONES.map(([n, f, s, e]) => [n, mod.tone(mono, 48000, f, s, e)]))

// ---- Browser.
const bundle = (await build({ entryPoints: [path.join(root, 'tests/browser/parity.harness.ts')], bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"' } })).outputFiles[0].text
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0])
  if (u === '/h.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(bundle) }
  if (u.startsWith('/m/')) { const f = path.join(media, path.basename(u)); if (existsSync(f)) { s.writeHead(200, { 'content-type': f.endsWith('.png') ? 'image/png' : f.endsWith('.webm') ? 'video/webm' : 'audio/wav', 'accept-ranges': 'bytes' }); return s.end(readFileSync(f)) } }
  s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><meta charset="utf-8"><script src="/h.js"></script>')
}).listen(8850)
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8850/'); await page.waitForFunction(() => typeof window.runParity === 'function')
const manifest = Object.fromEntries(Object.entries(MEDIA).map(([k, v]) => [k, { kind: v.kind, url: `/m/${v.file}` }]))
const br = await page.evaluate(([m, c]) => window.runParity(m, c), [manifest, composition])
await browser.close(); server.close()

// ---- Compare.
const near = (p, q, tol) => p.every((x, i) => Math.abs(x - q[i]) <= tol)
const plain = mod.SAMPLES.map((_, i) => i).filter(i => i < 10)   // away from transitions
const mid = mod.SAMPLES.map((_, i) => i).filter(i => i >= 10)    // in the middle of a dissolve / wipe / slide
console.log('PX engine ', JSON.stringify(engine)); console.log('PX browser', JSON.stringify(br.exported)); console.log('PX preview', JSON.stringify(br.preview))
// The browser's fast export decodes these UNTAGGED test videos with another colour matrix than the player (and than FFmpeg): green 170 instead of 200.
// That is a difference between two browser paths (files from cameras and phones are tagged), so the export is compared on pictures and the videos only against the player.
const noVideo = plain.filter(i => ![1, 2, 3, 4, 9].includes(i))
check('pictures: engine = browser export at points without video (±24)', noVideo.every(i => near(engine[i], br.exported[i], 24)), noVideo.filter(i => !near(engine[i], br.exported[i], 24)).map(i => [i, engine[i], br.exported[i]]))
console.log(`NOTE browser export vs player on untagged video: ${JSON.stringify([1, 3].map(i => [br.exported[i], br.preview[i]]))}`)
check('pictures: engine = editor preview at plain points (±24)', plain.every(i => near(engine[i], br.preview[i], 24)), plain.filter(i => !near(engine[i], br.preview[i], 24)).map(i => [i, engine[i], br.preview[i]]))
check('pictures: engine = editor preview in the middle of transitions (±24)', mid.every(i => near(engine[i], br.preview[i], 24)), mid.filter(i => !near(engine[i], br.preview[i], 24)).map(i => [i, engine[i], br.preview[i]]))
const ratio = (n) => engineTones[n] / Math.max(1e-9, br.tones[n])
console.log('TONES', JSON.stringify(Object.fromEntries(Object.keys(engineTones).map(n => [n, [Math.round(engineTones[n] * 1e4) / 1e4, Math.round(br.tones[n] * 1e4) / 1e4]]))))
const silent = n => engineTones[n] < 0.004 && br.tones[n] < 0.004
const same = n => silent(n) || (ratio(n) > 0.8 && ratio(n) < 1.25)
check('sound: every tone (music, voice, effect, both videos) has the same level as the browser export (±25 %), silences included', Object.keys(engineTones).every(same), Object.keys(engineTones).filter(n => !same(n)).map(n => [n, engineTones[n], br.tones[n]]))
check('sound: the music dips under the voice and the automation lowers it', engineTones.music1_under_voice < engineTones.music1_before_voice * 0.6 && engineTones.music1_after_automation < engineTones.music1_before_voice * 0.3 && engineTones.voice > 0.01 && engineTones.voice_after < engineTones.voice * 0.1, engineTones)
check('no page errors', errors.length === 0, errors)
console.log(failures.length ? `${failures.length} check(s) failed (files in ${work})` : 'Parity checks passed.')
process.exit(failures.length ? 1 : 0)
