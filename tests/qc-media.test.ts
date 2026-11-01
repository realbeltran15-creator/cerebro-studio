import { mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMediaQc, inspectMedia, sha256File } from '@/lib/qc/media'
import { corruptMiddle, makeTestVideo, truncateFile } from '@/lib/qc/testmedia'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
const spec = { expectedDurationMs: 4000, width: 320, height: 180 }
const codes = (r: { findings: Array<{ severity: string; code: string }> }) => r.findings.map(f => `${f.severity}:${f.code}`).sort()

describe.skipIf(!hasFfmpeg)('QC multimedia real (ffprobe/ffmpeg)', () => {
  let dir = ''
  const f = (n: string) => path.join(dir, n)
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'qcmedia-'))
    await makeTestVideo(f('ok.mp4'))
    await makeTestVideo(f('noaudio.mp4'), { audio: 'none' })
    await makeTestVideo(f('silent.mp4'), { audio: 'silent' })
    await makeTestVideo(f('black.mp4'), { durationSec: 10, black: { from: 2, to: 6 } })
    await makeTestVideo(f('corrupt.mp4')); await corruptMiddle(f('corrupt.mp4'), 600)
    await makeTestVideo(f('trunc.mp4')); await truncateFile(f('trunc.mp4'), 0.3)
  }, 60_000)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('un MP4 correcto pasa y se miden códec, duración, resolución, FPS y audio', async () => {
    const r = await runMediaQc({ file: f('ok.mp4'), spec, narrationExpected: false, audioExpected: true })
    expect(r.verdict).toBe('pass')
    expect(r.findings).toEqual([])
    expect(r.info?.meta).toMatchObject({ width: 320, height: 180, mimeType: 'video/mp4', videoCodec: 'h264' })
    expect(r.info?.meta.durationMs).toBeGreaterThan(3800)
    expect(r.info?.meta.durationMs).toBeLessThan(4300)
    expect(r.info?.fps).toBeCloseTo(24, 0)
    expect(r.info?.audio).toMatchObject({ hasStream: true, decodable: true })
    expect(r.info?.audioCodec).toBe('aac')
  })

  it('archivo inexistente, vacío o truncado: FAIL', async () => {
    expect(codes(await runMediaQc({ file: f('nope.mp4'), spec }))).toEqual(['fail:file_missing'])
    expect((await runMediaQc({ file: f('trunc.mp4'), spec })).verdict).toBe('fail')
  })

  it('contenedor legible pero con datos corruptos: FAIL container_corrupt', async () => {
    const r = await runMediaQc({ file: f('corrupt.mp4'), spec })
    expect(r.verdict).toBe('fail')
    expect(codes(r)).toContain('fail:container_corrupt')
  })

  it('daño que el decodificador disimula (hay bytes alterados que NO dan error al decodificar): la huella registrada lo detecta', async () => {
    // seed 3 + 600 bytes: ffmpeg decodifica sin quejarse (límite conocido de comprobar solo la decodificación)
    await makeTestVideo(f('conceal.mp4'), { seed: 3 })
    const clean = await sha256File(f('conceal.mp4'))
    await corruptMiddle(f('conceal.mp4'), 600)
    const byDecode = await runMediaQc({ file: f('conceal.mp4'), spec })
    expect(byDecode.verdict, 'si algún día ffmpeg lo detecta solo, mejor: este test lo reflejará').toBe('pass')
    const byHash = await runMediaQc({ file: f('conceal.mp4'), spec, expectedSha256: clean })
    expect(byHash.verdict).toBe('fail'); expect(codes(byHash)).toEqual(['fail:integrity_hash_mismatch'])
    expect((await runMediaQc({ file: f('ok.mp4'), spec, expectedSha256: await sha256File(f('ok.mp4')) })).verdict).toBe('pass')
  })

  it('sin audio: FAIL si hay narración prevista, WARN si solo se esperaba audio, nada si no se espera', async () => {
    expect(codes(await runMediaQc({ file: f('noaudio.mp4'), spec, narrationExpected: true, audioExpected: true }))).toEqual(['fail:audio_missing'])
    expect(codes(await runMediaQc({ file: f('noaudio.mp4'), spec, audioExpected: true }))).toEqual(['warn:audio_missing'])
    expect((await runMediaQc({ file: f('noaudio.mp4'), spec })).verdict).toBe('pass')
  })

  it('audio en silencio: FAIL con narración prevista, WARN sin ella', async () => {
    expect(codes(await runMediaQc({ file: f('silent.mp4'), spec, narrationExpected: true, audioExpected: true }))).toEqual(['fail:audio_silent'])
    expect(codes(await runMediaQc({ file: f('silent.mp4'), spec, audioExpected: true }))).toEqual(['warn:audio_silent'])
  })

  it('duración o resolución incorrectas: FAIL', async () => {
    const r = await runMediaQc({ file: f('ok.mp4'), spec: { expectedDurationMs: 9000, width: 1280, height: 720 } })
    expect(codes(r)).toEqual(['fail:duration_mismatch', 'fail:resolution_mismatch'])
  })

  it('negro: sin explicación = revisión humana (nunca fallo); escena oscura intencionada = correcto; falta de material = FAIL', async () => {
    const base = { file: f('black.mp4'), spec: { expectedDurationMs: 10000, width: 320, height: 180 } }
    const sc = (over: object) => [{ sceneId: 's1', startMs: 0, endMs: 2000, hasVisual: true }, { sceneId: 's2', startMs: 2000, endMs: 6000, hasVisual: true, ...over }, { sceneId: 's3', startMs: 6000, endMs: 10000, hasVisual: true }]
    const unexplained = await runMediaQc({ ...base, scenes: sc({}) })
    expect(unexplained.verdict).toBe('review'); expect(codes(unexplained)).toEqual(['review:black_unexplained'])
    expect((await runMediaQc({ ...base, scenes: sc({ intentionalDark: true }) })).verdict).toBe('pass')
    const missing = await runMediaQc({ ...base, scenes: sc({ hasVisual: false }) })
    expect(missing.verdict).toBe('fail'); expect(codes(missing)).toContain('fail:black_missing_material')
  })

  it('render incompleto y clips sin material: FAIL; composición repetida: WARN', async () => {
    const r = await runMediaQc({ file: f('ok.mp4'), spec, provenance: { incomplete: true }, clips: [{ id: 'c', visualAssetId: null }], fingerprint: 'fp1', previousRenders: [{ renderId: 'r-old', fingerprint: 'fp1' }] })
    expect(codes(r)).toEqual(['fail:clips_without_visual', 'fail:render_marked_incomplete', 'warn:possible_duplicate'])
    expect(r.verdict).toBe('fail')
    expect((await runMediaQc({ file: f('ok.mp4'), spec, fingerprint: 'fp1', previousRenders: [{ renderId: 'r-old', fingerprint: 'fp1' }] })).verdict).toBe('warn')
  })

  it('un nombre de archivo malicioso no ejecuta nada (sin shell)', async () => {
    const evil = f('x; touch pwned.mp4')
    expect((await inspectMedia(evil)).ok).toBe(false)
    expect((await runMediaQc({ file: evil, spec })).verdict).toBe('fail')
  })
})
