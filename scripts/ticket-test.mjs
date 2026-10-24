/**
 * Render package end to end: a ticket (montage + links) served over HTTP, downloaded and rendered by the CLI, then probed.
 *   node scripts/ticket-test.mjs
 */
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync, createReadStream } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(new URL('..', import.meta.url).pathname)
if (spawnSync('ffmpeg', ['-version']).status !== 0) { console.log('Ticket test skipped: needs ffmpeg.'); process.exit(0) }
const work = mkdtempSync(path.join(os.tmpdir(), 'cerebro-ticket-')), media = path.join(work, 'media')
execFileSync('mkdir', ['-p', media])
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(media, 'v.mp4'))
ff('-f', 'lavfi', '-i', 'color=c=#3060c0:s=640x360', '-frames:v', '1', path.join(media, 'i.png'))
ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=5', path.join(media, 'm.wav'))
// The server lives in this process, so the CLI must run asynchronously (a blocking spawn would freeze the server).
const run = (...args) => new Promise(res => execFile(process.execPath, [path.join(root, 'scripts/render.mjs'), ...args], { encoding: 'utf8', maxBuffer: 1 << 26 }, (e, stdout, stderr) => res({ status: e ? (e.code ?? 1) : 0, stdout, stderr })))
const failures = []
const check = (n, ok, d) => { console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : ` — ${JSON.stringify(d)}`}`); if (!ok) failures.push(n) }

const lib = await build({ stdin: { contents: "export { buildLoopMontage } from './lib/editor/loop-montage'", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' })
const { buildLoopMontage } = await import(`data:text/javascript;base64,${Buffer.from(lib.outputFiles[0].text).toString('base64')}`)
const built = buildLoopMontage({ title: 'Paquete', scenes: [{ assetId: 'v', kind: 'video', durationMs: 8000 }, { assetId: 'i', kind: 'image' }], music: { assetId: 'm', durationMs: 5000 }, targetMs: 20000, clipMs: 8000, resolution: '720' })

const files = { v: 'v.mp4', i: 'i.png', m: 'm.wav' }
const hits = []
const server = http.createServer((q, s) => {
  const f = path.join(media, files[q.url.slice(1)] ?? 'x'), size = statSync(f).size
  const r = /bytes=(\d+)-/.exec(q.headers.range ?? '')
  hits.push(r ? 'range' : 'full')
  s.writeHead(r ? 206 : 200, { 'content-length': size - (r ? Number(r[1]) : 0) })
  createReadStream(f, { start: r ? Number(r[1]) : 0 }).pipe(s)
}).listen(0)
await new Promise(r => server.once('listening', r))
const base = `http://127.0.0.1:${server.address().port}`
const ticket = { version: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString(), jobId: 'j', projectId: null, title: 'Paquete', composition: built.composition, assets: { v: { url: `${base}/v`, kind: 'video' }, i: { url: `${base}/i`, kind: 'image' }, m: { url: `${base}/m`, kind: 'audio' } } }
writeFileSync(path.join(work, 'paquete-render.json'), JSON.stringify(ticket))
const out = path.join(work, 'video.mp4')
const r = await run('ticket', path.join(work, 'paquete-render.json'), '--out', out, '--work', path.join(work, 'w'), '--fps', '24')
check('the CLI downloaded the three materials and rendered', r.status === 0 && hits.length === 3, { status: r.status, hits, err: r.stderr.slice(-400) })
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', out]).toString())
const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio')
check('the video is 1280×720 H.264 with AAC audio and 20 s long', v?.width === 1280 && v.height === 720 && v.codec_name === 'h264' && a?.codec_name === 'aac' && Math.abs(Number(probe.format.duration) - 20) < 0.1, { v: v && [v.width, v.height], d: probe.format.duration })
const again = await run('ticket', path.join(work, 'paquete-render.json'), '--out', path.join(work, 'again.mp4'), '--work', path.join(work, 'w'), '--fps', '24')
check('running it again with the same folder downloads nothing and reuses every segment', again.status === 0 && hits.length === 3 && /0 ya hechos|\d+ ya hechos/.test(again.stderr) && !/\(\d+ distintos, \d+ repetidos, 0 ya hechos\)/.test(again.stderr), again.stderr.split('\n').find(l => l.startsWith('Plan')))
const expired = JSON.parse(readFileSync(path.join(work, 'paquete-render.json'), 'utf8')); expired.expiresAt = '2020-01-01T00:00:00Z'; writeFileSync(path.join(work, 'old.json'), JSON.stringify(expired))
const bad = await run('ticket', path.join(work, 'old.json'), '--out', path.join(work, 'x.mp4'))
check('an expired package is refused with a clear message', bad.status !== 0 && /caducado/.test(bad.stderr), bad.stderr.slice(-200))
server.close()
console.log(failures.length ? `${failures.length} check(s) failed (files in ${work})` : 'Ticket checks passed.')
process.exit(failures.length ? 1 : 0)
