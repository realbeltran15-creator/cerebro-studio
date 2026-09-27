import { describe, expect, it } from 'vitest'
import { audioStartMs, emptyComposition, parseComposition, totalDurationMs, type Composition } from '@/lib/editor/composition'
import { addAudioClip, addClip, commit, deleteClip, duplicateClip, historyOf, layout, moveAudioClip, moveClip, redo, setDuration, splitClip, toManual, trimStart, undo } from '@/lib/editor/timeline'

function auto(): Composition {
  const c = emptyComposition('sb', 'Doc')
  c.clips = [
    { id: 'a', sceneId: 'a', position: 1, narration: 'uno', visualAssetId: 'img1', voiceAssetId: 'v1', durationMs: 4000, motion: 'kenburns' },
    { id: 'b', sceneId: 'b', position: 2, narration: 'dos', visualAssetId: 'vid1', voiceAssetId: 'v2', durationMs: 6000, motion: 'none' },
    { id: 'c', sceneId: 'c', position: 3, narration: 'tres', visualAssetId: 'img2', voiceAssetId: null, durationMs: 5000, motion: 'kenburns' },
  ]
  return c
}

describe('automatic → manual conversion', () => {
  it('moves clip voices to linked voice clips and keeps the same timing', () => {
    const m = toManual(auto(), { v1: 3500 })
    expect(m.editedManually).toBe(true)
    expect(m.clips.every(k => k.voiceAssetId === null)).toBe(true)
    expect(m.audioClips!.map(a => [a.assetId, a.linkedClipId, audioStartMs(m, a), a.durationMs])).toEqual([['v1', 'a', 0, 3500], ['v2', 'b', 4000, 6000]])
    expect(toManual(m)).toBe(m)
  })

  it('round-trips through the stored JSON', () => {
    const m = toManual(auto())
    const back = parseComposition(JSON.parse(JSON.stringify(m)))!
    expect(back.editedManually).toBe(true)
    expect(back.audioClips).toHaveLength(2)
    expect(back.clips.map(k => k.id)).toEqual(['a', 'b', 'c'])
  })

  it('gives old compositions (no ids) unique clip ids and defaults', () => {
    const old = { storyboardId: 'sb', clips: [{ sceneId: 'x', durationMs: 3000 }, { sceneId: 'x', durationMs: 3000 }] }
    const p = parseComposition(old)!
    expect(new Set(p.clips.map(k => k.id)).size).toBe(2)
    expect(p.clips[0]).toMatchObject({ trimInMs: 0, volume: 1, muted: false, zoom: 1, transition: 'fade', text: null })
  })
})

describe('timeline operations', () => {
  it('reorders clips and linked voices follow their clip', () => {
    const m = moveClip(toManual(auto()), 'b', 0)
    expect(m.clips.map(k => k.id)).toEqual(['b', 'a', 'c'])
    const v2 = m.audioClips!.find(a => a.assetId === 'v2')!
    expect(audioStartMs(m, v2)).toBe(0)
    expect(audioStartMs(m, m.audioClips!.find(a => a.assetId === 'v1')!)).toBe(6000)
  })

  it('changes duration within limits and trims the start of a video', () => {
    let m = setDuration(toManual(auto()), 'a', 50)
    expect(m.clips[0].durationMs).toBe(1000)
    m = trimStart(m, 'b', 1500)
    expect(m.clips[1]).toMatchObject({ trimInMs: 1500, durationMs: 4500 })
    m = trimStart(m, 'b', -5000)
    expect(m.clips[1]).toMatchObject({ trimInMs: 0, durationMs: 6000 })
  })

  it('splits a clip into two consecutive parts of the same source', () => {
    const m = splitClip(toManual(auto()), 'b', 2500)
    expect(m.clips.map(k => k.durationMs)).toEqual([4000, 2500, 3500, 5000])
    expect(m.clips[2]).toMatchObject({ visualAssetId: 'vid1', trimInMs: 2500 })
    expect(totalDurationMs(m)).toBe(15000)
    expect(splitClip(m, 'a', 500)).toBe(m) // too short
  })

  it('duplicates and deletes without losing linked audio', () => {
    let m = duplicateClip(toManual(auto()), 'a')
    expect(m.clips).toHaveLength(4)
    expect(m.clips[1].visualAssetId).toBe('img1')
    m = deleteClip(m, 'b')
    const v2 = m.audioClips!.find(a => a.assetId === 'v2')!
    expect(v2.linkedClipId).toBeNull()
    expect(v2.startMs).toBe(8000)
  })

  it('adds clips and audio tracks, moves audio to an absolute time', () => {
    let m = addClip(toManual(auto()), 'vid2', 3000)
    expect(m.clips.at(-1)).toMatchObject({ visualAssetId: 'vid2', durationMs: 3000, position: 4 })
    m = addAudioClip(m, { assetId: 'music1', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 18000, volume: 0.3, muted: false })
    const music = m.audioClips!.at(-1)!
    m = moveAudioClip(m, music.id, 2000)
    expect(layout(m).audio.at(-1)).toEqual({ id: music.id, startMs: 2000, endMs: 20000 })
  })

  it('undo/redo restores exact snapshots', () => {
    const start = toManual(auto())
    let h = historyOf(start)
    h = commit(h, moveClip(h.present, 'c', 0))
    h = commit(h, setDuration(h.present, 'a', 9000))
    expect(h.present.clips.map(k => k.id)).toEqual(['c', 'a', 'b'])
    h = undo(undo(h))
    expect(h.present).toBe(start)
    h = redo(h)
    expect(h.present.clips.map(k => k.id)).toEqual(['c', 'a', 'b'])
    h = commit(h, deleteClip(h.present, 'b'))
    expect(h.future).toEqual([])
  })
})
