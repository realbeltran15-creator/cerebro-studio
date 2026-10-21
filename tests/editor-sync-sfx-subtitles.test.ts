import { describe, expect, it } from 'vitest'
import { emptyComposition, parseComposition, totalDurationMs, type AudioClip, type Clip, type Composition } from '@/lib/editor/composition'
import { addClip, addAudioClip } from '@/lib/editor/timeline'
import { beatsOnTimeline, cutBeatAlignment, cutTimes, nearestBeat, syncCutsToBeats } from '@/lib/editor/sync'
import { cutSfxClips, defaultCutSfx, removeCutSfx, setCutSfx } from '@/lib/editor/cut-sfx'
import { applyCuesToComposition, captionList, deleteCue, editCue, exportSubtitles, materializeCues, parseSubtitles } from '@/lib/editor/subtitles'

const make = (durs: number[], over: Partial<Clip> = {}): Composition => {
  let c = emptyComposition('sb', 't')
  durs.forEach((d, i) => { c = addClip(c, `v${i}`, d, i); c = { ...c, clips: c.clips.map((k, j) => (j === i ? { ...k, id: `c${i}`, ...over } : k)) } })
  return c
}

describe('cuts on the beat', () => {
  it('nearestBeat respects the tolerance and picks the closest', () => {
    const beats = [500, 1000, 1500, 2000]
    expect(nearestBeat(1040, beats, 100)).toBe(1000); expect(nearestBeat(1260, beats, 100)).toBeNull(); expect(nearestBeat(1260, beats, 300)).toBe(1500); expect(nearestBeat(-10, [], 100)).toBeNull()
  })
  it('moves every cut that has a beat within reach, keeps the total length and never leaves a clip under the minimum', () => {
    const c = make([2050, 1900, 2100, 1950]) // cuts at 2050, 3950, 6050 ; total 8000
    const r = syncCutsToBeats(c, [2000, 4000, 6000], { toleranceMs: 100 })
    expect(cutTimes(r.composition)).toEqual([2000, 4000, 6000]); expect(totalDurationMs(r.composition)).toBe(8000)
    expect(r.moved).toEqual([{ index: 1, fromMs: 2050, toMs: 2000 }, { index: 2, fromMs: 3950, toMs: 4000 }, { index: 3, fromMs: 6050, toMs: 6000 }])
    expect(r.composition.clips.every(k => k.durationMs >= 1000)).toBe(true)
  })
  it('leaves cuts that are already on a beat, and cuts with no beat nearby, alone', () => {
    const c = make([2000, 2000, 2000])
    const r = syncCutsToBeats(c, [2000, 5000], { toleranceMs: 100 })
    expect(r.alreadyOn).toBe(1); expect(r.moved).toEqual([]); expect(r.composition).toBe(c)
  })
  it('skips a cut that would shrink a clip below 1 s, and says why', () => {
    const c = make([1100, 3000]) // cut at 1100; a beat at 1000 would leave 1000 + ... ok; a beat at 900 would leave 900 < 1000
    const r = syncCutsToBeats(c, [900], { toleranceMs: 300 })
    expect(r.moved).toEqual([]); expect(r.skipped[0].reason).toMatch(/mínimo/)
  })
  it('does not move a cut next to a linked voice', () => {
    let c = make([2050, 3000]); c = addAudioClip(c, { assetId: 'voz', kind: 'voice', linkedClipId: 'c0', offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 2000, volume: 1, muted: false })
    const r = syncCutsToBeats(c, [2000], { toleranceMs: 100 })
    expect(r.moved).toEqual([]); expect(r.skipped[0].reason).toMatch(/voz/)
  })
  it('a video clip that loses its head starts later in its source, so the footage stays where it was; with no footage before, the cut is skipped', () => {
    const c = make([2000, 3000]); c.clips[1].trimInMs = 5000
    const later = syncCutsToBeats(c, [2300], { toleranceMs: 400, isVideo: () => true })
    expect(later.composition.clips[1]).toMatchObject({ durationMs: 2700, trimInMs: 5300 }); expect(later.composition.clips[0].durationMs).toBe(2300)
    const c2 = make([2000, 3000]); c2.clips[1].trimInMs = 100
    expect(syncCutsToBeats(c2, [1700], { toleranceMs: 400, isVideo: () => true }).skipped[0].reason).toMatch(/material/)
  })
  it('timed captions follow the clip whose start moved', () => {
    const c = make([2000, 3000]); c.clips[1].cues = [{ startMs: 500, endMs: 1500, text: 'hola' }]
    const r = syncCutsToBeats(c, [2300], { toleranceMs: 400, isVideo: () => false })
    expect(r.composition.clips[1].cues).toEqual([{ startMs: 200, endMs: 1200, text: 'hola' }])
  })
  it('beats of a music clip are placed on the timeline using its start and trim', () => {
    const c = make([5000]); const m: AudioClip = { id: 'm', assetId: 'mu', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 1000, trimInMs: 2000, durationMs: 3000, volume: 1, muted: false }
    expect(beatsOnTimeline(c, m, [1500, 2000, 2500, 4999, 5000])).toEqual([1000, 1500, 3999])
  })
  it('measures how many cuts are on the beat', () => {
    const c = make([2000, 2000, 2000, 2000])
    expect(cutBeatAlignment(c, [2000, 4040, 6300], 100)).toMatchObject({ cuts: 3, onBeat: 2, share: 2 / 3 })
    expect(cutBeatAlignment(make([3000]), [100]).share).toBeNull()
  })
})

