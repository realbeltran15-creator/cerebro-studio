/**
 * Repeats the integral "preview vs real-time export" scenario (browser-tests §24) in isolation, optionally under CPU load,
 * recording at which instants the exported picture differs from the preview and how long each run takes.
 * Usage: CHROMIUM_PATH=... node scripts/browser-repeat-verify.mjs [iterations=10] [loadWorkers=0] [mode=realtime|fast]
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'fs'
import { spawn } from 'child_process'
import http from 'http'
import os from 'os'
import path from 'path'
const root = path.resolve(new URL('..', import.meta.url).pathname), dir = path.join(root, 'tests/browser')
const THROTTLE = Number(process.env.THROTTLE ?? 1)
const N = Number(process.argv[2] ?? 10), LOAD = Number(process.argv[3] ?? 0), MODE = process.argv[4] ?? 'realtime'
const chrome = process.env.CHROMIUM_PATH || (() => { const b = '/opt/pw-browsers'; const d = existsSync(b) && readdirSync(b).find(n => /^chromium-\d+/.test(n)); return d && path.join(b, d, 'chrome-linux/chrome') })()
const code = (await build({ entryPoints: [path.join(dir, 'verify-project.harness.ts')], bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': root } })).outputFiles[0].text
const server = http.createServer((q, r) => { if (q.url.startsWith('/v.js')) { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(code) } r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><div id="root"></div><script src="/v.js"></script>') }).listen(8817)
const burners = Array.from({ length: LOAD }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }))
// Never leave CPU burners behind, even if the browser fails to launch or the script throws (a leaked burner skews every later measurement).
process.on('exit', () => burners.forEach(b => b.kill()))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1))
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
const near = (a, b, tol = 60) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
const works = []; let ok = 0, silent = 0, flaggedButEqual = 0; const bad = [], ms = []
for (let i = 1; i <= N; i++) {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:8817/'); await page.waitForFunction(() => typeof window.runVerify === 'function')
  // SEQ=1 reproduces the order used inside the suite: playback check, then the fast export, then the real-time export on the SAME page.
  if (process.env.SEQ) { await page.evaluate(() => window.runPlayback()); await page.evaluate(() => window.runVerify('fast')) }
  const cdp = THROTTLE > 1 ? await page.context().newCDPSession(page) : null
  if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
  const t = Date.now(), r = await page.evaluate(w => window.runVerify(w), MODE); ms.push(Date.now() - t); await page.close()
  const diffs = r.exported.map((c, k) => near(c, r.preview[k]) ? null : k).filter(k => k !== null)
  if (diffs.length) { bad.push(`#${i}: instants ${diffs.join(',')} flagged=${r.quality?.degraded === true} lateFrames=${r.quality?.lateFrames} maxGap=${r.quality?.maxGapMs} maxWork=${r.quality?.maxWorkMs} slow=${r.quality?.slowFrames}`); if (!r.quality?.degraded && MODE === 'realtime') silent++ } else { ok++; if (r.quality?.degraded) flaggedButEqual++; works.push(`${r.quality?.maxWorkMs}/${r.quality?.slowFrames}`) }
}
burners.forEach(b => b.kill()); await browser.close(); server.close()
console.log('RESULT ' + JSON.stringify({ mode: MODE, iterations: N, loadWorkers: LOAD, cpuThrottle: THROTTLE, cpus: os.cpus().length, ok, fail: N - ok, silentMismatches: silent, okRunsMaxWorkSlow: works, flaggedButEqual, medianMs: [...ms].sort((a, b) => a - b)[Math.floor(N / 2)], bad }))
process.exit(0)
