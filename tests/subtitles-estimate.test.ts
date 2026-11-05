import { describe, expect, it } from 'vitest'
import { estimateCuesFromText, ESTIMATED_TIMING_WARNING, parseSubtitles } from '@/lib/editor/subtitles'

describe('subtítulos: transcripción pegada sin tiempos', () => {
  const text = 'Una ciudad que nunca duerme. Cada noche miles de luces se encienden a la vez y nadie sabe por qué ocurre realmente esto. ¿Y tú, qué harías?'
  it('reparte el texto sobre toda la duración, sin huecos ni solapes, y avisa de que es una estimación', () => {
    const r = estimateCuesFromText(text, 10_000)
    expect(r.warnings).toContain(ESTIMATED_TIMING_WARNING)
    expect(r.cues[0].startMs).toBe(0); expect(r.cues.at(-1)!.endMs).toBe(10_000)
    r.cues.forEach((c, i) => { expect(c.endMs).toBeGreaterThan(c.startMs); if (i) expect(c.startMs).toBe(r.cues[i - 1].endMs) })
    expect(r.cues.every(c => c.text.split(/\s+/).length <= 10)).toBe(true)
    expect(r.cues.map(c => c.text).join(' ').replace(/\s+/g, ' ')).toContain('Una ciudad que nunca duerme.')
  })
  it('es determinista y los tiempos son proporcionales a la longitud', () => {
    expect(estimateCuesFromText(text, 9000)).toEqual(estimateCuesFromText(text, 9000))
    const [a, b] = estimateCuesFromText('Hola. ' + 'palabra '.repeat(8).trim() + '.', 9000).cues
    expect(b.endMs - b.startMs).toBeGreaterThan(a.endMs - a.startMs)
  })
  it('sin texto o sin duración no inventa subtítulos', () => {
    expect(estimateCuesFromText('   ', 5000).cues).toEqual([])
    expect(estimateCuesFromText('Hola', 0).cues).toEqual([])
  })
  it('un SRT real conserva sus tiempos (no se estiman)', () => {
    const p = parseSubtitles('1\n00:00:01,000 --> 00:00:03,500\nHola mundo\n')
    expect(p.cues).toEqual([{ startMs: 1000, endMs: 3500, text: 'Hola mundo' }])
    expect(p.warnings.join(' ')).not.toMatch(/ESTIMADOS/)
  })
})