describe('sound effects on the cuts', () => {
  it('puts one linked effect on every cut, tagged, and replaces its own earlier ones without touching hand-placed effects', () => {
    let c = make([2000, 2000, 2000])
    c = addAudioClip(c, { assetId: 'manual', kind: 'sfx', linkedClipId: null, offsetMs: 0, startMs: 500, trimInMs: 0, durationMs: 500, volume: 1, muted: false })
    const a = setCutSfx(c, defaultCutSfx('whoosh'))
    expect(a.added).toBe(2); expect(cutSfxClips(a.composition).map(x => x.linkedClipId)).toEqual(['c1', 'c2'])
    const again = setCutSfx(a.composition, { ...defaultCutSfx('hit'), every: 2 })
    expect(cutSfxClips(again.composition).map(x => x.assetId)).toEqual(['hit']); expect((again.composition.audioClips ?? []).some(x => x.assetId === 'manual')).toBe(true)
    expect(cutSfxClips(removeCutSfx(again.composition))).toEqual([]); expect((removeCutSfx(again.composition).audioClips ?? []).length).toBe(1)
  })
  it('a lead-in effect starts before the cut, linked to the previous clip', () => {
    const r = setCutSfx(make([3000, 3000]), { ...defaultCutSfx('w'), preMs: 400 })
    expect(cutSfxClips(r.composition)[0]).toMatchObject({ linkedClipId: 'c0', offsetMs: 2600 })
  })
  it('survives saving: the tag and the snapshot are kept by parseComposition', () => {
    const r = setCutSfx(make([2000, 2000]), defaultCutSfx('w')); const back = parseComposition(JSON.parse(JSON.stringify(r.composition)))!
    expect(cutSfxClips(back)).toHaveLength(1)
  })
})

