import { describe, expect, it } from 'vitest'
import { captionChunks, clipStarts, compositionIssues, emptyComposition, parseComposition, syncWithScenes, toShort, totalDurationMs, videoBitrateFor } from '@/lib/editor/composition'

const base = () => {
  const c = emptyComposition('sb', 'T')
  c.clips = [
    { id: 'a', sceneId: 'a', position: 1, narration: 'x', visualAssetId: 'img', voiceAssetId: null, durationMs: 4000, motion: 'none' },
    { id: 'gone', sceneId: 'gone', position: 2, narration: null, visualAssetId: 'v', voiceAssetId: null, durationMs: 3000, motion: 'kenburns' },
  ]
  return c
}

describe('composition', () => {
  it('keeps assignments of existing scenes, drops removed ones and follows storyboard order', () => {
    const synced = syncWithScenes(base(), [{ id: 'b', position: 2, duration_ms: 200, narration: 'new' }, { id: 'a', position: 1, duration_ms: 9000, narration: 'x2' }])
    expect(synced.clips.map(c => [c.sceneId, c.visualAssetId, c.durationMs, c.narration])).toEqual([['a', 'img', 4000, 'x2'], ['b', null, 1000, 'new']])
    expect(clipStarts(synced)).toEqual([0, 4000])
    expect(totalDurationMs(synced)).toBe(5000)
  })

  it('rejects malformed stored compositions and round-trips valid ones', () => {
    expect(parseComposition({ x: 1 })).toBeNull()
    expect(parseComposition(JSON.parse(JSON.stringify(base())))?.clips).toHaveLength(2)
  })

  it('spreads captions by word count', () => {
    expect(captionChunks('uno dos tres cuatro cinco seis siete', 7000, 3)).toEqual([
      { text: 'uno dos tres', startMs: 0, endMs: 3000 },
      { text: 'cuatro cinco seis', startMs: 3000, endMs: 6000 },
      { text: 'siete', startMs: 6000, endMs: 7000 },
    ])
  })

  it('lowers bitrate so long renders stay under the upload limit', () => {
    expect(videoBitrateFor(60_000)).toBe(2_500_000)
    const tenMin = videoBitrateFor(600_000)
    expect(((tenMin + 128_000) * 600) / 8).toBeLessThan(50 * 1024 * 1024)
  })

  it('flags scenes without visuals or voice', () => {
    const issues = compositionIssues(syncWithScenes(base(), [{ id: 'b', position: 1, duration_ms: 1000, narration: 'n' }]))
    expect(issues.map(i => i.message)).toEqual(['Escena 1: sin imagen ni vídeo (se renderizará en negro).', 'Escena 1: tiene narración pero no voz asignada.'])
  })

  it('builds a vertical short from selected clips', () => {
    const s = toShort(base(), 'job1', ['a'], ' Hook ')
    expect(s.format).toBe('9:16')
    expect(s.clips.map(c => c.sceneId)).toEqual(['a'])
    expect(s.hookText).toBe('Hook')
    expect(s.origin).toEqual({ kind: 'repurpose', sourceJobId: 'job1' })
  })
})

import { compositionCues, cuesToSrt, cuesToVtt } from '@/lib/editor/composition'
describe('subtitle export from a montage', () => {
  it('uses the renderer timing on the montage timeline (clip offsets added) and writes valid SRT/VTT', () => {
    const c = base()
    c.clips[1].narration = 'segunda escena con texto'
    const cues = compositionCues(c)
    expect(cues).toEqual([{ startMs: 0, endMs: 4000, text: 'x' }, { startMs: 4000, endMs: 7000, text: 'segunda escena con texto' }])
    expect(cuesToSrt(cues)).toBe('1\n00:00:00,000 --> 00:00:04,000\nx\n\n2\n00:00:04,000 --> 00:00:07,000\nsegunda escena con texto\n')
    expect(cuesToVtt(cues).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nx\n')).toBe(true)
    expect(cuesToSrt(compositionCues({ clips: [{ ...c.clips[0], narration: null }] }))).toBe('')
  })
})

import { applyTemplate, BUILT_IN_TEMPLATES, templateFrom } from '@/lib/editor/templates'
describe('montage templates', () => {
  it('applies global settings and per-clip transition/motion without touching content, trims or assets', () => {
    const c = base(); c.clips[0].trimInMs = 1200
    const short = BUILT_IN_TEMPLATES.find(t => t.id === 'short-rapido')!
    const out = applyTemplate(c, short)
    expect(out).toMatchObject({ format: '9:16', fadeMs: 0, hookMs: 3000, subtitles: true })
    expect(out.clips.map(x => [x.transition, x.motion, x.visualAssetId, x.narration, x.trimInMs])).toEqual([['cut', 'kenburns', 'img', 'x', 1200], ['cut', 'kenburns', 'v', null, undefined]])
    expect(c.format).toBe('16:9')   // the original is not mutated
  })
  it('captures the current settings as a reusable template', () => {
    const t = templateFrom(applyTemplate(base(), BUILT_IN_TEMPLATES[2]), '  Mi serie  ')
    expect(t).toMatchObject({ name: 'Mi serie', format: '9:16', transition: 'fade', motion: 'none', hookMs: 2500 })
  })
})
