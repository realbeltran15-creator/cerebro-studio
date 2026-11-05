import { describe, expect, it } from 'vitest'
import { emptyComposition, parseComposition, type Composition } from '@/lib/editor/composition'
import { addClip, splitClip } from '@/lib/editor/timeline'
import { applyCuesToComposition, captionList, editCue, markCueReviewed, originSummary } from '@/lib/editor/subtitles'

const make = (): Composition => {
  let c = emptyComposition('o', 't')
  ;[4000, 4000].forEach((d, i) => { c = addClip(c, `v${i}`, d, i); c = { ...c, clips: c.clips.map((k, j) => (j === i ? { ...k, id: `c${i}` } : k)) } })
  return c
}
const cues = [{ startMs: 500, endMs: 2000, text: 'Hola' }, { startMs: 5000, endMs: 7000, text: 'Adiós' }]

describe('subtitle origin', () => {
  it('stamps every placed cue with its origin and lists it', () => {
    const c = applyCuesToComposition(make(), cues, { origin: 'auto' }).composition
    expect(captionList(c).map(q => q.origin)).toEqual(['auto', 'auto'])
    expect(originSummary(c)).toMatchObject({ auto: 2, 'auto-edited': 0, none: 0 })
  })
  it('editing one automatic cue turns only that one into «auto-edited»; the file is not «reviewed» while others stay auto', () => {
    let c = applyCuesToComposition(make(), cues, { origin: 'auto' }).composition
    c = editCue(c, captionList(c)[0], { text: 'Hola a todos' })
    expect(originSummary(c)).toMatchObject({ auto: 1, 'auto-edited': 1 })
    expect(captionList(c).map(q => q.origin)).toEqual(['auto-edited', 'auto'])
  })
  it('manual and imported cues keep their origin when edited', () => {
    for (const o of ['manual', 'imported'] as const) {
      let c = applyCuesToComposition(make(), cues, { origin: o }).composition
      c = editCue(c, captionList(c)[0], { text: 'x' })
      expect(captionList(c)[0].origin).toBe(o)
    }
  })
  it('markCueReviewed only affects automatic cues', () => {
    let c = applyCuesToComposition(make(), cues, { origin: 'auto' }).composition
    c = markCueReviewed(c, captionList(c)[1]); expect(originSummary(c)).toMatchObject({ auto: 1, 'auto-edited': 1 })
    const m = applyCuesToComposition(make(), cues, { origin: 'manual' }).composition
    expect(markCueReviewed(m, captionList(m)[0])).toEqual(m)
  })
  it('origin survives saving/recovering the project and splitting a clip', () => {
    const c = applyCuesToComposition(make(), cues, { origin: 'auto' }).composition
    const back = parseComposition(JSON.parse(JSON.stringify(c)))!
    expect(captionList(back).map(q => q.origin)).toEqual(['auto', 'auto'])
    const split = splitClip(back, 'c0', 1000)
    expect(originSummary(split).auto).toBeGreaterThanOrEqual(2)
  })
  it('older projects without origin still load and show no origin', () => {
    const old = JSON.parse(JSON.stringify(applyCuesToComposition(make(), cues).composition))
    old.clips.forEach((k: { cues?: Array<{ origin?: string }> }) => k.cues?.forEach(q => { delete q.origin }))
    const c = parseComposition(old)!
    expect(captionList(c).every(q => q.origin === undefined)).toBe(true); expect(originSummary(c).none).toBe(2)
  })
  it('ignores an invalid origin in saved data', () => {
    const raw = JSON.parse(JSON.stringify(applyCuesToComposition(make(), cues, { origin: 'auto' }).composition))
    raw.clips[0].cues[0].origin = 'hacked'
    expect(captionList(parseComposition(raw)!)[0].origin).toBeUndefined()
  })
})
