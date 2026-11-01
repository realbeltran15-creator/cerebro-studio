/**
 * Repeats two timing-sensitive Chromium scenarios in isolation to tell product defects from harness races and environment load.
 * Usage: CHROMIUM_PATH=... node scripts/browser-repeat.mjs [iterations=15] [loadWorkers=0]
 * loadWorkers > 0 starts that many busy-loop processes to emulate a loaded machine (the full suite runs for ~15 min on a shared CPU).
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'fs'
import { spawn } from 'child_process'
import http from 'http'
import os from 'os'
import path from 'path'

const root = path.resolve(new URL('..', import.meta.url).pathname), dir = path.join(root, 'tests/browser')
const N = Number(process.argv[2] ?? 15), LOAD = Number(process.argv[3] ?? 0)
const chrome = process.env.CHROMIUM_PATH || (() => { const b = '/opt/pw-browsers'; const d = existsSync(b) && readdirSync(b).find(n => /^chromium-\d+/.test(n)); return d && path.join(b, d, 'chrome-linux/chrome') })()
const bundle = async entry => (await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': root } })).outputFiles[0].text
const serve = (port, scripts) => http.createServer((q, r) => { const n = q.url.split('?')[0].slice(1); if (scripts[n]) { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(scripts[n]) } r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><div id="root"></div>${Object.keys(scripts).map(s => `<script src="/${s}"></script>`).join('')}`) }).listen(port)
const worker = (await build({ entryPoints: [path.join(root, 'lib/editor/analysis.worker.ts')], bundle: true, write: false, format: 'iife', logLevel: 'error', alias: { '@': root } })).outputFiles[0].text
const sA = serve(8791, { 'r.js': await bundle(path.join(dir, 'renderer-video.harness.ts')) })
const sB = serve(8811, { 'worker.js': worker, 'h.js': await bundle(path.join(dir, 'analysis-worker.harness.ts')) })
const burners = Array.from({ length: LOAD }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }))
// Never leave CPU burners behind, even if the browser fails to launch or the script throws (a leaked burner skews every later measurement).
process.on('exit', () => burners.forEach(b => b.kill()))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1))
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
const stats = { renderer: { ok: 0, fail: 0, ms: [] }, analysis: { ok: 0, fail: 0, ms: [] } }, fails = []
for (let i = 1; i <= N; i++) {
  const load = os.loadavg()[0].toFixed(1), freeMB = Math.round(os.freemem() / 1048576)
  let page = await browser.newPage(); let t = Date.now()
  await page.goto('http://127.0.0.1:8791/'); const r = await page.evaluate(() => window.runTest()); await page.close()
  const okR = r.audio.voice220_clip1 > 0.1 && r.audio.voice220_clip3 < 0.01 && r.audio.video440_clip2 > 0.1 && r.audio.video440_clip1 < 0.01
  stats.renderer[okR ? 'ok' : 'fail']++; stats.renderer.ms.push(Date.now() - t); if (!okR) fails.push({ i, scenario: 'renderer', audio: r.audio, load, freeMB })
  page = await browser.newPage(); t = Date.now()
  await page.goto('http://127.0.0.1:8811/'); const a = await page.evaluate(() => window.runTest(600)); await page.close()
  const okA = a.progressSteps > 5 && a.cancelled === true && a.maxGap < 250
  stats.analysis[okA ? 'ok' : 'fail']++; stats.analysis.ms.push(Date.now() - t); if (!okA) fails.push({ i, scenario: 'analysis', a, load, freeMB })
}
burners.forEach(b => b.kill())
await browser.close(); sA.close(); sB.close()
const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
console.log("RESULT " + JSON.stringify({ iterations: N, loadWorkers: LOAD, cpus: os.cpus().length, renderer: { ok: stats.renderer.ok, fail: stats.renderer.fail, medianMs: med(stats.renderer.ms) }, analysis: { ok: stats.analysis.ok, fail: stats.analysis.fail, medianMs: med(stats.analysis.ms) }, failed: fails.map(f => `${f.scenario}#${f.i}(load ${f.load}, free ${f.freeMB} MB)`) }))
process.exit(0)
