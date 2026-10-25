/**
 * Measures the export-to-Google-Drive path in real Chromium against a SIMULATED Drive (a local server that implements the resumable-upload
 * protocol and keeps what it receives): the previous way (render to a temporary file of the browser, then upload) vs the new one
 * (fragmented MP4 sent while it is rendered). Reports browser storage peak, JS heap, process memory, bytes received in order, and validates
 * the received file with ffprobe/ffmpeg (duration, streams, decode errors).
 *   node scripts/measure-drive-stream.mjs [--minutes 3] [--out report.json]
 * What it cannot measure: the physical disk of the user's computer (a web page cannot read it) and the real Google Drive (needs the user's login).
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { execFileSync, execSync } from 'node:child_process'
import { appendFileSync, readFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const MIN = Number(arg('minutes', 3))
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
const drive = { files: {}, ranges: [], maxBlock: 0, sessions: 0 }
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0])
  if (u === '/upload/drive/v3/files' && q.method === 'POST') {
    const id = ++drive.sessions; drive.files[id] = { path: path.join(work, `drive-${id}.bin`), held: 0, total: null, name: null, unknown: !q.headers['x-upload-content-length'] }
    writeFileSync(drive.files[id].path, ''); const chunks = []
    q.on('data', c => chunks.push(c)); q.on('end', () => { drive.files[id].name = JSON.parse(Buffer.concat(chunks).toString()).name; s.writeHead(200, { Location: `http://127.0.0.1:8870/session/${id}` }); s.end('{}') }); return
  }
  if (u.startsWith('/session/')) {
    const f = drive.files[u.split('/')[2]]; const cr = q.headers['content-range'] ?? ''; const chunks = []
    q.on('data', c => chunks.push(c))
    q.on('end', () => {
      const body = Buffer.concat(chunks)
      if (q.method === 'DELETE') { f.cancelled = true; drive.cancelled = (drive.cancelled ?? 0) + 1; s.writeHead(499); return s.end() }
      if (cr.startsWith('bytes */')) { const t = cr.split('/')[1]; if (t !== '*' && Number(t) === f.held) { s.writeHead(200); return s.end(JSON.stringify({ id: 'D1', name: f.name, size: String(f.held) })) } s.writeHead(308, f.held ? { Range: `bytes=0-${f.held - 1}` } : {}); return s.end() }
      const m = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(cr)
      const [a, b] = [Number(m[1]), Number(m[2])]
      drive.ranges.push(cr); drive.maxBlock = Math.max(drive.maxBlock, body.length)
      if (a !== f.held || body.length !== b - a + 1 || (m[3] === '*' && body.length % 262144)) { s.writeHead(400); return s.end('bad range ' + cr + ' held=' + f.held) }
      appendFileSync(f.path, body); f.held = b + 1
      if (m[3] !== '*' && f.held >= Number(m[3])) { s.writeHead(200); return s.end(JSON.stringify({ id: 'D' + u.split('/')[2], name: f.name, size: String(f.held) })) }
      s.writeHead(308, { Range: `bytes=0-${b}` }); s.end()
    }); return
  }
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

