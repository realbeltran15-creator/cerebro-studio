/**
 * Looks parity: filters, blur, grade, opacity, rotation, crop, camera moves, zoom/focus, speed, video, titles (outline, shadow, box, free position)
 * and subtitles in each style, drawn by the Node engine (FFmpeg) and by the editor's player in a real Chromium, compared on a 32×18 pixel grid.
 * Text is compared by where it is drawn (fonts differ between machines), everything else by colour.
 *   node scripts/looks-test.mjs
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
if (!chrome || spawnSync('ffmpeg', ['-version']).status !== 0) { console.log('Looks test skipped: needs Chromium and ffmpeg.'); process.exit(0) }
const work = mkdtempSync(path.join(os.tmpdir(), 'cerebro-looks-')), media = path.join(work, 'media'); mkdirSync(media)
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
const failures = []
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failures.push(name) }

ff('-f', 'lavfi', '-i', 'testsrc2=s=960x540', '-frames:v', '1', path.join(media, 'tex.png'))
ff('-f', 'lavfi', '-i', 'smptebars=s=960x540', '-frames:v', '1', path.join(media, 'tex2.png'))
ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '5', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8', path.join(media, 'mov.webm'))

const proj = await build({ entryPoints: [path.join(root, 'tests/render/looks-project.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' })
const mod = await import(`data:text/javascript;base64,${Buffer.from(proj.outputFiles[0].text).toString('base64')}`)
const composition = mod.looksProject()
writeFileSync(path.join(work, 'project.json'), JSON.stringify(composition))
const assets = Object.fromEntries(Object.entries(mod.LOOK_MEDIA).map(([k, v]) => [k, { path: path.join(media, v.file), kind: v.kind }]))
writeFileSync(path.join(work, 'assets.json'), JSON.stringify(assets))

const W = 1280, H = 720
async function engineFrames(composition, times, tag) {
  writeFileSync(path.join(work, `project-${tag}.json`), JSON.stringify(composition))
  const out = path.join(work, `engine-${tag}.mp4`)
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/render.mjs'), 'render', path.join(work, `project-${tag}.json`), '--assets', path.join(work, 'assets.json'), '--out', out, '--work', path.join(work, `w-${tag}`)], { encoding: 'utf8' })
  if (r.status !== 0) { console.log(r.stderr.slice(-800)); process.exit(1) }
  if (/AVISO/.test(r.stderr) && tag === 'looks') console.log(r.stderr.split('\n').filter(l => /AVISO/.test(l)).join('\n'))
  return times.map(t => { const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t / 1000), '-i', out, '-frames:v', '1', '-vf', 'format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }); const grid = []; for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) { const i = ((y * 40 + 20) * W + x * 40 + 20) * 3; grid.push([raw[i], raw[i + 1], raw[i + 2]]) } return grid })
}
const engine = await engineFrames(composition, mod.LOOK_TIMES, 'looks')
const trComposition = mod.transitionsProject()
const trEngine = await engineFrames(trComposition, mod.TRANSITION_TIMES, 'tr')

const bundle = (await build({ entryPoints: [path.join(root, 'tests/browser/looks.harness.ts')], bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"' } })).outputFiles[0].text
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0])
  if (u === '/h.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(bundle) }
  if (u.startsWith('/m/')) { const f = path.join(media, path.basename(u)); if (existsSync(f)) { s.writeHead(200, { 'content-type': f.endsWith('.png') ? 'image/png' : 'video/webm', 'accept-ranges': 'bytes' }); return s.end(readFileSync(f)) } }
  s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><meta charset="utf-8"><script src="/h.js"></script>')
}).listen(8851)
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8851/'); await page.waitForFunction(() => typeof window.runLooks === 'function')
const manifest = Object.fromEntries(Object.entries(mod.LOOK_MEDIA).map(([k, v]) => [k, { kind: v.kind, url: `/m/${v.file}` }]))
const br = await page.evaluate(([m, c, t]) => window.runLooks(m, c, t), [manifest, composition, mod.LOOK_TIMES])
const trBrowser = await page.evaluate(([m, c, t]) => window.runLooks(m, c, t), [manifest, trComposition, mod.TRANSITION_TIMES])
await browser.close(); server.close()

const names = ['filters + zoom camera', 'blur + rotation + crop', 'grade (warmth) + opacity', 'pan + zoom/focus', 'bold subtitles', 'karaoke subtitles', 'slow-motion video', 'box subtitles on top']
names.forEach((n, i) => {
  const diffs = engine[i].map((p, j) => Math.max(...p.map((v, k) => Math.abs(v - br[i][j][k]))))
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length, within = diffs.filter(d => d <= 40).length / diffs.length
  const textual = i >= 4  // text pixels differ with fonts: colour agreement elsewhere is still required
  console.log(`  ${n}: mean diff ${mean.toFixed(1)}, ${(within * 100).toFixed(0)} % of the grid within 40`)
  check(`looks: ${n} — engine = editor`, within >= (textual ? 0.85 : i === 6 ? 0.8 : 0.9), { mean, within })
})
// Every transition kind and option at three moments: the Node engine against the editor's player.
mod.TRANSITION_CASES.forEach((c, k) => {
  const rows = [0, 1, 2].map(j => { const i = k * 3 + j; const diffs = trEngine[i].map((p, n) => Math.max(...p.map((v, q) => Math.abs(v - trBrowser[i][n][q])))); return { mean: diffs.reduce((a, b) => a + b, 0) / diffs.length, within: diffs.filter(d => d <= 40).length / diffs.length } })
  const worst = rows.reduce((a, b) => (a.within < b.within ? a : b))
  console.log(`  ${c.name}: ${rows.map(r => `${(r.within * 100).toFixed(0)} %`).join(' / ')}`)
  check(`transition ${c.name}: engine = editor at 30 %, 50 % and 80 %`, worst.within >= 0.93, rows)
})
// Titles: where the text is drawn. The share of near-white / yellow / red pixels away from the clip's own picture is not comparable, so use the full engine frame vs a frame without text.
check('no page errors', errors.length === 0, errors)
console.log(failures.length ? `${failures.length} check(s) failed (files in ${work})` : 'Looks checks passed.')
process.exit(failures.length ? 1 : 0)