describe('subtitles: SRT and WebVTT', () => {
  const SRT = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\nHola <i>mundo</i>\r\n&amp; todos\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nSegunda línea\r\n'
  const VTT = 'WEBVTT\n\nNOTE comentario\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.000 --> 00:03.500 align:start position:0%\nHola <c.yellow>mundo</c>\n\n01:00:00.000 --> 01:00:02.000\nUna hora\n'
  it('reads SRT (BOM, CRLF, tags, entities, multi-line)', () => {
    const r = parseSubtitles(SRT); expect(r.format).toBe('srt'); expect(r.warnings).toEqual([])
    expect(r.cues).toEqual([{ startMs: 1000, endMs: 3500, text: 'Hola mundo & todos' }, { startMs: 4000, endMs: 6000, text: 'Segunda línea' }])
  })
  it('reads WebVTT (header, NOTE/STYLE blocks, ids, cue settings, short and hour timestamps)', () => {
    const r = parseSubtitles(VTT); expect(r.format).toBe('vtt')
    expect(r.cues).toEqual([{ startMs: 1000, endMs: 3500, text: 'Hola mundo' }, { startMs: 3_600_000, endMs: 3_602_000, text: 'Una hora' }])
  })
  it('reports what it drops instead of failing: bad times, empty text, end before start, overlaps', () => {
    const r = parseSubtitles('1\n00:00:05,000 --> 00:00:04,000\nal revés\n\n2\n00:0x:01,000 --> 00:00:02,000\nmala hora\n\n3\n00:00:01,000 --> 00:00:03,000\nA\n\n4\n00:00:02,000 --> 00:00:04,000\nB\n')
    expect(r.cues.map(q => q.text)).toEqual(['A', 'B']); expect(r.warnings.join(' ')).toMatch(/formato que no se entiende/); expect(r.warnings.join(' ')).toMatch(/final antes del inicio/); expect(r.warnings.join(' ')).toMatch(/se solapa/)
    expect(parseSubtitles('').cues).toEqual([]); expect(parseSubtitles('no es un subtítulo').cues).toEqual([])
  })
  it('puts the cues on the clips they overlap, splitting one that crosses a cut', () => {
    const c = make([3000, 3000]); c.clips[0].narration = 'viejo'; c.clips[1].narration = 'otro viejo'
    const r = applyCuesToComposition(c, [{ startMs: 500, endMs: 2000, text: 'uno' }, { startMs: 2500, endMs: 3500, text: 'cruza' }, { startMs: 9000, endMs: 9500, text: 'fuera' }])
    expect(r.assigned).toBe(2); expect(r.outside).toBe(1); expect(r.warnings.join(' ')).toMatch(/después del final/)
    expect(r.composition.clips[0].cues).toEqual([{ startMs: 500, endMs: 2000, text: 'uno' }, { startMs: 2500, endMs: 3000, text: 'cruza' }])
    expect(r.composition.clips[1].cues).toEqual([{ startMs: 0, endMs: 500, text: 'cruza' }])
    expect(captionList(r.composition).map(q => [q.startMs, q.endMs, q.text])).toEqual([[500, 2000, 'uno'], [2500, 3000, 'cruza'], [3000, 3500, 'cruza']])
  })
  it('the file replaces the old narration text unless asked not to; the shift moves everything', () => {
    const c = make([3000, 3000]); c.clips[1].narration = 'texto antiguo'
    const r = applyCuesToComposition(c, [{ startMs: 0, endMs: 1000, text: 'a' }], { shiftMs: 500 })
    expect(r.composition.clips[0].cues).toEqual([{ startMs: 500, endMs: 1500, text: 'a' }]); expect(r.composition.clips[1].narration).toBeNull()
    expect(applyCuesToComposition(c, [{ startMs: 0, endMs: 1000, text: 'a' }], { replace: false }).composition.clips[1].narration).toBe('texto antiguo')
  })
  it('edits and deletes one caption, including the ones generated from a narration', () => {
    const c = make([4000]); c.clips[0].narration = 'una frase corta de prueba'
    expect(materializeCues(c).clips[0].cues).toHaveLength(1)
    const e = editCue(c, { clipId: 'c0', index: 0 }, { text: 'editada', startMs: 200, endMs: 99999 })
    expect(e.clips[0].cues).toEqual([{ startMs: 200, endMs: 4000, text: 'editada' }])
    expect(editCue(e, { clipId: 'c0', index: 0 }, { endMs: 250 }).clips[0].cues).toEqual(e.clips[0].cues)
    expect(deleteCue(e, { clipId: 'c0', index: 0 }).clips[0].cues).toEqual([])
  })
  it('export round-trips: SRT and VTT written by the editor are read back identically', () => {
    const c = applyCuesToComposition(make([3000, 3000]), [{ startMs: 500, endMs: 2000, text: 'uno' }, { startMs: 3500, endMs: 5000, text: 'dos' }]).composition
    for (const f of ['srt', 'vtt'] as const) { const back = parseSubtitles(exportSubtitles(c, f)); expect(back.format).toBe(f); expect(back.cues.map(q => [q.startMs, q.endMs, q.text])).toEqual([[500, 2000, 'uno'], [3500, 5000, 'dos']]) }
  })
})
