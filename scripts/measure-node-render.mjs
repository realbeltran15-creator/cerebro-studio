/**
 * Disk and memory cost of the offline (Node + FFmpeg) renderer: media file size, composition JSON, work-folder size while and after rendering,
 * and the final MP4, for N repetitions of one real 6 s video. The same video is referenced by every repetition (no copy).
 *   node scripts/measure-node-render.mjs 8 40
 */
import { build } from 'esbuild'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const work = mkdtempSync(path.join(os.tmpdir(), 'cerebro-nr-')), media = path.join(work, 'media'); mkdirSync(media)
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
ff('-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30,hue=h=t*60,noise=alls=12:allf=t', '-t', '6', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', path.join(media, 'rv.mp4'))
const proj = await build({ entryPoints: [path.join(root, 'tests/render/repeat-video-project.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' })
const mod = await import(`data:text/javascript;base64,${Buffer.from(proj.outputFiles[0].text).toString('base64')}`)
writeFileSync(path.join(work, 'assets.json'), JSON.stringify({ rv: { path: path.join(media, 'rv.mp4'), kind: 'video' } }))
const du = d => Number(execFileSync('du', ['-sk', d], { encoding: 'utf8' }).split('\t')[0]) / 1024
const rows = [{ media_MB: Math.round(statSync(path.join(media, 'rv.mp4')).size / 1048576 * 100) / 100 }]
for (const n of [300]) { const { composition } = mod.repeatProject(n, true); rows.push({ repetitions: n, compositionJsonKB: Math.round(JSON.stringify(composition).length / 1024 * 10) / 10, distinctAssets: new Set(composition.clips.map(k => k.visualAssetId)).size, note: 'no render: 300 repetitions only add JSON, the media file is shared' }) }
for (const n of process.argv.slice(2).map(Number)) {
  const { composition } = mod.repeatProject(n, true)
  const f = path.join(work, `p${n}.json`); writeFileSync(f, JSON.stringify(composition))
  const out = path.join(work, `out${n}.mp4`), wd = path.join(work, `w${n}`)
  let peakWork = 0, peakRss = 0
  const t0 = Date.now()
  const child = spawn(process.execPath, [path.join(root, 'scripts/render.mjs'), 'render', f, '--assets', path.join(work, 'assets.json'), '--out', out, '--work', wd], { stdio: 'ignore' })
  const timer = setInterval(() => { try { peakWork = Math.max(peakWork, du(wd)) } catch {} }, 300)
  await new Promise(r => child.on('close', r)); clearInterval(timer)
  let after = 0; try { after = du(wd) } catch {}
  const segs = (() => { try { return readdirSync(wd).length } catch { return 0 } })()
  rows.push({ repetitions: n, projectSeconds: n * 6 - (n - 1), renderSeconds: Math.round((Date.now() - t0) / 1000), outputMB: Math.round(statSync(out).size / 1048576 * 100) / 100, workFolderPeakMB: Math.round(peakWork * 10) / 10, workFolderAfterMB: Math.round(after * 10) / 10, workFiles: segs })
}
console.log(JSON.stringify(rows, null, 1))
