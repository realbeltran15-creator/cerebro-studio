import { describe, expect, it } from 'vitest'
import { emptyComposition } from '@/lib/editor/composition'
import { compositionFingerprint, findDuplicateRenders } from '@/lib/qc/fingerprint'
import { checkAudio, checkBlackFrames, checkFormat, checkIncomplete, checkLicenses, checkSceneCoherence, checkSubtitles, verdictOf } from '@/lib/qc/validators'

const codes = (f: ReturnType<typeof checkFormat>) => f.map(x => `${x.severity}:${x.code}`)

describe('QC aislado', () => {
  it('formato: duración, resolución y tipo', () => {
    const spec = { expectedDurationMs: 20_000, width: 1280, height: 720 }
    expect(checkFormat({ durationMs: 20_100, width: 1280, height: 720, mimeType: 'video/mp4' }, spec)).toEqual([])
    expect(codes(checkFormat({ durationMs: 21_000, width: 1280, height: 720, mimeType: 'video/mp4' }, spec))).toEqual(['warn:duration_mismatch'])
    expect(codes(checkFormat({ durationMs: 40_000, width: 640, height: 360, mimeType: 'video/webm' }, spec))).toEqual(['fail:duration_mismatch', 'fail:resolution_mismatch', 'fail:format_not_allowed'])
    expect(codes(checkFormat({ durationMs: 0, width: 1280, height: 720, mimeType: 'video/mp4' }, spec))).toContain('fail:zero_duration')
  })

  it('audio: ausente, no decodificable, silencio', () => {
    expect(checkAudio({ hasStream: false, decodable: false }, { narrationExpected: true, audioExpected: true })[0]).toMatchObject({ severity: 'fail', code: 'audio_missing' })
    expect(checkAudio({ hasStream: false, decodable: false }, { narrationExpected: false, audioExpected: true })[0].severity).toBe('warn')
    expect(checkAudio({ hasStream: false, decodable: false }, { narrationExpected: false, audioExpected: false })).toEqual([])
    expect(checkAudio({ hasStream: true, decodable: false }, { narrationExpected: false, audioExpected: true })[0].code).toBe('audio_undecodable')
    expect(checkAudio({ hasStream: true, decodable: true, silentRatio: 1 }, { narrationExpected: true, audioExpected: true })[0].severity).toBe('fail')
    expect(checkAudio({ hasStream: true, decodable: true, silentRatio: 1 }, { narrationExpected: false, audioExpected: true })[0].severity).toBe('warn')
    expect(checkAudio({ hasStream: true, decodable: true, silentRatio: 0.1 }, { narrationExpected: true, audioExpected: true })).toEqual([])
  })

  it('negro: sin material = fallo; oscuro intencionado = nada; largo sin motivo = revisión humana, nunca fallo', () => {
    const scenes = [
      { sceneId: 's1', startMs: 0, endMs: 5000, hasVisual: true },
      { sceneId: 's2', startMs: 5000, endMs: 10000, hasVisual: false },
      { sceneId: 's3', startMs: 10000, endMs: 20000, hasVisual: true, intentionalDark: true },
    ]
    expect(checkBlackFrames([{ startMs: 5000, endMs: 10000 }], scenes, 20000).map(f => f.code)).toEqual(['black_missing_material'])
    expect(checkBlackFrames([{ startMs: 10000, endMs: 20000 }], scenes, 20000)).toEqual([])
    expect(checkBlackFrames([{ startMs: 0, endMs: 400 }, { startMs: 19600, endMs: 20000 }], scenes, 20000)).toEqual([])   // fundidos
    const long = checkBlackFrames([{ startMs: 1000, endMs: 4000 }], scenes, 20000)
    expect(long.map(f => f.severity)).toEqual(['review'])
    expect(verdictOf(long)).toBe('review')
    expect(checkBlackFrames([{ startMs: 1000, endMs: 2500 }], scenes, 20000).map(f => f.severity)).toEqual(['warn'])
  })

  it('materiales incompletos', () => {
    const f = checkIncomplete({ provenance: { incomplete: true }, clips: [{ id: 'a', visualAssetId: null }, { id: 'b', visualAssetId: 'x', narration: 'hola', voiceAssetId: null }] })
    expect(f.map(x => x.code).sort()).toEqual(['clips_without_visual', 'narration_without_voice', 'render_marked_incomplete'])
    expect(checkIncomplete({ provenance: { incomplete: false }, clips: [{ id: 'a', visualAssetId: 'x' }] })).toEqual([])
  })

  it('licencias y atribuciones', () => {
    const f = checkLicenses([
      { assetId: 'a', license: 'cc-by', attribution: '' }, { assetId: 'b', license: 'cc-by', attribution: 'Autor' },
      { assetId: 'c', license: 'cc-by-nc' }, { assetId: 'd', license: 'unknown' }, { assetId: 'e', license: 'own' },
    ], { commercial: true })
    expect(f.map(x => x.code)).toEqual(['attribution_missing', 'noncommercial_in_commercial', 'license_unknown'])
    expect(verdictOf(f)).toBe('fail')
    expect(checkLicenses([{ assetId: 'c', license: 'cc-by-nc' }], { commercial: false })).toEqual([])
  })

  it('subtítulos', () => {
    expect(checkSubtitles([], { expected: false, durationMs: 1000 })).toEqual([])
    expect(checkSubtitles([], { expected: true, durationMs: 1000 })[0].code).toBe('subtitles_missing')
    const f = checkSubtitles([{ startMs: 0, endMs: 600, text: 'a' }, { startMs: 500, endMs: 2000, text: 'b' }], { expected: true, durationMs: 1000 })
    expect(f.map(x => x.code).sort()).toEqual(['subtitle_overlap', 'subtitle_past_end'])
    expect(checkSubtitles([{ startMs: 0, endMs: 0, text: 'a' }], { expected: true, durationMs: 1000 })[0].code).toBe('subtitle_invalid')
  })

  it('coherencia escenas ↔ montaje', () => {
    const scenes = [{ id: 'a', position: 1, durationMs: 4000 }, { id: 'b', position: 2, durationMs: 4000 }]
    expect(checkSceneCoherence(scenes, [{ sceneId: 'a', position: 1, durationMs: 4000 }, { sceneId: 'b', position: 2, durationMs: 4000 }], 8000)).toEqual([])
    expect(checkSceneCoherence(scenes, [{ sceneId: 'a', position: 1, durationMs: 4000 }], 4000)[0].code).toBe('scene_without_clip')
    expect(checkSceneCoherence(scenes, [{ sceneId: 'b', position: 1, durationMs: 4000 }, { sceneId: 'a', position: 2, durationMs: 4000 }], 8000).map(f => f.code)).toEqual(['order_changed'])
    expect(checkSceneCoherence(scenes, [{ sceneId: 'a', position: 1, durationMs: 4000 }, { sceneId: 'b', position: 2, durationMs: 4000 }], 12000).map(f => f.code)).toEqual(['duration_vs_clips'])
  })

  it('huella: igual composición = misma huella; ignora ids y título; cambia con el contenido', () => {
    const mk = (title: string, id: string, asset: string, dur = 3000) => {
      const c = emptyComposition('sb', title)
      c.clips = [{ id, sceneId: id, position: 1, narration: 'x', visualAssetId: asset, voiceAssetId: null, durationMs: dur, motion: 'none' }]
      return c
    }
    const a = compositionFingerprint(mk('Uno', 'c1', 'img1'))
    expect(compositionFingerprint(mk('Otro título', 'c9', 'img1'))).toBe(a)
    expect(compositionFingerprint(mk('Uno', 'c1', 'img2'))).not.toBe(a)
    expect(compositionFingerprint(mk('Uno', 'c1', 'img1', 3500))).not.toBe(a)
    expect(findDuplicateRenders(a, [{ renderId: 'r1', fingerprint: a }, { renderId: 'r2', fingerprint: 'zzz' }]).map(m => m.renderId)).toEqual(['r1'])
  })
})
