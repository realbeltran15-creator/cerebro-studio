import { describe, expect, it } from 'vitest'
import { autoAssign, fillTemplate, makeTemplate, parseTemplate } from '@/lib/editor/montage-template'
import { parseComposition, totalDurationMs } from '@/lib/editor/composition'

const src = parseComposition({
  version: 1, storyboardId: 's', title: 'Original', format: '9:16', fadeMs: 400, subtitles: true, captionStyle: 'karaoke',
  clips: [
    { id: 'a', sceneId: 'a', position: 1, durationMs: 3000, visualAssetId: 'vidA', trimInMs: 2000, speed: 1.5, transition: 'wipe', camera: { kind: 'zoom_in', amount: 0.2 } },
    { id: 'b', sceneId: 'b', position: 2, durationMs: 2000, visualAssetId: 'imgB', transition: 'cut' },
    { id: 'c', sceneId: 'c', position: 3, durationMs: 4000, visualAssetId: 'vidA', trimInMs: 9000 },
  ],
  audioClips: [
    { id: 'm', assetId: 'mus', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 9000, volume: 0.35, muted: false },
    { id: 'x', assetId: 'whoosh', kind: 'sfx', linkedClipId: 'b', offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 800, volume: 0.9, muted: false },
  ],
  textClips: [{ id: 't', content: 'TÍTULO', startMs: 0, durationMs: 2500, position: 'center', sizePct: 10, font: 'condensed', color: '#ffcc00', animation: 'pop' }],
})!
const types: Record<string, string> = { vidA: 'video', imgB: 'image', mus: 'music', whoosh: 'sfx' }

describe('montage templates', () => {
  const t = makeTemplate(src, 'Mi Short', id => types[id] ?? 'other', 'tpl-1')
  it('keeps the whole structure and replaces each distinct file by a slot', () => {
    expect(t.slots.map(s => [s.label, s.uses])).toEqual([['Visual 1', 2], ['Visual 2', 1], ['Música 1', 1], ['Efecto 1', 1]])
    expect(t.slots[0].needsMs).toBe(13000)
    expect(JSON.stringify(t.composition)).not.toMatch(/vidA|imgB|mus"|whoosh/)
    expect(t.composition.clips[0]).toMatchObject({ trimInMs: 2000, speed: 1.5, transition: 'wipe', camera: { kind: 'zoom_in', amount: 0.2 } })
    expect(t.composition.textClips?.[0]).toMatchObject({ content: 'TÍTULO', font: 'condensed', color: '#ffcc00' })
    expect(parseTemplate(JSON.parse(JSON.stringify(t)))?.slots.length).toBe(4)
  })
  it('filling the slots gives the same montage with the new files', () => {
    const a = autoAssign(t, [{ id: 'v2', type: 'video' }, { id: 'i2', type: 'image' }, { id: 'm2', type: 'music' }, { id: 's2', type: 'sfx' }])
    const { composition: c, missing } = fillTemplate(t, a, { title: 'Nuevo' })
    expect(missing).toEqual([])
    expect(c.clips.map(k => k.visualAssetId)).toEqual(['v2', 'i2', 'v2'])
    expect(c.audioClips?.map(x => x.assetId)).toEqual(['m2', 's2'])
    expect(totalDurationMs(c)).toBe(totalDurationMs(src))
    expect([c.title, c.format, c.fadeMs, c.captionStyle]).toEqual(['Nuevo', '9:16', 400, 'karaoke'])
  })
  it('moves trims back when the new file is shorter, and reports empty slots', () => {
    const { composition: c, warnings, missing } = fillTemplate(t, { 'slot:visual-1': 'short' }, { durationOf: id => (id === 'short' ? 6000 : null) })
    expect(c.clips[2].trimInMs).toBe(2000) // 6000 - 4000
    expect(c.clips[1].visualAssetId).toBeNull()
    expect(missing.map(s => s.label)).toEqual(['Visual 2', 'Música 1', 'Efecto 1'])
    expect(warnings.join(' ')).toMatch(/Visual 1: el archivo dura 6 s/)
    expect(c.audioClips).toEqual([])
  })
})
