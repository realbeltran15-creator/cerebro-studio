import { describe, expect, it } from 'vitest'
import {
  allocateTimes, audioGates, categoryRetention, chunkWords, evaluateInterest, hookGates, independentReliableSources, isPublicHttpUrl,
  isSameTopic, measuredHookSeconds, normalizeTopicKey, quoteAppearsIn, scoreCandidate, scriptGates,
} from '../lib/shorts/gates'
import { DEFAULT_CONFIG, type Candidate, type Script } from '../lib/shorts/types'
import { pcmSeconds, pcmToWav, trimSilence } from '../lib/shorts/wav'

const cfg = DEFAULT_CONFIG
const interest = (views: number[], niche: number, trend: 'rising' | 'flat' | 'falling' | null = 'flat') => ({ similarViews: views, nicheMedian: niche, trend })

describe('regla 1: interés comprobado con datos', () => {
  it('pasa solo si los vídeos similares superan la mediana del nicho con muestras suficientes', () => {
    expect(evaluateInterest(interest([5000, 8000, 9000, 12000, 20000], 4000), cfg).pass).toBe(true)
    expect(evaluateInterest(interest([1000, 2000, 3000, 2500, 1500], 4000), cfg).pass).toBe(false)
  })
  it('descarta sin datos, con pocas muestras o con tendencia a la baja', () => {
    expect(evaluateInterest(null, cfg).pass).toBe(false)
    expect(evaluateInterest(interest([9000, 9000], 4000), cfg).reason).toMatch(/mínimo 5/)
    expect(evaluateInterest(interest([5000, 8000, 9000, 12000, 20000], 4000, 'falling'), cfg).reason).toMatch(/baja/)
  })
  it('puntúa por separado lo observado y lo inferido', () => {
    const c: Candidate = { opportunityId: 'o', title: 't', topicKey: 't', interest: interest([5000, 8000, 9000, 12000, 20000], 4000, 'rising') }
    const s = scoreCandidate(c, 8, 'espacio', new Map(), cfg)
    expect(s.interest.basis).toBe('observed')
    expect(s.fit.basis).toBe('inferred')
    expect(s.history.basis).toBe('none')
    expect(s.total).toBeGreaterThan(0)
  })
  it('la retención histórica solo cuenta con muestras suficientes y compara con el propio canal', () => {
    const c: Candidate = { opportunityId: 'o', title: 't', topicKey: 't', interest: interest([5000, 8000, 9000, 12000, 20000], 4000) }
    const few = categoryRetention([{ category: 'espacio', averageViewPercentage: 90 }, { category: 'mar', averageViewPercentage: 50 }])
    expect(scoreCandidate(c, 7, 'espacio', few, cfg).history.basis).toBe('none')
    const many = categoryRetention([
      { category: 'espacio', averageViewPercentage: 90 }, { category: 'espacio', averageViewPercentage: 80 },
      { category: 'mar', averageViewPercentage: 40 }, { category: 'mar', averageViewPercentage: 50 },
    ])
    const hi = scoreCandidate(c, 7, 'espacio', many, cfg).history
    const lo = scoreCandidate(c, 7, 'mar', many, cfg).history
    expect(hi.basis).toBe('observed')
    expect(hi.points).toBeGreaterThan(lo.points)
  })
  it('ignora retenciones nulas', () => {
    expect(categoryRetention([{ category: 'x', averageViewPercentage: null }]).size).toBe(0)
  })
})

describe('sin repetir temas', () => {
  it('normaliza y detecta reformulaciones', () => {
    expect(normalizeTopicKey('¿Por qué el pulpo tiene TRES corazones?')).toBe(normalizeTopicKey('El pulpo tiene tres corazones, por qué'))
    expect(isSameTopic(normalizeTopicKey('Pulpo tiene tres corazones'), normalizeTopicKey('Los tres corazones del pulpo'))).toBe(true)
    expect(isSameTopic(normalizeTopicKey('Pulpo tiene tres corazones'), normalizeTopicKey('Venus gira al revés'))).toBe(false)
  })
})

