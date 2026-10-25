/**
 * Measures what opening, playing and exporting a long montage costs on the computer running the editor (memory, network, browser disk).
 * Real Chromium, the editor's own player and exporter, media served over HTTP with Range support (like the signed links).
 *   node scripts/measure-local.mjs [--minutes 90] [--out report.json]
 * Numbers describe THIS machine's headless Chromium (VP9 media: its build has no H.264 decoder); they are measurements, not promises for other browsers.
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { execFileSync, execSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const MIN = Number(arg('minutes', 90))
const ONLY = arg('only', '')   // 'photos' = only the many-photos memory test
const chrome = process.env.CHROMIUM_PATH || (() => { const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; const d = existsSync(base) && readdirSync(base).find(n => /^chromium-\d+/.test(n)); return d ? path.join(base, d, 'chrome-linux/chrome') : null })()
if (!chrome) { console.log('needs Chromium'); process.exit(0) }
const work = mkdtempSync(path.join(os.tmpdir(), 'cerebro-measure-')), media = path.join(work, 'media'), profile = path.join(work, 'profile')
mkdirSync(media)
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
const report = { machine: { cpus: os.cpus().length, ramGB: Math.round(os.totalmem() / 2 ** 30 * 10) / 10 }, minutes: MIN, media: {}, phases: [], export: [] }
const mb = n => Math.round(n / 1048576 * 10) / 10

// ---- Realistic test media: 1080p phone-like video (~8 Mbit/s of noisy content), a 12-megapixel photo, a 3-minute MP3.
const SCENE_SECONDS = 30
for (const n of ONLY === 'photos' ? [] : ['v1', 'v2', 'v3']) ff('-f', 'lavfi', '-i', `testsrc2=s=1920x1080:r=30,noise=alls=${n === 'v1' ? 18 : n === 'v2' ? 22 : 26}:allf=t`, '-t', String(SCENE_SECONDS), '-c:v', 'libvpx-vp9', '-b:v', '8M', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', path.join(media, `${n}.webm`))
ff('-f', 'lavfi', '-i', 'testsrc2=s=4000x3000,noise=alls=30:allf=t', '-frames:v', '1', '-q:v', '4', path.join(media, 'p1.jpg'))
if (ONLY !== 'photos') ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=180', '-c:a', 'libmp3lame', '-b:a', '192k', path.join(media, 'm.mp3'))
const files = ONLY === 'photos' ? { p1: 'p1.jpg' } : { v1: 'v1.webm', v2: 'v2.webm', v3: 'v3.webm', p1: 'p1.jpg', m: 'm.mp3' }
const kinds = { v1: 'video', v2: 'video', v3: 'video', p1: 'image', m: 'audio' }
const fileOf = id => files[id] ?? (id.startsWith('img') ? files.p1 : undefined)
for (const [id, f] of Object.entries(files)) report.media[id] = { file: f, MB: mb(statSync(path.join(media, f)).size) }

// ---- Montage (the deterministic loop builder) at the requested length.
const lib = await build({ stdin: { contents: "export { buildLoopMontage } from './lib/editor/loop-montage'", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' })
const { buildLoopMontage } = await import(`data:text/javascript;base64,${Buffer.from(lib.outputFiles[0].text).toString('base64')}`)
const montage = minutes => buildLoopMontage({ title: 'Medición', scenes: [{ assetId: 'v1', kind: 'video', durationMs: 30000 }, { assetId: 'p1', kind: 'image' }, { assetId: 'v2', kind: 'video', durationMs: 30000 }, { assetId: 'v3', kind: 'video', durationMs: 30000 }], music: { assetId: 'm', durationMs: 180000 }, targetMs: minutes * 60000, clipMs: 30000, resolution: '1080' })
const full = ONLY === 'photos' ? buildLoopMontage({ title: 'Fotos', scenes: Array.from({ length: 60 }, (_, i) => ({ assetId: `img${i}`, kind: 'image' })), music: null, targetMs: 60 * 3000, clipMs: 3000, resolution: '1080' }).composition : montage(MIN).composition
report.compositionJsonKB = Math.round(JSON.stringify(full).length / 102.4) / 10
report.clips = full.clips.length

// ---- Server with Range support and a byte counter.
let served = 0
const requests = {}
const harness = (await build({ entryPoints: [path.join(root, 'tests/browser/measure.harness.ts')], bundle: true, write: false, format: 'iife', logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0])
  if (u === '/h.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(harness) }
  const id = u.startsWith('/m/') ? u.slice(3) : null
  if (id && fileOf(id)) {
    const f = path.join(media, fileOf(id)), size = statSync(f).size
    const r = /bytes=(\d*)-(\d*)/.exec(q.headers.range ?? '')
    const start = r ? Number(r[1] || 0) : 0, end = r && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1
    s.writeHead(r ? 206 : 200, { 'content-type': fileOf(id).endsWith('webm') ? 'video/webm' : fileOf(id).endsWith('jpg') ? 'image/jpeg' : 'audio/mpeg', 'accept-ranges': 'bytes', 'content-length': end - start + 1, ...(r ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) })
    requests[id] = (requests[id] ?? 0) + 1
    const rs = createReadStream(f, { start, end }); rs.on('data', c => { served += c.length }); rs.on('error', () => s.end()); s.on('close', () => rs.destroy()); rs.pipe(s); return
  }
  s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><meta charset="utf-8"><body><script src="/h.js"></script>')
}).listen(8870)

// ---- Memory of the browser (all its processes) and disk of its profile.
function rssMB() {
  const rows = execSync('ps -eo pid=,ppid=,rss=,args=', { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean).map(l => { const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m && { pid: +m[1], ppid: +m[2], rss: +m[3], args: m[4] } }).filter(Boolean)
  const roots = rows.filter(r => r.args.includes(`--user-data-dir=${profile}`) && !r.args.includes('--type='))
  const kids = new Set(roots.map(r => r.pid)); let grew = true
  while (grew) { grew = false; for (const r of rows) if (!kids.has(r.pid) && kids.has(r.ppid)) { kids.add(r.pid); grew = true } }
  return Math.round(rows.filter(r => kids.has(r.pid)).reduce((n, r) => n + r.rss, 0) / 1024)
}
const du = d => { try { return Number(execSync(`du -sk "${d}"`, { encoding: 'utf8' }).split('\t')[0]) / 1024 } catch { return 0 } }
const diskParts = () => { const out = {}; for (const n of ['Cache', 'Code Cache', 'GPUCache', 'IndexedDB', 'Service Worker', 'blob_storage', 'File System']) { const p = path.join(profile, 'Default', n); if (existsSync(p)) out[n] = Math.round(du(p) * 10) / 10 } return { totalMB: Math.round(du(profile) * 10) / 10, parts: out } }

const ctx = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'], viewport: { width: 1280, height: 720 } })
const page = ctx.pages()[0] ?? await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto('http://127.0.0.1:8870/'); await page.waitForFunction(() => window.M)
const manifest = Object.fromEntries(Object.entries(files).map(([id]) => [id, { kind: kinds[id], url: `/m/${id}` }]))
if (ONLY === 'photos') for (let i = 0; i < 60; i++) manifest[`img${i}`] = { kind: 'image', url: `/m/img${i}` }
const mark = async (name, extra = {}) => { await new Promise(r => setTimeout(r, 500)); report.phases.push({ phase: name, rssMB: rssMB(), jsHeapMB: mb(await page.evaluate(() => window.M.heap())), downloadedMB: mb(served), ...extra }) }
await mark('page loaded (empty editor harness)')
if (ONLY === 'photos') {
  await page.evaluate(([m, c]) => window.M.open(m, c), [manifest, full]); await mark('opened a montage of 60 different 12-megapixel photos (5.4 MB each as JPEG)')
  for (const k of [5, 10, 20, 30, 40, 50, 59]) { await page.evaluate(t => window.M.seek(t), k * 3000 + 1500); await new Promise(r => setTimeout(r, 1500)); await mark(`showed photo ${k + 1} (one after another)`) }
  report.afterPlaying = { browserProfile: diskParts() }
  await ctx.close(); server.close(); console.log(JSON.stringify(report, null, 1)); writeFileSync(arg('out', path.join(work, 'report.json')), JSON.stringify(report, null, 1)); process.exit(0)
}
/* playback phases skipped: this script measures only the export's memory and disk */
// ---- Export to memory (Blob) vs progressive write to a file, same montage, 1080p 5 Mbit/s.
const sampleRun = async (fn) => { let peak = 0, stop = false; const sampler = (async () => { while (!stop) { peak = Math.max(peak, rssMB()); await new Promise(r => setTimeout(r, 200)) } })(); const r = await fn(); stop = true; await sampler; return { r, peak } }
for (const minutes of [1, 3, 6]) {
  const c = { ...montage(minutes).composition, exportSettings: { quality: 'normal', resolution: '1080', destination: 'download', mode: 'fast' } }
  const mem = await sampleRun(() => page.evaluate(([m, c]) => window.M.export(m, c), [manifest, c]))
  const fil = await sampleRun(() => page.evaluate(([m, c, n]) => window.M.exportToFile(m, c, n), [manifest, c, `out-${minutes}.mp4`]))
  report.export.push({ minutes, toMemory: { seconds: Math.round(mem.r.seconds), outputMB: mb(mem.r.bytes), rssPeakMB: mem.peak, jsHeapPeakMB: mb(mem.r.peakHeap) }, toFile: { seconds: Math.round(fil.r.seconds), outputMB: mb(fil.r.bytes), fileMB: mb(fil.r.fileSize), rssPeakMB: fil.peak, jsHeapPeakMB: mb(fil.r.peakHeap), blobNull: fil.r.blobNull, mime: fil.r.mime } })
  console.log(JSON.stringify(report.export.at(-1)))
}
const ab = await page.evaluate(([m, c]) => window.M.exportAbort(m, c, 'abort.mp4'), [manifest, { ...montage(6).composition, exportSettings: { quality: 'normal', resolution: '1080', destination: 'download', mode: 'fast' } }])
report.abort = ab
console.log('abort', JSON.stringify(ab))
report.afterExport = { browserProfile: diskParts() }
report.pageErrors = errors
await ctx.close(); server.close()
const outFile = arg('out', path.join(work, 'report.json'))
writeFileSync(outFile, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1)); console.log(`\nSaved: ${outFile}`)
