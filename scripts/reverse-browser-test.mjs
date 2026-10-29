/**
 * Real-browser check of «Invertir vídeo»: the editor's own player (preview) and WebCodecs exporter run in Chromium on synthetic videos whose
 * every frame is a flat colour that encodes its own number (R = N mod 8, G = (N div 8) mod 8, B = N div 64). Everything is checked by reading
 * the frame numbers back from the preview canvas and from the exported MP4, so «reversed» means «frame numbers really run backwards».
 *   node scripts/reverse-browser-test.mjs
 * Headless Chromium here decodes VP9 only (no H.264), so sources are VP9-in-MP4 and the exporter writes VP9 inside MP4 (`testMp4Vp9`).
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const chrome = process.env.CHROMIUM_PATH || (() => { const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; const d = existsSync(base) && readdirSync(base).find(n => /^chromium-\d+/.test(n)); return d ? path.join(base, d, 'chrome-linux64/chrome') : null })()
if (!chrome || !existsSync(chrome)) { console.log('needs Chromium'); process.exit(0) }
const work = mkdtempSync(path.join(os.tmpdir(), 'cerebro-revbrowser-'))
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
const FPS = 30
const ms = f => Math.round(f * 1000 / FPS)
const LV = { r: 30, g: 30, b: 40 }
/** A video of `frames` frames at `size`, each a flat colour that says which frame it is. */
const gen = (name, frames, size, crf, extra = []) => ff('-f', 'lavfi', '-i', `color=c=black:s=${size}:r=${FPS},format=rgb24`, '-vf', `geq=r='${LV.r}*mod(N,8)+20':g='${LV.g}*mod(floor(N/8),8)+20':b='${LV.b}*floor(N/64)+20',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-frames:v', String(frames), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-g', '15', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-video_track_timescale', '90000', ...extra, path.join(work, name))
const decode = ([r, g, b]) => Math.round((r - 20) / LV.r) + 8 * Math.round((g - 20) / LV.g) + 64 * Math.round((b - 20) / LV.b)
/** Frame numbers read back from a finished MP4 file. */
function numbers(file) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-fps_mode', 'passthrough', '-vf', 'scale=8:8:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 29 })
  const out = []
  for (let i = 0; i + 192 <= raw.length; i += 192) { const s = [0, 0, 0]; for (let k = 0; k < 64; k++) for (let c = 0; c < 3; c++) s[c] += raw[i + k * 3 + c]; out.push(decode(s.map(v => v / 64))) }
  return out
}
const seq = (from, to) => { const a = []; const d = from <= to ? 1 : -1; for (let v = from; v !== to + d; v += d) a.push(v); return a }
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const show = a => (a.length > 160 ? `${a.slice(0, 80).join(',')} … ${a.slice(-80).join(',')}` : a.join(','))

const N = 30   // 1 s = the editor's minimum clip length
gen('src.mp4', 120, '640x360', 12)
const mk = (id, extra = {}) => ({ id, sceneId: id, position: 1, narration: null, visualAssetId: 'v', voiceAssetId: null, durationMs: ms(N), motion: 'none', trimInMs: 0, transition: 'cut', sourceDurationMs: ms(120), ...extra })
const base = { storyboardId: 'sb', title: 't', fadeMs: 0, exportSettings: { quality: 'normal', resolution: '480' } }
const montage = (...clips) => ({ ...base, clips: clips.map((k, i) => ({ ...k, position: i + 1 })) })
const manifest = { v: { kind: 'video', url: '/m/src.mp4' } }

const harness = (await build({ entryPoints: [path.join(root, 'tests/browser/reverse.harness.ts')], bundle: true, write: false, format: 'iife', logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0])
  if (u === '/h.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(harness) }
  if (u === '/') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end('<!doctype html><meta charset=utf-8><body><script src="/h.js"></script>') }
  if (u.startsWith('/m/') && existsSync(path.join(work, u.slice(3)))) {
    const f = path.join(work, u.slice(3)), size = statSync(f).size
    const r = /bytes=(\d*)-(\d*)/.exec(q.headers.range ?? '')
    const start = r ? Number(r[1] || 0) : 0, end = r && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1
    s.writeHead(r ? 206 : 200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': end - start + 1, ...(r ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) })
    return createReadStream(f, { start, end }).pipe(s)
  }
  s.writeHead(404); s.end()
}).listen(0)
const port = server.address().port

const only = process.argv[2]
const on = k => !only || only === k
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++ }
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('PAGE ERROR', e.message))
await page.goto(`http://127.0.0.1:${port}/`)
await page.waitForFunction(() => !!window.M)
const M = (fn, ...a) => page.evaluate(([f, args]) => window.M[f](...args), [fn, a])
const exportTo = async (name, man, comp) => { const r = await M('exportFile', man, comp, FPS); writeFileSync(path.join(work, name), Buffer.from(r.b64, 'base64')); return { ...r, nums: numbers(path.join(work, name)) } }

// 1 ── export: clip A reversed, then clip B forward, same file
if (on('one')) {
  const r = await exportTo('one.mp4', manifest, montage(mk('a', { reverse: true }), mk('b')))
  console.log(`      (${r.bytes} bytes, ${r.seconds.toFixed(1)} s, ${r.encoded.videoCodec}/${r.encoded.container})`)
  check('export: reversed clip shows source frames 29 → 0, forward clip 0 → 29 (nothing skipped or repeated)', same(r.nums, [...seq(29, 0), ...seq(0, 29)]), show(r.nums))
}
// 2 ── export: a trimmed reversed clip reads exactly its own stretch backwards (other clips of the same file are unaffected)
if (on('trim')) {
  const r = await exportTo('trim.mp4', manifest, montage(mk('a', { trimInMs: ms(40), reverse: true }), mk('b', { trimInMs: ms(40) })))
  check('export: trimmed clip (source frames 40–69) reversed = 69 → 40 exactly (its forward twin, whose in-point falls between two frames, may start ±1)', same(r.nums.slice(0, 30), seq(69, 40)) && r.nums.slice(30).every((v, i) => Math.abs(v - (40 + i)) <= 1), show(r.nums))
}
// 2b ── freeze frame: forward 0…29, then source frame 15 held for 30 frames, then 15…44 (as «Congelar fotograma» builds it)
if (on('freeze')) {
  const r = await exportTo('freeze.mp4', manifest, montage(mk('a'), mk('f', { freeze: true, trimInMs: ms(15) + 5 }), mk('b', { trimInMs: ms(15) + 5 })))
  const held = r.nums.slice(30, 60)
  check('freeze frame: 0…29, then one frame (15) held for 30 frames, then 15… forward again', r.nums.length === 90 && same(r.nums.slice(0, 30), seq(0, 29)) && held.every(v => v === held[0]) && Math.abs(held[0] - 15) <= 1 && Math.abs(r.nums[60] - 15) <= 1 && r.nums[61] > r.nums[60], show(r.nums))
}
// 3 ── export: speed 2 reversed
if (on('speed')) {
  const r = await exportTo('speed.mp4', manifest, montage(mk('a', { reverse: true, speed: 2, durationMs: ms(N), trimInMs: 0 })))
  const want = Array.from({ length: N }, (_, j) => 2 * (N - 1 - j) + 1)   // every other source frame of [0,60), last first (frame centres)
  check('export: reversed at 2× plays every second source frame backwards', r.nums.length === N && r.nums.every((v, j) => Math.abs(v - want[j]) <= 1 && (j === 0 || v < r.nums[j - 1])), show(r.nums))
}
// 4 ── seamless bounce loop built like «Crear bucle ida y vuelta» (A, reversed copy 1 frame shorter each end, A again)
if (on('loop')) {
  gen('loop.mp4', 90, '640x360', 12)
  const man = { v: { kind: 'video', url: '/m/loop.mp4' } }
  const A = 60, back = { trimInMs: Math.round(1000 / FPS), durationMs: Math.round(ms(A) - 2000 / FPS) }   // what backCopyOf() computes
  const r = await exportTo('loopout.mp4', man, montage(mk('a', { durationMs: ms(A), sourceDurationMs: ms(90) }), mk('b', { reverse: true, ...back, sourceDurationMs: ms(90) }), mk('c', { durationMs: ms(A), sourceDurationMs: ms(90) })))
  check('bounce loop: A 0…59 → reversed copy 58…1 → A 0…59 (no frame twice at either join, no jump)', same(r.nums, [...seq(0, 59), ...seq(58, 1), ...seq(0, 59)]), show(r.nums))
}
// 5 ── dissolve between a normal and a reversed clip
if (on('dissolve')) {
  const r = await exportTo('tr.mp4', manifest, montage(mk('a', { transition: 'dissolve', transitionMs: 500, transitionOpts: { align: 'center' } }), mk('b', { reverse: true })))
  const around = r.nums.slice(N - 8, N + 8)
  check('dissolve into a reversed clip: right length, and every frame near the cut is a real frame (no black / empty frame)', r.nums.length === 2 * N && around.every(v => v >= 0 && v < 64 + 64), show(around))
}
// 6 ── the preview, paused: seek anywhere
if (on('seek')) {
  const times = [0, 100, 300, 500, 700, 990, 1000, 1100, 1500, 1900]   // reversed 0–1000 ms, forward 1000–2000 ms
  const pv = await M('previewAt', manifest, montage(mk('a', { reverse: true }), mk('b')), times)
  const got = pv.rgb.map(decode)
  const want = times.map(t => (t < 1000 ? 29 - Math.floor(t / (1000 / FPS)) : Math.floor((t - 1000) / (1000 / FPS))))
  check('preview (seek): each position shows the frame the export will contain', got.every((v, i) => Math.abs(v - want[i]) <= 1), `got ${got.join(',')} / want ${want.join(',')}`)
  check('preview (seek): no error', pv.errors.length === 0, pv.errors.join('; '))
}
// 7 ── the preview, playing
if (on('play')) {
  const pp = await M('previewPlay', manifest, montage(mk('a', { reverse: true }), mk('b')), 0, 1400)
  const rev = pp.samples.filter(s => s.t > 60 && s.t < 960 && !s.waiting).map(s => decode(s.rgb))
  let up = 0; for (let i = 1; i < rev.length; i++) if (rev[i] > rev[i - 1]) up++
  check('preview (playing): the frame number only falls during the reversed clip', rev.length > 8 && up === 0 && rev[0] > rev[rev.length - 1], `${rev.join(',')}`)
  check('preview (playing): no error', pp.errors.length === 0, pp.errors.join('; '))
}
// 8 ── a long reversed clip: windows keep memory flat (1080p source, 12 s = 360 frames, reversed end to end)
if (on('long')) {
  const LONG = 12, LF = LONG * FPS
  gen('long.mp4', LF, '1920x1080', 28, ['-deadline', 'realtime', '-cpu-used', '8'])
  const t0 = Date.now()
  const r = await exportTo('long-out.mp4', { v: { kind: 'video', url: '/m/long.mp4' } }, montage({ ...mk('a', { reverse: true, durationMs: LONG * 1000 }), sourceDurationMs: LONG * 1000 }))
  const ok = r.nums.length === LF && r.nums.every((v, j) => v === LF - 1 - j)
  check('long reversed clip (360 frames at 1080p): every frame is 359 → 0, in order', ok, ok ? '' : show(r.nums))
  check('long reversed clip: memory stays bounded (JS heap peak < 600 MB — a window of frames, not the clip)', r.peakHeap < 600, `heap peak ${r.peakHeap} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s total`)
}

await browser.close(); server.close()
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
