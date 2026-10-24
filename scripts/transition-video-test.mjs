/**
 * Real two-video transition check. Two very different videos (colour bars with a counter / RGB test pattern) are joined with a centred cross
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
ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '10', ...vp9, path.join(media, 'va.webm'))
ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '4', ...vp9, path.join(media, 'vs.webm'))
ff('-f', 'lavfi', '-i', 'rgbtestsrc=s=640x360:r=30', '-t', '10', ...vp9, path.join(media, 'vb.webm'))

const proj = await build({ entryPoints: [path.join(root, 'tests/render/transition-video-project.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' })
const mod = await import(`data:text/javascript;base64,${Buffer.from(proj.outputFiles[0].text).toString('base64')}`)
writeFileSync(path.join(work, 'assets.json'), JSON.stringify(Object.fromEntries(Object.entries(mod.TV_MEDIA).map(([k, v]) => [k, { path: path.join(media, v.file), kind: v.kind }]))))

const W = 1280, H = 720
const grid = raw => { const g = []; for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) { const i = ((y * 40 + 20) * W + x * 40 + 20) * 3; g.push([raw[i], raw[i + 1], raw[i + 2]]) } return g }
const frameOf = (file, ms) => grid(execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(ms / 1000), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=bicubic,format=rgb24`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }))
function engineFrames(composition, tag) {
  writeFileSync(path.join(work, `p-${tag}.json`), JSON.stringify(composition))
  const out = path.join(work, `e-${tag}.mp4`)
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/render.mjs'), 'render', path.join(work, `p-${tag}.json`), '--assets', path.join(work, 'assets.json'), '--out', out, '--work', path.join(work, `w-${tag}`)], { encoding: 'utf8' })
  if (r.status !== 0) { console.log(r.stderr.slice(-800)); process.exit(1) }
  return mod.TV_TIMES.map(t => frameOf(out, t))
}
const mix = (a, b, p) => a.map((px, i) => px.map((v, k) => v * (1 - p) + b[i][k] * p))
const diff = (a, b) => { const d = a.map((px, i) => Math.max(...px.map((v, k) => Math.abs(v - b[i][k])))); return { mean: d.reduce((x, y) => x + y, 0) / d.length, within: d.filter(v => v <= 40).length / d.length } }
const A = ms => frameOf(path.join(media, 'va.webm'), ms), B = ms => frameOf(path.join(media, 'vb.webm'), ms)
const startW = mod.CUT_MS - mod.WINDOW_MS / 2
/** The picture the transition must produce at t, given how far A's file reaches past its end. */
function expected(t, handles) {
  const p = Math.min(1, Math.max(0, (t - startW) / mod.WINDOW_MS))
  const aMs = handles ? t : Math.min(t, mod.CUT_MS - 40), bMs = mod.B_TRIM_MS + (t - mod.CUT_MS)
  return p <= 0 ? A(aMs) : p >= 1 ? B(bMs) : mix(A(aMs), B(bMs), p)
}

const bundle = (await build({ entryPoints: [path.join(root, 'tests/browser/looks.harness.ts')], bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0])
  if (u === '/h.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(bundle) }
  if (u.startsWith('/m/')) { const f = path.join(media, path.basename(u)); if (existsSync(f)) { s.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes' }); return s.end(readFileSync(f)) } }
  s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><meta charset="utf-8"><script src="/h.js"></script>')
}).listen(8852)
import { readFileSync } from 'node:fs'
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8852/'); await page.waitForFunction(() => typeof window.runLooks === 'function')
const manifest = Object.fromEntries(Object.entries(mod.TV_MEDIA).map(([k, v]) => [k, { kind: v.kind, url: `/m/${v.file}` }]))
const player = (c) => page.evaluate(([m, comp, t]) => window.runLooks(m, comp, t), [manifest, c, mod.TV_TIMES])

const kept = {}
for (const handles of [true, false]) {
  const label = handles ? 'with material on both sides' : 'A has no material after its end'
  const comp = mod.dissolveProject(handles)
  const eng = engineFrames(comp, handles ? 'h' : 'n'), br = await player(comp)
  kept[handles] = eng
  const exp = mod.TV_TIMES.map(t => expected(t, handles))
  mod.TV_TIMES.forEach((t, i) => {
    const e = diff(eng[i], exp[i]), b = diff(br[i], exp[i])
    console.log(`  [${label}] t=${t}: engine vs expected ${(e.within * 100).toFixed(0)} % (mean ${e.mean.toFixed(1)}), player vs expected ${(b.within * 100).toFixed(0)} % (mean ${b.mean.toFixed(1)})`)
    check(`${label}: t=${t} engine shows the expected picture`, e.within >= 0.9, e)
    check(`${label}: t=${t} editor shows the expected picture`, b.within >= 0.9, b)
  })
  // Both videos at once in the middle of the window: the frame is closer to the average than to either source alone.
  const mid = 3, a50 = diff(eng[mid], A(handles ? 4000 : 3960)).within, b50 = diff(eng[mid], B(2000)).within
  check(`${label}: at the middle of the transition the exported frame is neither A nor B alone (both visible)`, a50 < 0.6 && b50 < 0.6, { a50, b50 })
  check(`${label}: no black frames in the window (continuity)`, eng.slice(1, 6).every(g => g.reduce((s, p) => s + p[0] + p[1] + p[2], 0) / g.length / 3 > 40), eng.slice(1, 6).map(g => g.reduce((s, p) => s + p[0] + p[1] + p[2], 0) / g.length / 3))
}
// Control: the frames after the cut really come from A's file when it has material (they differ from the held frame).
{
  const d = diff(kept[true][4], kept[false][4]), d2 = diff(kept[true][5], kept[false][5])
  console.log(`  with material vs held frame after the cut: mean diff ${d.mean.toFixed(1)} (t=4250), ${d2.mean.toFixed(1)} (t=4490)`)
  check('A keeps playing after its end when its file has material (different from the held frame)', d.mean > 1 || d2.mean > 1, [d, d2])
}
// The editor and the engine also agree with each other frame by frame (the picture the person sees is the picture exported).
{
  const comp = mod.dissolveProject(true), eng = engineFrames(comp, 'x'), br = await player(comp)
  const worst = Math.min(...eng.map((g, i) => diff(g, br[i]).within))
  check('editor = engine at all seven moments (centred, with material)', worst >= 0.9, worst)
}
// The MP4 the browser's own fast exporter produces (what «Exportar» downloads) shows the same transition.
{
  const comp = mod.dissolveProject(true)
  const exp = mod.TV_TIMES.map(t => expected(t, true))
  const ex = await page.evaluate(([m, c, t]) => window.runExportGrid(m, c, t), [manifest, comp, mod.TV_TIMES])
  mod.TV_TIMES.forEach((t, i) => { const d = diff(ex[i], exp[i]); console.log(`  [browser export] t=${t}: ${(d.within * 100).toFixed(0)} % (mean ${d.mean.toFixed(1)})`); check(`browser export t=${t} shows the expected picture`, d.within >= 0.9, d) })
  const a50 = diff(ex[3], A(4000)).within, b50 = diff(ex[3], B(2000)).within
  check('browser export: at the middle of the transition both videos are visible', a50 < 0.6 && b50 < 0.6, { a50, b50 })
}
check('no page errors', errors.length === 0, errors)
await browser.close(); server.close()
console.log(failures.length ? `${failures.length} check(s) failed (files in ${work})` : 'Transition video checks passed.')
process.exit(failures.length ? 1 : 0)
