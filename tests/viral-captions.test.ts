import { describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { drawCaption, wordSpan } from '@/lib/editor/draw'
import { captionWordsFor, clipCaptions, compositionCues, emptyComposition, parseComposition, type Clip } from '@/lib/editor/composition'

describe('viral captions', () => {
  it('shows only a few words at a time and keeps the plain look at 10', () => {
    const clip = { narration: 'Un rayo es cinco veces más caliente que el Sol hoy', durationMs: 6000 } as Clip
    expect(clipCaptions(clip, captionWordsFor('viral')).map(c => c.text)).toEqual(['Un rayo es', 'cinco veces más', 'caliente que el', 'Sol hoy'])
    expect(clipCaptions(clip, captionWordsFor('box'))).toHaveLength(2)
  })
  it('subtitle export follows the same chunks as the video', () => {
    const c = { ...emptyComposition('s', 't', '9:16'), subtitles: true, captionStyle: 'viral' as const, clips: [{ id: 'a', narration: 'uno dos tres cuatro', durationMs: 4000 } as Clip] }
    expect(compositionCues(c).map(q => q.text)).toEqual(['uno dos tres', 'cuatro'])
  })
  it('finds the spoken word and how far into it we are', () => {
    expect(wordSpan(['A', 'BB', 'CCCC'], 0).index).toBe(0)
    expect(wordSpan(['AAAA', 'BBBB'], 0.9).index).toBe(1)
    expect(wordSpan(['AAAA', 'BBBB'], 0.25).local).toBeCloseTo(0.5, 1)
  })
  it('survives a save and load, and draws on a vertical frame', () => {
    const c = parseComposition({ ...emptyComposition('s', 't', '9:16'), captionStyle: 'viral' })
    expect(c?.captionStyle).toBe('viral')
    const cv = createCanvas(360, 640); const x = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    x.fillStyle = '#334'; x.fillRect(0, 0, 360, 640)
    drawCaption(x, 'cinco veces más', 360, 640, 'viral', 0.5)
    const d = (cv.getContext('2d') as unknown as CanvasRenderingContext2D).getImageData(0, 380, 360, 80).data
    let accent = 0, white = 0
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 240 && d[i + 1] > 200 && d[i + 2] < 140) accent++; if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++ }
    expect(accent).toBeGreaterThan(200)
    expect(white).toBeGreaterThan(200)
  })
})