const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate,format_name:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,bit_rate,duration,nb_frames', '-of', 'json', file], { encoding: 'utf8' }))
const decodeErrors = file => { try { return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').filter(Boolean).length } catch (e) { return String(e.stderr || e).split('\n').filter(Boolean).length } }
const SERIES = process.argv.includes('--series'), DIRECT_ONLY = process.argv.includes('--direct-only')
const series = []
const sampleRun = async (fn) => { let peak = 0, stop = false; const t0 = Date.now(); let nextS = 0; const sampler = (async () => { while (!stop) { const v = rssMB(); peak = Math.max(peak, v); if (SERIES && Date.now() - t0 >= nextS) { nextS += 30000; series.push({ t: Math.round((Date.now() - t0) / 1000), rssMB: v, heapMB: mb(await page.evaluate(() => window.M.heap())), driveReceivedMB: mb(Object.values(drive.files).at(-1)?.held ?? 0) }) } await new Promise(r => setTimeout(r, 200)) } })(); const r = await fn(); stop = true; await sampler; return { r, peak } }
// ---- --repro: a montage shaped like the user's real one (hundreds of copies of ONE 8 s video with a dissolve each, many songs one after
// another on the music track), exported to the simulated Drive. Add --fail to make the exporter fail in its first seconds (an unreadable
// video) and check that the REAL error reaches the caller instead of "no video was generated".
if (process.argv.includes('--repro')) {
  ff('-i', path.join(media, 'v1.webm'), '-t', '8', '-c', 'copy', path.join(media, 'v8.webm')); files.v8 = 'v8.webm'; kinds.v8 = 'video'; manifest.v8 = { kind: 'video', url: '/m/v8' }
  const SONG = 180000, songs = Math.ceil(MIN * 60000 / SONG), N = Math.ceil((MIN * 60000 - 7025 - 4115) / 4115) + 2
  for (let i = 0; i < songs; i++) manifest[`song${i}`] = { kind: 'audio', url: '/m/m' }
  const FAIL = process.argv.includes('--fail')
  // --corrupt: a video whose bytes are damaged a little after the start (opens fine, fails to decode in the first seconds).
  if (process.argv.includes('--corrupt')) { const b = readFileSync(path.join(media, 'v8.webm')); const at = Math.floor(b.length * 0.25); for (let i = 0; i < 60000; i++) b[at + i] = (i * 131) & 255; writeFileSync(path.join(media, 'v8.webm'), b) }
  const mk = i => ({ id: `clip-${i}`, sceneId: 'manual', position: i + 1, narration: null, visualAssetId: FAIL && i === 0 ? 'missing' : 'v8', voiceAssetId: null, durationMs: i === 0 ? 7025 : 4115, sourceDurationMs: 8000, motion: 'none', focusX: 0.5, focusY: 0.5, zoom: 1, trimInMs: i === 0 ? 0 : 500, volume: 1, muted: false, transition: i === N - 1 ? 'fade' : 'dissolve', transitionMs: i === N - 1 ? undefined : 1000, transitionOpts: { align: 'center', easing: 'linear' }, text: null, speed: 1, camera: null })
  const clips = Array.from({ length: N }, (_, i) => mk(i))
  const total = clips.reduce((n, k) => n + k.durationMs, 0)
  const audioClips = Array.from({ length: songs }, (_, i) => ({ id: `music-${i}`, kind: 'music', assetId: `song${i}`, startMs: i * SONG, offsetMs: 0, trimInMs: 0, durationMs: Math.min(SONG, total - i * SONG), volume: 0.5, muted: false, linkedClipId: null }))
  const res = arg('res', '1080')
  const raw = { version: 1, title: 'Repro', format: '16:9', storyboardId: 'manual-repro', clips, audioClips, tracks: [{ id: 'main', name: 'Vídeo principal', type: 'main', muted: true, solo: true }, { id: 'music', name: 'Música', type: 'music', solo: true }], editedManually: true, musicVolume: 0.4, duckMusic: true, subtitles: true, captionStyle: 'box', exportSettings: { quality: arg('quality', 'normal'), resolution: res, destination: 'download', mode: 'fast' } }
  if (FAIL) manifest.missing = { kind: 'video', url: '/m/does-not-exist' }
  const before = drive.sessions
  const t0 = Date.now()
  const out = await sampleRun(() => page.evaluate(([m, c]) => window.M.exportToDriveDirect(m, c).then(r => ({ ok: true, ...r })).catch(e => ({ ok: false, error: String(e?.message || e) })), [manifest, raw]))
  const f = drive.files[before + 1]
  const row = { minutes: MIN, clips: N, sessionsCancelled: drive.cancelled ?? 0, songs, resolution: res, wallSeconds: Math.round((Date.now() - t0) / 1000), result: out.r, driveSessions: drive.sessions - before, driveBytes: f?.held ?? 0, rssPeakMB: out.peak }
  if (out.r.ok && f) { row.probe = probe(f.path); row.decodeErrors = decodeErrors(f.path) }
  console.log(JSON.stringify(row, null, 1)); writeFileSync(arg('out', path.join(work, 'repro.json')), JSON.stringify(row, null, 1))
  await ctx.close(); server.close(); process.exit(0)
}
report.drive = []
for (const minutes of DIRECT_ONLY ? [MIN] : MIN > 0 ? [1, MIN] : [1]) {
  const c = { ...montage(minutes).composition, exportSettings: { quality: 'normal', resolution: '1080', destination: 'download', mode: 'fast' } }
  const before = drive.sessions
  const viaTemp = DIRECT_ONLY ? null : await sampleRun(() => page.evaluate(([m, c]) => window.M.exportToDriveViaTemp(m, c), [manifest, c]))
  const direct = await sampleRun(() => page.evaluate(([m, c]) => window.M.exportToDriveDirect(m, c), [manifest, c]))
  const fT = DIRECT_ONLY ? null : drive.files[before + 1], fD = drive.files[before + (DIRECT_ONLY ? 1 : 2)]
  const pT = fT ? probe(fT.path) : null, pD = probe(fD.path)
  const row = {
    minutes,
    viaTemp: !fT ? null : { seconds: Math.round(viaTemp.r.seconds), outputMB: mb(viaTemp.r.bytes), receivedByDriveMB: mb(fT.held), tempFileDiskPeakMB: mb(viaTemp.r.tempFilePeakBytes), browserStoragePeakMB: mb(viaTemp.r.peakStorageAboveBase), leftAfterMB: mb(viaTemp.r.opfsLeft), rssPeakMB: viaTemp.peak, jsHeapPeakMB: mb(viaTemp.r.peakHeap), durationS: Number(pT.format.duration), decodeErrors: decodeErrors(fT.path) },
    direct: { seconds: Math.round(direct.r.seconds), outputMB: mb(direct.r.bytes), receivedByDriveMB: mb(fD.held), tempFileDiskPeakMB: 0, browserStoragePeakMB: mb(direct.r.peakStorageAboveBase), leftAfterMB: mb(direct.r.opfsLeft), rssPeakMB: direct.peak, jsHeapPeakMB: mb(direct.r.peakHeap), peakBufferedMB: mb(direct.r.peakBuffered), blocks: direct.r.blocks, retries: direct.r.retries, durationS: Number(pD.format.duration), decodeErrors: decodeErrors(fD.path), streams: pD.streams.map(s => `${s.codec_type}:${s.codec_name}${s.width ? ` ${s.width}x${s.height}@${s.r_frame_rate}` : ` ${s.sample_rate}Hz x${s.channels}`}`), encoded: direct.r.encoded },
    montageSeconds: minutes * 60, sameBytesOrder: fD.held === direct.r.bytes,
  }
  report.drive.push(row); console.log(JSON.stringify(row))
}
report.driveMaxBlockBytes = drive.maxBlock
report.series = series
report.pageErrors = errors
await ctx.close(); server.close()
const outFile = arg('out', path.join(work, 'report.json'))
writeFileSync(outFile, JSON.stringify(report, null, 1))
console.log(`\nSaved: ${outFile}`)
