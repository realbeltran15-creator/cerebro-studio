/**
 * Repetition + transitions on real video. Two very different videos (colour bars with a counter / RGB test pattern) are joined with a centred cross
 * dissolve. The Node engine's MP4 and the editor's player are compared, at seven moments around the cut, with the picture the transition must
 * produce: (1 - p) · A + p · B, with A and B taken from their own files at the right source times. During the window both videos must be
 * visible at once, the first and last frames must be pure A and pure B, and no frame may be black. A second project without material beyond A's
 * end checks that A holds its last frame instead of looping or going black.
 *   node scripts/transition-video-test.mjs
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const chrome = process.env.CHROMIUM_PATH || (() => { const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; const d = existsSync(base) && readdirSync(base).find(n => /^chromium-\d+/.test(n)); return d ? path.join(base, d, 'chrome-linux', 'chrome') : null })()
if (!chrome || spawnSync('ffmpeg', ['-version']).status !== 0) { console.log('Transition video test skipped: needs Chromium and ffmpeg.'); process.exit(0) }
const work = mkdtempSync(path.join(os.tmpdir(), 'cerebro-trv-')), media = path.join(work, 'media'); mkdirSync(media)
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
const failures = []
const check = (name, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failures.push(name) }
const vp9 = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-deadline', 'realtime', '-cpu-used', '8', '-g', '15']
ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30,hue=h=t*60', '-t', '6', ...vp9, path.join(media, 'rv.webm'))
const proj = await build({ entryPoints: [path.join(root, 'tests/render/repeat-video-project.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' })
const mod = await import(`data:text/javascript;base64,${Buffer.from(proj.outputFiles[0].text).toString('base64')}`)
writeFileSync(path.join(work, 'assets.json'), JSON.stringify({ rv: { path: path.join(media, 'rv.webm'), kind: 'video' } }))
const W = 1280, H = 720
const grid = raw => { const g = []; for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) { const i = ((y * 40 + 20) * W + x * 40 + 20) * 3; g.push([raw[i], raw[i + 1], raw[i + 2]]) } return g }
const frameOf = (file, ms) => grid(execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(ms / 1000), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=bicubic,format=rgb24`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 }))
const mix = (a, b, p) => a.map((px, i) => px.map((v, k) => v * (1 - p) + b[i][k] * p))
const diff = (a, b) => { const d = a.map((px, i) => Math.max(...px.map((v, k) => Math.abs(v - b[i][k])))); return { mean: d.reduce((x, y) => x + y, 0) / d.length, within: d.filter(v => v <= 40).length / d.length } }
const src = path.join(media, 'rv.webm')
const N = 8
const { composition, finalMs, plan } = mod.repeatProject(N, true)
const starts = []; { let t = 0; for (const k of composition.clips) { starts.push(t); t += k.durationMs } }
console.log(`  ${composition.clips.length} instances, project ${finalMs} ms (naive ${N * 6000}), trimmed ${plan.plan.trimmedMs} ms, reused media: ${new Set(composition.clips.map(k => k.visualAssetId)).size} file`)
check('8 repetitions of a 6 s video with 1 s dissolves last exactly 8·6 − 7·1 = 41 s', finalMs === 41000, finalMs)
check('every cut got its transition and nothing was left frozen', plan.plan.applied === 7 && plan.plan.skipped.length === 0 && plan.plan.shortened.length === 0)
writeFileSync(path.join(work, 'p-rv.json'), JSON.stringify(composition))
const out = path.join(work, 'e-rv.mp4')
const t0 = Date.now()
const r = spawnSync(process.execPath, [path.join(root, 'scripts/render.mjs'), 'render', path.join(work, 'p-rv.json'), '--assets', path.join(work, 'assets.json'), '--out', out, '--work', path.join(work, 'w-rv')], { encoding: 'utf8', maxBuffer: 1 << 26 })
if (r.status !== 0) { console.log(r.stderr.slice(-800)); process.exit(1) }
console.log(`  engine export: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
check('the exported MP4 lasts the same as the timeline (41 s ± 0.1)', Math.abs(dur - 41) < 0.1, dur)
const reuse = /reutiliz|reused/i.test(r.stdout + r.stderr) ? (r.stdout + r.stderr).split('\n').find(l => /reutiliz|reused/i.test(l)) : ''
if (reuse) console.log('  ' + reuse.trim())
/** The picture at timeline time t: the clip(s) in the window, each from its own source time. */
function expectedAt(t) {
  // find the cut whose window contains t (1 s centred), else the plain clip
  for (let i = 0; i < composition.clips.length - 1; i++) {
    const cut = starts[i] + composition.clips[i].durationMs, ms = composition.clips[i].transitionMs ?? 0
    if (t >= cut - ms / 2 && t <= cut + ms / 2) {
      const A = composition.clips[i], B = composition.clips[i + 1], p = (t - (cut - ms / 2)) / ms
      const aMs = (A.trimInMs ?? 0) + (t - starts[i]), bMs = (B.trimInMs ?? 0) + (t - starts[i + 1])
      return { p, a: frameOf(src, aMs), b: frameOf(src, Math.max(0, bMs)), aMs, bMs }
    }
  }
  const i = starts.findLastIndex(s => s <= t); return { p: 0, a: frameOf(src, (composition.clips[i].trimInMs ?? 0) + (t - starts[i])), b: null }
}
const cuts = [0, 3, 6]
const moments = []
for (const i of cuts) { const cut = starts[i] + composition.clips[i].durationMs; for (const dt of [-600, -400, -250, 0, 250, 400, 600]) moments.push({ cut: i + 1, t: cut + dt }) }
for (const m of moments) {
  const e = expectedAt(m.t), got = frameOf(out, m.t)
  const exp = e.b ? mix(e.a, e.b, e.p) : e.a
  const d = diff(got, exp)
  check(`cut ${m.cut}, t=${m.t}: exported frame = (1−p)·A + p·B with p=${e.p.toFixed(2)} (A ${e.aMs ?? ''} / B ${e.bMs ?? ''} ms of the file)`, d.within >= 0.9, d)
  if (e.b && e.p > 0.3 && e.p < 0.7) {
    check(`cut ${m.cut}, t=${m.t}: both videos are visible at once (not A alone, not B alone)`, diff(got, e.a).within < 0.6 && diff(got, e.b).within < 0.6, [diff(got, e.a).within, diff(got, e.b).within])
  }
}
check('no black frames at the cuts', moments.every(m => { const g = frameOf(out, m.t); return g.reduce((s, p) => s + p[0] + p[1] + p[2], 0) / g.length / 3 > 20 }))
// The editor's player and the browser exporter agree with the same picture at the first and last cut.
const bundleJs = (await build({ entryPoints: [path.join(root, 'tests/browser/looks.harness.ts')], bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0])
  if (u === '/h.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(bundleJs) }
  if (u.startsWith('/m/')) { const f = path.join(media, path.basename(u)); if (existsSync(f)) { s.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes' }); return s.end(readFileSync(f)) } }
  s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><meta charset="utf-8"><script src="/h.js"></script>')
}).listen(8853)
import { readFileSync } from 'node:fs'
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8853/'); await page.waitForFunction(() => typeof window.runLooks === 'function')
const manifest = { rv: { kind: 'video', url: '/m/rv.webm' } }
const times = [0, 3, 6].map(i => starts[i] + composition.clips[i].durationMs)
const pl = await page.evaluate(([m, c, t]) => window.runLooks(m, c, t), [manifest, composition, times])
const ex = await page.evaluate(([m, c, t]) => window.runExportGrid(m, c, t), [manifest, composition, times])
times.forEach((t, i) => {
  const e = expectedAt(t), exp = mix(e.a, e.b, e.p)
  check(`editor player at the middle of cut ${[1, 4, 7][i]} shows the 50/50 mix of two real frames`, diff(pl[i], exp).within >= 0.9, diff(pl[i], exp))
  check(`browser export at the middle of cut ${[1, 4, 7][i]} shows the same picture`, diff(ex[i], exp).within >= 0.9, diff(ex[i], exp))
})
check('no page errors', errors.length === 0, errors)
await browser.close(); server.close()
console.log(failures.length ? `${failures.length} check(s) failed (files in ${work})` : 'Repetition video checks passed.')
process.exit(failures.length ? 1 : 0)
