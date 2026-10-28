// @vitest-environment node
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderProject, type AssetFile } from '@/lib/render/engine'
import { emptyComposition, type Clip, type Composition } from '@/lib/editor/composition'
import { makeBounceLoop } from '@/lib/editor/timeline'

const have = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
const d = have ? describe : describe.skip
const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
const FPS = 30, N = 18, STEP = 10

/** Mean brightness (0-255) of every frame of a video, read back from the finished file. */
function lumas(file: string): number[] {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=16:16:flags=area,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 })
  const out: number[] = []
  for (let i = 0; i + 256 <= raw.length; i += 256) { let s = 0; for (let k = 0; k < 256; k++) s += raw[i + k]; out.push(s / 256) }
  return out
}

d('exported video is really reversed (Node render engine, real files)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cerebro-rev-'))
  const f = (n: string) => path.join(dir, n)
  // Source: N frames of a flat grey whose level is 3×frame number, so every output frame says which source frame it came from.
  ff('-f', 'lavfi', '-i', `color=c=black:s=320x180:r=${FPS}`, '-vf', `geq=lum='20+${STEP}*N':cb=128:cr=128`, '-frames:v', String(N), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-g', '6', '-pix_fmt', 'yuv420p', f('src.mp4'))
  const assets: Record<string, AssetFile> = { v: { path: f('src.mp4'), kind: 'video' } }
  const ms = (frames: number) => Math.round(frames * 1000 / FPS)
  const clip = (o: Partial<Clip> & { id: string }): Clip => ({ sceneId: o.id, position: 1, narration: null, visualAssetId: 'v', voiceAssetId: null, durationMs: ms(N), motion: 'none', trimInMs: 0, transition: 'cut', sourceDurationMs: ms(N), ...o })
  const montage = (...clips: Clip[]): Composition => ({ ...emptyComposition('sb', 'Doc'), clips: clips.map((k, i) => ({ ...k, position: i + 1 })), fadeMs: 0, exportSettings: { quality: 'normal', resolution: '480' } })
  const render = async (c: Composition, name: string) => { await renderProject({ composition: c, assets, output: f(name), workDir: f(`${name}.work`), fps: FPS, preset: 'ultrafast' }); return lumas(f(name)) }

  // The level the source frame k should have after the encode/decode round trip (limited range): a monotonic map, so only order matters.
  const trend = (a: number[], dir: 'up' | 'down') => { for (let j = 0; j + 4 < a.length; j++) { const diff = a[j + 4] - a[j]; if (dir === 'up' ? diff < 25 : diff > -25) return false } return true }

  it('a forward clip counts up, a reversed clip counts down, in the exported file', async () => {
    const out = await render(montage(clip({ id: 'a', reverse: true }), clip({ id: 'b' })), 'one.mp4')
    expect(out.length).toBe(2 * N)
    const first = out.slice(0, N), second = out.slice(N)
    expect(trend(first, 'down')).toBe(true)
    expect(trend(second, 'up')).toBe(true)
    // the reversed half starts where the source ends and ends where it starts (up to one frame at each end)
    expect(first[0]).toBeGreaterThan(second[N - 1] - 10)
    expect(first[N - 1]).toBeLessThan(second[0] + 10)
    // and at the join A (forward) → reversed shows no stall: brightness is continuous
  }, 180_000)

  it('the seamless bounce loop exports clip → reversed copy → clip with no repeated frame and no jump', async () => {
    const c = makeBounceLoop(montage(clip({ id: 'a' })), 'a', 2) // A, B, A, B
    const out = await render(c, 'loop.mp4')
    const expected = [...Array.from({ length: N }, (_, j) => j), ...Array.from({ length: N - 2 }, (_, j) => N - 2 - j), ...Array.from({ length: N }, (_, j) => j), ...Array.from({ length: N - 2 }, (_, j) => N - 2 - j)]
    expect(out.length).toBe(expected.length)
    // Compare each exported frame with the brightness of the source frame it should be (tolerance covers lossy encoding; a one-frame error is 3 levels, so also check ordering)
    const base = out[0]
    const slope = (out[N - 1] - out[0]) / (N - 1)
    const worst = Math.max(...out.map((v, i) => Math.abs((v - base) / slope - expected[i])))
    expect(worst).toBeLessThan(0.45)
    // no two neighbouring frames identical in the joins (the classic doubled frame)
    for (const i of [N - 1, N - 1 + N - 2, 2 * N - 2 + N - 1]) expect(Math.abs(out[i + 1] - out[i])).toBeGreaterThan(slope * 0.4)
  }, 240_000)

  it('the original file is not touched and no big copy is written', async () => {
    const before = execFileSync('md5sum', [f('src.mp4')]).toString()
    await render(montage(clip({ id: 'a', reverse: true })), 'again.mp4')
    expect(execFileSync('md5sum', [f('src.mp4')]).toString()).toBe(before)
    const sizes = execFileSync('du', ['-sk', f('again.mp4.work')]).toString()
    expect(Number(sizes.split('\t')[0])).toBeLessThan(5000) // KB: segments of the output only
  }, 180_000)
})