describe('regla 2: fuentes', () => {
  const s = (url: string) => ({ url })
  it('exige dominios distintos y fiables', () => {
    expect(independentReliableSources([s('https://es.wikipedia.org/wiki/Pulpo'), s('https://en.wikipedia.org/wiki/Octopus')], cfg.reliableDomains)).toHaveLength(1)
    expect(independentReliableSources([s('https://es.wikipedia.org/wiki/Pulpo'), s('https://www.britannica.com/animal/octopus')], cfg.reliableDomains)).toHaveLength(2)
    expect(independentReliableSources([s('https://blograndom.com/a'), s('https://otro-blog.net/b')], cfg.reliableDomains)).toHaveLength(0)
    expect(independentReliableSources([s('https://www.bbc.co.uk/x'), s('https://news.bbc.co.uk/y')], cfg.reliableDomains)).toHaveLength(1)
  })
  it('acepta .gov/.edu y rechaza esquemas raros', () => {
    expect(independentReliableSources([s('https://oceanservice.noaa.gov/a'), s('https://biology.mit.edu/b')], cfg.reliableDomains)).toHaveLength(2)
    expect(independentReliableSources([s('javascript:alert(1)')], cfg.reliableDomains)).toHaveLength(0)
  })
  it('la cita debe aparecer literalmente en la página', () => {
    const page = 'Los pulpos tienen  tres corazones: dos branquiales y uno sistémico que bombea sangre al cuerpo.'
    expect(quoteAppearsIn(page, 'tienen tres corazones: dos branquiales y uno sistémico')).toBe(true)
    expect(quoteAppearsIn(page, 'tienen cuatro corazones: dos branquiales y uno sistémico')).toBe(false)
    expect(quoteAppearsIn(page, 'tres corazones')).toBe(false) // demasiado corta para valer como cita
  })
  it('no descarga destinos privados (SSRF)', () => {
    for (const u of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'ftp://example.com/', 'http://intranet/'])
      expect(isPublicHttpUrl(u)).toBe(false)
    expect(isPublicHttpUrl('https://es.wikipedia.org/wiki/Pulpo')).toBe(true)
  })
})

const script = (over: Partial<Script> = {}): Script => ({
  hook: 'El pulpo tiene tres corazones', key_datum: 'tres corazones', category: 'naturaleza', title: 'El pulpo tiene tres corazones',
  description: 'd', tags: ['a'],
  beats: [1, 2, 3, 4, 5].map(i => ({ text: 'Dos bombean sangre a las branquias y uno al resto del cuerpo del animal marino ' + i, visual_prompt: 'cinematic octopus underwater, vertical' })),
  ...over,
})

describe('controles antes de aprobar: hook y dato en los primeros 2 s', () => {
  it('un hook corto con el dato principal pasa', () => {
    expect(hookGates(script(), cfg).every(g => g.pass)).toBe(true)
  })
  it('falla si el dato principal no está en el hook', () => {
    const g = hookGates(script({ hook: 'Un animal muy curioso del mar' }), cfg)
    expect(g.find(x => x.name === 'dato_principal_en_hook')?.pass).toBe(false)
  })
  it('falla si el hook es demasiado largo para decirse en 2 s', () => {
    const g = hookGates(script({ hook: 'Seguro que no sabías que el pulpo tiene tres corazones de verdad', key_datum: 'tres corazones' }), cfg)
    expect(g.find(x => x.name === 'hook_corto')?.pass).toBe(false)
    expect(g.find(x => x.name === 'hook_en_2s_estimado')?.pass).toBe(false)
  })
  it('mide el hook con la duración real de la voz', () => {
    const narration = 'a'.repeat(100)
    expect(measuredHookSeconds('a'.repeat(10), narration, 30)).toBeCloseTo(3, 1) // 10/100 de 30 s
    expect(audioGates('a'.repeat(5), narration, 30, cfg).every(g => g.pass)).toBe(true)
    expect(audioGates('a'.repeat(10), narration, 30, cfg).find(g => g.name === 'hook_en_2s_medido')?.pass).toBe(false)
    expect(audioGates('a', narration, 10, cfg).find(g => g.name === 'duracion')?.pass).toBe(false)
  })
  it('valida estructura del guion', () => {
    expect(scriptGates(script(), cfg).every(g => g.pass)).toBe(true)
    expect(scriptGates(script({ beats: script().beats.slice(0, 2) }), cfg).find(g => g.name === 'escenas')?.pass).toBe(false)
    expect(scriptGates(script({ category: 'cotilleos' }), cfg).find(g => g.name === 'categoria')?.pass).toBe(false)
  })
})

describe('tiempos y subtítulos', () => {
  it('reparte la duración sin huecos', () => {
    const t = allocateTimes(['aaaa', 'bb', 'cccccc'], 12, 1)
    expect(t[0].start).toBe(1)
    expect(t[2].end).toBeCloseTo(13, 2)
    expect(t[1].start).toBeCloseTo(t[0].end, 2)
  })
  it('trocea subtítulos en grupos de 4 palabras', () => {
    expect(chunkWords('uno dos tres cuatro cinco seis')).toEqual(['uno dos tres cuatro', 'cinco seis'])
  })
})

describe('audio WAV', () => {
  it('genera una cabecera válida y recorta silencios', () => {
    const rate = 24000
    const pcm = new Uint8Array(rate * 2 * 3) // 3 s
    const view = new Int16Array(pcm.buffer)
    for (let i = rate; i < rate * 2; i++) view[i] = 8000 // solo suena el segundo central
    const trimmed = trimSilence(pcm, rate)
    expect(pcmSeconds(trimmed, rate)).toBeGreaterThan(0.95)
    expect(pcmSeconds(trimmed, rate)).toBeLessThan(1.2)
    const wav = pcmToWav(trimmed, rate)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(wav.length).toBe(44 + trimmed.length)
  })
})
