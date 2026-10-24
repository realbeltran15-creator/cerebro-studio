// @vitest-environment node
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderProject, type AssetFile, type RenderEvent } from '@/lib/render/engine'
import { buildLoopMontage } from '@/lib/editor/loop-montage'

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
const d = haveFfmpeg ? describe : describe.skip
const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])

d('offline render engine', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cerebro-engine-'))
  const f = (n: string) => path.join(dir, n)
  ff('-f', 'lavfi', '-i', 'color=c=0x2060c0:s=640x360:r=30', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('a.mp4'))
  ff('-f', 'lavfi', '-i', 'color=c=0xc06020:s=640x360:r=30', '-frames:v', '1', f('b.png'))
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=5', '-ac', '2', f('m.wav'))
  const assets: Record<string, AssetFile> = { a: { path: f('a.mp4'), kind: 'video' }, b: { path: f('b.png'), kind: 'image' }, m: { path: f('m.wav'), kind: 'audio' } }
  const build = (targetMs: number) => buildLoopMontage({ title: 't', scenes: [{ assetId: 'a', kind: 'video', durationMs: 6000 }, { assetId: 'b', kind: 'image' }], music: { assetId: 'm', durationMs: 5000 }, targetMs, clipMs: 4000, transitionMs: 500, resolution: '480' }).composition
  const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString())

  it('renders a montage with the exact length, frame count and sound, and reuses identical pieces', async () => {
    const c = build(24_000) // a, b, a, b, a, b: the repeats are the same drawing
    const ev: RenderEvent[] = []
    const r = await renderProject({ composition: c, assets, output: f('out1.mp4'), workDir: f('w1'), fps: 10, preset: 'ultrafast', onEvent: e => ev.push(e) })
    const p = probe(f('out1.mp4'))
    const v = p.streams.find((s: { codec_type: string }) => s.codec_type === 'video'), a = p.streams.find((s: { codec_type: string }) => s.codec_type === 'audio')
    expect(v.codec_name).toBe('h264'); expect(a.codec_name).toBe('aac')
    expect(Number(v.nb_frames)).toBe(240)
    expect(Math.abs(Number(p.format.duration) - 24)).toBeLessThan(0.15)
    const plan = ev.find(e => e.phase === 'plan') as Extract<RenderEvent, { phase: 'plan' }>
    expect(plan.segments).toBe(6)
    expect(plan.reused).toBeGreaterThan(0)            // the same scene with the same transition is drawn once
    expect(r.unique).toBe(plan.unique)
  }, 120_000)

  it('resumes: a second run with the same work folder renders no new piece', async () => {
    const c = build(24_000)
    const ev: RenderEvent[] = []
    await renderProject({ composition: c, assets, output: f('out2.mp4'), workDir: f('w1'), fps: 10, preset: 'ultrafast', onEvent: e => ev.push(e) })
    const plan = ev.find(e => e.phase === 'plan') as Extract<RenderEvent, { phase: 'plan' }>
    expect(plan.cached).toBe(plan.unique)
    expect(existsSync(f('out2.mp4'))).toBe(true)
  }, 120_000)

  it('can be cancelled without leaving a partial piece that would be reused', async () => {
    const c = build(12_000)
    const ac = new AbortController()
    const run = renderProject({ composition: c, assets, output: f('out3.mp4'), workDir: f('w3'), fps: 10, preset: 'ultrafast', signal: ac.signal, onEvent: e => { if (e.phase === 'video') ac.abort() } })
    await expect(run).rejects.toThrow()
    const left = execFileSync('ls', [path.join(f('w3'), 'segments')]).toString().split('\n').filter(Boolean)
    expect(left.every(x => x.endsWith('.ts'))).toBe(true)
    expect(existsSync(f('out3.mp4'))).toBe(false)
    // …and a later full run still produces a correct file.
    await renderProject({ composition: c, assets, output: f('out3.mp4'), workDir: f('w3'), fps: 10, preset: 'ultrafast' })
    expect(Number(probe(f('out3.mp4')).streams.find((s: { codec_type: string }) => s.codec_type === 'video').nb_frames)).toBe(120)
  }, 120_000)

  it('renders only a range when asked (a quick fidelity check of part of a long montage)', async () => {
    const c = build(24_000)
    await renderProject({ composition: c, assets, output: f('out4.mp4'), workDir: f('w4'), fps: 10, preset: 'ultrafast', rangeMs: { from: 8000, to: 12_000 } })
    const p = probe(f('out4.mp4'))
    expect(Math.abs(Number(p.format.duration) - 4)).toBeLessThan(0.15)
  }, 120_000)

  it('cleans up', () => { rmSync(dir, { recursive: true, force: true }) })
})
