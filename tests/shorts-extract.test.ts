import { describe, expect, it } from 'vitest'
import { extractShortCandidates, shortComposition } from '@/lib/shorts/extract'

// SIMULATED transcript: proves the selection rules, not what will work on a real channel.
const seg = (start: number, end: number, text: string) => ({ start, end, text })
const transcript = [
  seg(0, 8, 'Hola a todos, bienvenidos de nuevo al canal.'), seg(8, 20, 'y hoy vamos a hablar de varias cosas sin mucho orden'),
  seg(20, 28, '¿Por qué nadie habla del secreto de las pirámides?'), seg(28, 40, 'Durante 4000 años se pensó que las construyeron esclavos, pero no fue así.'),
  seg(40, 52, 'Los registros de los obreros muestran salarios, raciones de cerveza y bajas por enfermedad.'), seg(52, 60, 'Eran trabajadores pagados.'),
  seg(70, 80, 'pero bueno, eso es otra historia que contaremos otro día'), seg(80, 95, 'El error más común al visitar Egipto es ir en agosto.'), seg(95, 110, 'A 45 grados no se disfruta nada y los templos cierran antes.'),
]

describe('long video → Short candidates (heuristic, explained)', () => {
  it('picks complete windows that open with a hook and never overlap', () => {
    const c = extractShortCandidates(transcript, { minS: 20, maxS: 45, count: 2 })
    expect(c.length).toBe(2)
    expect(c[0].startMs).toBe(20000); expect([52000, 60000]).toContain(c[0].endMs)
    expect(c[0].reasons.join(' ')).toMatch(/pregunta/)
    expect(c[0].reasons.join(' ')).toMatch(/frase completa/)
    expect(c[1].startMs).toBeGreaterThanOrEqual(c[0].endMs)
    expect(c.every(x => x.endMs - x.startMs >= 20000 && x.endMs - x.startMs <= 45000)).toBe(true)
  })
  it('penalises windows that start on a connective', () => {
    const c = extractShortCandidates(transcript, { minS: 20, maxS: 45, count: 5 })
    expect(c.some(x => x.hook.startsWith('pero bueno'))).toBe(false)
  })
  it('builds a 9:16 composition that trims the source video to the window, with captions and hook', () => {
    const [best] = extractShortCandidates(transcript, { minS: 20, maxS: 45, count: 1 })
    const comp = shortComposition('video-1', best, 'Pirámides')
    expect(comp).toMatchObject({ format: '9:16', subtitles: true, fadeMs: 0 })
    expect(comp.clips[0]).toMatchObject({ visualAssetId: 'video-1', trimInMs: 20000, durationMs: best.endMs - best.startMs, transition: 'cut' })
    expect(comp.hookText).toMatch(/Por qué nadie/)
  })
  it('returns nothing for a transcript too short for a Short', () => {
    expect(extractShortCandidates([seg(0, 5, 'Hola.')])).toEqual([])
  })
})

import { windowCues } from '@/lib/shorts/extract'
import { compositionCues, cuesToSrt } from '@/lib/editor/composition'
import { splitClip, trimStart } from '@/lib/editor/timeline'
describe('Shorts keep the transcript timing in their subtitles', () => {
  it('re-times transcript segments to the window and survives trim and split', () => {
    const [best] = extractShortCandidates(transcript, { minS: 20, maxS: 45, count: 1 })
    const cues = windowCues(transcript, best)
    expect(cues[0]).toMatchObject({ startMs: 0, text: expect.stringMatching(/^¿Por qué nadie/) })
    expect(cues.every(q => q.endMs <= best.endMs - best.startMs)).toBe(true)
    const comp = shortComposition('video-1', best, 'Pirámides', transcript)
    // Second segment starts 8 s into the window (28 s - 20 s), exactly as in the source.
    expect(compositionCues(comp).some(q => q.startMs === 8000)).toBe(true)
    expect(cuesToSrt(compositionCues(comp))).toMatch(/^1\n00:00:00,000 --> /)
    const trimmed = trimStart(comp, comp.clips[0].id, 2000)
    expect(compositionCues(trimmed).some(q => q.startMs === 6000)).toBe(true)
    const split = splitClip(comp, comp.clips[0].id, 10000)
    expect(compositionCues(split).some(q => q.startMs === 8000)).toBe(true)
    expect(split.clips[1].cues?.[0].startMs).toBe(0)
  })
})
