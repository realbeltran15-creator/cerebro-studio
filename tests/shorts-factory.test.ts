import { describe, expect, it, vi } from 'vitest'
import { defaultShortsConfig, shortsConfig } from '@/lib/shorts/config'
import { candidatesFromOpportunities, classifyTheme, isRepeatTopic, rankCandidates, topicTokens, type OpportunityRow } from '@/lib/shorts/topics'
import { assessSources, comparable, fetchPublicPage, keyTermCoverage, registrableDomain, sourceReliability } from '@/lib/shorts/sources'
import { parseProposal, parseScript, scriptChecks, FIRST_WORDS, type ShortScript } from '@/lib/shorts/script'
import { buildShortComposition, sceneDurations, voiceLooksRight, wavDurationMs } from '@/lib/shorts/plan'
import { fetchVideoRetention, historyBoost, isRetentionDue, MIN_VIEWS_FOR_LEARNING, retentionWindow, themeRetention, type ObservedRetention } from '@/lib/shorts/retention'
import { approvalSummary, shortPayload } from '@/lib/shorts/publish'
import { chooseFreeModels, prepareDailyShort, type FactoryDeps, type FreeModels, type ItemRow, type Store } from '@/lib/shorts/factory'
import { catalog } from '@/lib/providers/catalog'
import type { Availability } from '@/lib/providers/router'

const cfg = defaultShortsConfig
const NOW = new Date('2026-10-12T08:00:00Z')

// ---------- fixtures ----------
const opp = (i: number, views: number, title = `Vídeo número ${i} sobre curiosidades`, extra: Record<string, unknown> = {}): OpportunityRow => ({
  id: `o${i}`, title, source_id: `https://www.youtube.com/watch?v=vid${i}`, observed_metrics: { views, channel_title: 'Canal' }, calculated_metrics: { viewsPerDay: views / 10, ...extra },
})
const pool = (): OpportunityRow[] => [opp(1, 1000), opp(2, 1200), opp(3, 900), opp(4, 1100), opp(5, 1000), opp(6, 50_000, 'Por qué una estrella de neutrones pesa tanto: curiosidades del universo')]

describe('config', () => {
  it('falls back to safe defaults and clamps values', () => {
    expect(shortsConfig({})).toEqual(defaultShortsConfig)
    const c = shortsConfig({ channelName: '  Otro  ', region: 'xx', minRatioToMedian: 999, minImageQuality: 0, scenes: { min: 9, max: 2 }, extraReliableDomains: ['Ejemplo.org', 'no es dominio'], maxTextCalls: 500 })
    expect(c.channelName).toBe('Otro')
    expect(c.region).toBe('ES')
    expect(c.minRatioToMedian).toBe(20)
    expect(c.minImageQuality).toBe(1)
    expect(c.scenes.max).toBeGreaterThanOrEqual(c.scenes.min)
    expect(c.extraReliableDomains).toEqual(['ejemplo.org'])
    expect(c.maxTextCalls).toBe(12)
  })
})

describe('topics', () => {
  it('needs a pool before a median means anything', () => {
    const r = rankCandidates(candidatesFromOpportunities([opp(1, 100), opp(2, 200)]), cfg)
    expect(r.ranked).toEqual([])
    expect(r.blocker).toMatch(/mediana del nicho/)
  })
  it('requires interest proven against the niche median, with observed/calculated labels', () => {
    const r = rankCandidates(candidatesFromOpportunities(pool()), cfg)
    expect(r.nicheMedian).toBe(1050)
    const best = r.ranked[0]
    expect(best.candidate.opportunityId).toBe('o6')
    expect(best.provenInterest).toBe(true)
    expect(best.components.interest.kind).toBe('calculated')
    expect(best.components.interest.note).toMatch(/observadas/)
    expect(r.ranked.filter(x => x.provenInterest)).toHaveLength(1)
    expect(r.ranked.find(x => x.candidate.opportunityId === 'o1')!.rejection).toMatch(/Interés no comprobado/)
  })
  it('never proposes a repeated topic', () => {
    const r = rankCandidates(candidatesFromOpportunities(pool()), cfg, { previousTopics: ['Estrella de neutrones: por qué pesa tanto'] })
    expect(r.ranked.find(x => x.candidate.opportunityId === 'o6')!.rejection).toBe('Tema ya usado.')
    expect(r.blocker).toMatch(/Ningún vídeo/)
  })
  it('detects repeats ignoring accents, case and stop words', () => {
    expect(isRepeatTopic('Cuántas ESTRELLAS hay en el universo', ['estrellas en el Universo: cuántas hay'])).toBe(true)
    expect(isRepeatTopic('El océano más profundo', ['Estrellas de neutrones'])).toBe(false)
    expect(topicTokens('¡El Sol, la Luna y el mar!')).toEqual(['sol', 'luna', 'mar'])
  })
  it('classifies themes without calling a model', () => {
    expect(classifyTheme('Por qué el cerebro y el corazón trabajan juntos')).toBe('cuerpo humano')
    expect(classifyTheme('La NASA y el planeta Marte')).toBe('espacio')
    expect(classifyTheme('Receta de tarta')).toBe('otros')
  })
  it('labels the retention history boost as inferred', () => {
    const boost = (t: string) => ({ value: 1, kind: 'inferred' as const, note: `historial de ${t}` })
    const r = rankCandidates(candidatesFromOpportunities(pool()), cfg, { history: boost })
    expect(r.ranked[0].components.history.kind).toBe('inferred')
  })
})

describe('sources', () => {
  it('computes the registrable domain', () => {
    expect(registrableDomain('www.nasa.gov')).toBe('nasa.gov')
    expect(registrableDomain('es.wikipedia.org')).toBe('wikipedia.org')
    expect(registrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk')
  })
  it('classifies reliability', () => {
    expect(sourceReliability('https://www.nasa.gov/x').reliable).toBe(true)
    expect(sourceReliability('https://universidad.ac.uk/p').reliable).toBe(true)
    expect(sourceReliability('https://blog-de-curiosidades.com/x').reliable).toBe(false)
    expect(sourceReliability('https://blog-de-curiosidades.com/x', ['blog-de-curiosidades.com']).reliable).toBe(true)
  })
  it('matches numbers regardless of separators and accents', () => {
    expect(comparable('6.000 millones')).toBe(comparable('6000 millones'))
    expect(keyTermCoverage('Pesaría 6,000 millones de toneladas', ['6.000 millones'])).toBe(1)
    expect(keyTermCoverage('Nada que ver', ['6.000 millones', 'neutrones'])).toBe(0)
  })

  const page = (text: string) => async () => ({ ok: true, status: 200, text })
  const terms = ['estrella de neutrones', '6.000 millones']
  const good = 'La estrella de neutrones es tan densa que una cucharadita pesaría 6.000 millones de toneladas.'

  it('accepts a fact only with two reliable sources on different domains that contain it', async () => {
    const r = await assessSources([{ url: 'https://www.nasa.gov/a', title: 'NASA' }, { url: 'https://www.esa.int/b', title: 'ESA' }], terms, page(good))
    expect(r.ok).toBe(true)
    expect(r.accepted.map(s => s.domain)).toEqual(['nasa.gov', 'esa.int'])
  })
  it('counts one domain once', async () => {
    const r = await assessSources([{ url: 'https://www.nasa.gov/a', title: 'a' }, { url: 'https://science.nasa.gov/b', title: 'b' }], terms, page(good))
    expect(r.ok).toBe(false)
    expect(r.verdicts[1].reason).toMatch(/Mismo dominio/)
  })
  it('rejects unreliable, unreachable, off-topic and private sources', async () => {
    const fetchPage = vi.fn(async (url: string) => url.includes('esa.int') ? { ok: false, status: 404, text: '' } : { ok: true, text: 'texto que no habla del tema' })
    const r = await assessSources([
      { url: 'https://blog-cualquiera.com/a', title: 'blog' },
      { url: 'https://www.esa.int/b', title: 'esa' },
      { url: 'https://www.nasa.gov/c', title: 'nasa' },
      { url: 'https://10.0.0.5/admin', title: 'privada' },
      { url: 'http://www.nasa.gov/d', title: 'sin https' },
    ], terms, fetchPage)
    expect(r.ok).toBe(false)
    const reasons = r.verdicts.map(v => v.reason).join('|')
    expect(reasons).toMatch(/sin clasificar como fiable/)
    expect(reasons).toMatch(/No se pudo abrir la página \(404\)/)
    expect(reasons).toMatch(/no contiene el dato/)
    expect(reasons.match(/HTTPS pública/g)).toHaveLength(2)
    // the private and non-HTTPS URLs were never fetched
    expect(fetchPage).not.toHaveBeenCalledWith('https://10.0.0.5/admin')
  })
  it('follows redirects by hand and re-checks every hop', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://www.esa.int/final' } }))
      .mockResolvedValueOnce(new Response('<html><script>x()</script><p>Hola &amp; adiós</p></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }))
    const r = await fetchPublicPage('https://www.nasa.gov/start', fetchImpl as unknown as typeof fetch)
    expect(r).toMatchObject({ ok: true, text: 'Hola & adiós' })
    const toPrivate = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } }))
    expect((await fetchPublicPage('https://www.nasa.gov/x', toPrivate as unknown as typeof fetch)).ok).toBe(false)
    const pdf = vi.fn().mockResolvedValueOnce(new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }))
    expect((await fetchPublicPage('https://www.nasa.gov/x.pdf', pdf as unknown as typeof fetch)).ok).toBe(false)
  })
})

describe('script controls', () => {
  const keyTerms = ['estrella de neutrones', '6.000 millones']
  const verified = 'La estrella de neutrones: una cucharadita pesaría 6.000 millones de toneladas.'
  const scene = (narration: string, onScreenText = '') => ({ narration, visual: 'Una estrella brillante en el espacio profundo, vista desde lejos', onScreenText })
  const filler = 'Esto ocurre porque la materia se comprime hasta quedar casi sin espacio vacío entre sus partículas más pequeñas'
  const good: ShortScript = {
    title: 'La cucharadita más pesada del universo', description: 'd', hashtags: ['ciencia'],
    scenes: [scene('Una estrella de neutrones: 6.000 millones de toneladas por cucharadita.', '6.000 millones de toneladas'), scene(filler), scene(filler), scene(filler), scene('Sigue el canal para más curiosidades del universo cada día')],
  }
  it('passes when hook and fact open the Short and every number is in the sources', () => {
    const r = scriptChecks(good, { keyTerms }, verified, cfg)
    expect(r.checks.filter(c => !c.ok)).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('fails when the main fact is not in the first 2 seconds', () => {
    const late: ShortScript = { ...good, scenes: [scene('Hoy vamos a hablar de algo realmente muy interesante sobre el universo: 6.000 millones de toneladas', '6.000 millones'), ...good.scenes.slice(1)] }
    const r = scriptChecks(late, { keyTerms }, verified, cfg)
    expect(r.checks.find(c => c.id === 'hook_fact_2s')!.ok).toBe(false)
    expect(FIRST_WORDS).toBe(6)
  })
  it('fails without on-screen text at second 0', () => {
    const noText: ShortScript = { ...good, scenes: [scene(good.scenes[0].narration, ''), ...good.scenes.slice(1)] }
    expect(scriptChecks(noText, { keyTerms }, verified, cfg).checks.find(c => c.id === 'screen_text_0s')!.ok).toBe(false)
  })
  it('fails when the narration states a number the sources do not contain', () => {
    const made: ShortScript = { ...good, scenes: [...good.scenes.slice(0, 1), scene(`${filler}, a ${'12.345'} kilómetros`), ...good.scenes.slice(2)] }
    const r = scriptChecks(made, { keyTerms }, verified, cfg)
    expect(r.checks.find(c => c.id === 'numbers_verified')!.message).toMatch(/12345/)
    expect(r.ok).toBe(false)
  })
  it('fails when too short or with too few scenes', () => {
    const short: ShortScript = { ...good, scenes: good.scenes.slice(0, 2).map(s => ({ ...s, narration: s.narration.split(' ').slice(0, 9).join(' ') })) }
    const r = scriptChecks(short, { keyTerms }, verified, cfg)
    expect(r.checks.find(c => c.id === 'duration')!.ok).toBe(false)
    expect(r.checks.find(c => c.id === 'scene_count')!.ok).toBe(false)
  })
  it('refuses visuals that ask for text inside the image', () => {
    const text: ShortScript = { ...good, scenes: [{ ...good.scenes[0], visual: 'Un cartel con texto grande' }, ...good.scenes.slice(1)] }
    expect(scriptChecks(text, { keyTerms }, verified, cfg).checks.find(c => c.id === 'visual_no_text')!.ok).toBe(false)
  })
  it('parses proposals and scripts defensively', () => {
    expect(parseProposal({ topic: 't', statement: 's', keyTerms: ['a'], sources: [{ url: 'https://a.org', title: 'a' }] })).toBeNull() // needs 2 sources
    expect(parseProposal({ topic: 't', statement: 's', keyTerms: ['ab'], sources: [{ url: 'https://a.org', title: 'a' }, { url: 'https://b.org', title: 'b' }] })).not.toBeNull()
    expect(parseScript({ title: '', scenes: [] })).toBeNull()
    expect(parseScript({ title: 'x', scenes: [{ narration: 'n', visual: 'v' }], hashtags: ['#a b', 5] })!.hashtags).toEqual(['ab'])
  })
})

function wav(seconds: number, rate = 24000) {
  const data = Math.floor(seconds * rate) * 2
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data, 40)
  return b
}

describe('plan', () => {
  it('reads WAV duration from the header, including streamed files', () => {
    expect(wavDurationMs(new Uint8Array(wav(26)))).toBe(26000)
    const streamed = wav(10); streamed.writeUInt32LE(0xffffffff, 40)
    expect(wavDurationMs(new Uint8Array(streamed))).toBe(10000)
    expect(wavDurationMs(new Uint8Array(10))).toBeNull()
  })
  it('judges whether the voice matches the script', () => {
    expect(voiceLooksRight(26000, 28)).toBe(true)
    expect(voiceLooksRight(3000, 28)).toBe(false)
    expect(voiceLooksRight(null, 28)).toBe(false)
    expect(voiceLooksRight(120_000, 100)).toBe(false)
  })
  it('splits the audio across scenes by words and keeps the total', () => {
    const d = sceneDurations(['uno dos tres cuatro', 'uno dos', 'uno dos tres cuatro cinco seis seis siete'], 20000)
    expect(d.reduce((a, b) => a + b, 0)).toBe(20000)
    expect(Math.min(...d)).toBeGreaterThanOrEqual(1500)
  })
  it('builds a 9:16 composition with the data on screen from frame 0, subtitles, voice and quiet music', () => {
    const script: ShortScript = { title: 'T', description: '', hashtags: [], scenes: [{ narration: 'Hola dato', visual: 'v', onScreenText: '6.000 millones' }, { narration: 'Segunda', visual: 'v', onScreenText: '' }] }
    const c = buildShortComposition({ storyboardId: 'sb', title: 'T', script, scenes: [{ id: 's1', position: 1 }, { id: 's2', position: 2 }], durationsMs: [3000, 4000], imageAssetIds: ['i1', null], voiceAssetId: 'v1', audioMs: 7000, musicAssetId: 'm1' })
    expect(c.format).toBe('9:16')
    expect(c.hookText).toBe('6.000 millones')
    expect(c.subtitles).toBe(true)
    expect(c.clips[0].text).toMatchObject({ content: '6.000 millones', position: 'center' })
    expect(c.clips[1].text).toBeNull()
    expect(c.audioClips![0]).toMatchObject({ kind: 'voice', assetId: 'v1', startMs: 0, durationMs: 7000 })
    expect(c.musicAssetId).toBe('m1')
    expect(c.musicVolume).toBeLessThan(0.2)
  })
})

describe('retention (observed) and what it teaches (inferred)', () => {
  it('uses the first 7 days of the video', () => {
    expect(retentionWindow('2026-10-01T15:30:00Z')).toEqual({ startDate: '2026-10-01', endDate: '2026-10-07' })
  })
  it('is due only after the window and the Analytics delay', () => {
    expect(isRetentionDue('2026-10-01T10:00:00Z', new Date('2026-10-08T00:00:00Z'))).toBe(false)
    expect(isRetentionDue('2026-10-01T10:00:00Z', new Date('2026-10-10T00:00:00Z'))).toBe(true)
  })
  it('asks YouTube Analytics for averageViewPercentage of that one video and window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ columnHeaders: [{ name: 'averageViewPercentage' }, { name: 'views' }, { name: 'averageViewDuration' }], rows: [[72.5, 400, 21]] }), { status: 200 }))
    const r = await fetchVideoRetention('tok', 'abcDEF12345', { startDate: '2026-10-01', endDate: '2026-10-07' }, fetchImpl as unknown as typeof fetch, NOW)
    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.searchParams.get('filters')).toBe('video==abcDEF12345')
    expect(url.searchParams.get('metrics')).toBe('averageViewPercentage,views,averageViewDuration')
    expect(url.searchParams.get('startDate')).toBe('2026-10-01')
    expect(url.searchParams.get('endDate')).toBe('2026-10-07')
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer tok' })
    expect(r).toMatchObject({ averageViewPercentage: 72.5, views: 400, source: 'youtube_analytics_v2', usableForLearning: true })
  })
  it('does not learn from a handful of views and surfaces access errors', async () => {
    const few = vi.fn().mockResolvedValue(new Response(JSON.stringify({ columnHeaders: [{ name: 'averageViewPercentage' }, { name: 'views' }], rows: [[90, MIN_VIEWS_FOR_LEARNING - 1]] }), { status: 200 }))
    expect((await fetchVideoRetention('t', 'abcDEF12345', retentionWindow('2026-10-01T00:00:00Z'), few as unknown as typeof fetch, NOW)).usableForLearning).toBe(false)
    const denied = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }))
    await expect(fetchVideoRetention('t', 'abcDEF12345', retentionWindow('2026-10-01T00:00:00Z'), denied as unknown as typeof fetch, NOW)).rejects.toThrow(/permisos de Analytics/)
    await expect(fetchVideoRetention('t', 'no válido!', retentionWindow('2026-10-01T00:00:00Z'))).rejects.toThrow(/no válido/)
  })
  const r = (pct: number | null, views = 500): ObservedRetention => ({ averageViewPercentage: pct, views, averageViewDuration: null, window: { startDate: 'a', endDate: 'b' }, source: 'youtube_analytics_v2', fetchedAt: 'x', usableForLearning: pct !== null && views >= MIN_VIEWS_FOR_LEARNING })
  it('gives no boost until there is enough measured history, then a capped inferred one', () => {
    expect(historyBoost([{ theme: 'espacio', retention: r(80) }])('espacio')).toMatchObject({ value: 0, kind: 'inferred' })
    const items = [
      ...[85, 88, 90].map(p => ({ theme: 'espacio' as const, retention: r(p) })),
      ...[50, 55, 52].map(p => ({ theme: 'historia' as const, retention: r(p) })),
    ]
    const boost = historyBoost(items)
    expect(boost('espacio').value).toBeGreaterThan(0)
    expect(boost('espacio').value).toBeLessThanOrEqual(1.5)
    expect(boost('historia').value).toBeLessThan(0)
    expect(boost('espacio').kind).toBe('inferred')
    expect(boost('espacio').note).toMatch(/retención mediana observada/)
    expect(boost('cultura').value).toBe(0)
    expect(themeRetention(items).samples).toBe(6)
  })
})

describe('publication payload', () => {
  it('is always private, synthetic-declared and not for kids, with the verified sources in the description', () => {
    const p = shortPayload({ title: 'Una <cucharadita> pesada', description: 'Desc', hashtags: ['#ciencia'] }, [{ url: 'https://www.nasa.gov/a', status: 'accepted' }, { url: 'https://mala.com', status: 'rejected' }], 'asset1')
    expect(p).toMatchObject({ privacyStatus: 'private', containsSyntheticMedia: true, madeForKids: false, videoAssetId: 'asset1' })
    expect(p.title).toBe('Una cucharadita pesada #Shorts')
    expect(p.title.length).toBeLessThanOrEqual(100)
    expect(p.description).toContain('https://www.nasa.gov/a')
    expect(p.description).not.toContain('mala.com')
    expect(p.description).toMatch(/creado con ayuda de IA/)
    expect(p.description).not.toMatch(/[<>]/)
    expect(approvalSummary('t', p, 1)).toMatch(/privado[\s\S]*sintético declarado: sí[\s\S]*0 USD/)
  })
})

describe('free models and the quality floor', () => {
  const ready = (ids: string[], remaining?: number): Record<string, Availability> => Object.fromEntries(catalog.map(m => [m.id, { ready: ids.includes(m.id), remaining: m.allowance ? remaining : undefined }]))
  const klein = 'cloudflare:@cf/black-forest-labs/flux-2-klein-4b', tts = 'gemini:gemini-3.8-flash-tts'
  it('picks the free image and voice models that reach the minimum', () => {
    const r = chooseFreeModels(cfg, catalog, ready([klein, tts, 'cloudflare:@cf/myshell-ai/melotts', 'cloudflare:@cf/black-forest-labs/flux-1-schnell'], 10_000), 6)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.image.id).toBe(klein); expect(r.voice.id).toBe(tts) }
  })
  it('does not downgrade: with the keys missing, or only low-quality free voice, nothing is created', () => {
    expect(chooseFreeModels(cfg, catalog, ready([]), 6).ok).toBe(false)
    const lowVoice = chooseFreeModels(cfg, catalog, ready([klein, 'cloudflare:@cf/myshell-ai/melotts'], 10_000), 6)
    expect(lowVoice.ok).toBe(false)
    if (!lowVoice.ok) expect(lowVoice.reasons.join(' ')).toMatch(/Voz.*calidad ≥ 4/)
  })
  it('refuses to start when the free allowance would run out in the middle of the Short', () => {
    const none = chooseFreeModels(cfg, catalog, ready([klein, tts], 100), 6)
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.reasons.join(' ')).toMatch(/Cupo gratuito agotado/)
    // enough for one image but not for the six scenes of this Short
    const some = chooseFreeModels(cfg, catalog, ready([klein, tts], 300), 6)
    expect(some.ok).toBe(false)
    if (!some.ok) expect(some.reasons.join(' ')).toMatch(/cupo gratuito de imagen no alcanza para 6 escenas/)
  })
  it('never selects a paid model even if it is the only one configured', () => {
    const r = chooseFreeModels({ ...cfg, minImageQuality: 5 }, catalog, ready(['openai:gpt-image-2', klein, tts], 10_000), 6)
    expect(r.ok).toBe(false)
  })
})

// ---------- the whole decision chain with fakes ----------
const statement = 'Una cucharadita de estrella de neutrones pesaría unos 6.000 millones de toneladas'
const pageText = 'Una estrella de neutrones es tan densa que una cucharadita de su materia pesaría unos 6.000 millones de toneladas en la Tierra.'
const filler = 'Esto ocurre porque la materia se comprime hasta quedar casi sin espacio vacío entre sus partículas más pequeñas'
const goodScript = {
  title: 'La cucharadita más pesada del universo', description: 'Una curiosidad.', hashtags: ['ciencia', 'universo'],
  scenes: [
    { narration: 'Una estrella de neutrones: 6.000 millones de toneladas por cucharadita.', visual: 'Una estrella brillante en el espacio profundo', onScreenText: '6.000 millones de toneladas' },
    { narration: filler, visual: 'Partículas diminutas muy juntas, fotografía macro', onScreenText: '' },
    { narration: filler, visual: 'Una cucharita sobre una mesa de madera', onScreenText: '' },
    { narration: filler, visual: 'La Tierra vista desde el espacio', onScreenText: '' },
    { narration: 'Sigue el canal para más curiosidades del universo cada día', visual: 'Un cielo estrellado', onScreenText: '' },
  ],
}
const goodProposal = { topic: 'Densidad de una estrella de neutrones', statement, keyTerms: ['estrella de neutrones', '6.000 millones'], sources: [{ url: 'https://www.nasa.gov/neutron', title: 'NASA' }, { url: 'https://www.esa.int/neutron', title: 'ESA' }] }

function fakeStore(opts: { failAt?: 'scenes' | 'voice' } = {}) {
  const calls: string[] = []
  const store: Store & { calls: string[]; discarded: unknown[]; items: Array<Record<string, unknown>>; assets: Array<{ kind: string; provenance: Record<string, unknown>; license: string }> } = {
    calls, discarded: [], items: [], assets: [],
    async saveDiscarded(i) { calls.push('discard'); store.discarded.push(i) },
    async createProject() { calls.push('project'); return { id: 'p1' } },
    async createScript() { calls.push('script'); return { id: 'sc1' } },
    async createStoryboard() { calls.push('storyboard'); return { id: 'sb1' } },
    async createScenes(_id, scenes) { calls.push('scenes'); if (opts.failAt === 'scenes') throw new Error('db caído'); return scenes.map(s => ({ id: `s${s.position}`, position: s.position })) },
    async putAsset(_p, kind, _a, extra) { calls.push(`asset:${kind}`); store.assets.push({ kind, provenance: extra.provenance, license: extra.license }); return { id: `a-${kind}-${store.assets.length}` } },
    async createRenderJob() { calls.push('render'); return { id: 'rj1' } },
    async saveItem(item) { calls.push('item'); store.items.push(item); return { id: 'it1' } },
    async rollback() { calls.push('rollback') },
  }
  return store
}

function deps(over: Partial<FactoryDeps> & { store?: ReturnType<typeof fakeStore> } = {}) {
  const store = over.store ?? fakeStore()
  const counts = { text: 0, image: 0, voice: 0, fetch: 0 }
  const free: FreeModels = { ok: true, image: catalog.find(m => m.id === 'cloudflare:@cf/black-forest-labs/flux-2-klein-4b')!, voice: catalog.find(m => m.id === 'gemini:gemini-3.8-flash-tts')! }
  const d: FactoryDeps = {
    now: () => NOW, opportunities: pool(), items: [], existingProjectNames: [], freeModels: () => free,
    async text(task, input) {
      counts.text++
      const raw = input.schemaName === 'short_proposal' ? goodProposal : input.schemaName === 'short_verification' ? { supported: true, contradictions: [], note: 'Coinciden' } : goodScript
      const data = input.validate(raw)
      if (data === null) throw new Error('inválido')
      return { data, model: 'gemini:gemini-3.8-flash', estimatedUsd: 0 }
    },
    async fetchPage() { counts.fetch++; return { ok: true, status: 200, text: pageText } },
    async generateImage() { counts.image++; return { provider: 'cloudflare', mimeType: 'image/png', uri: 'data:image/png;base64,iVBORw0KGgo=' } },
    async generateVoice() { counts.voice++; return { provider: 'gemini', mimeType: 'audio/wav', uri: `data:audio/wav;base64,${wav(27).toString('base64')}` } },
    async findMusic() { return { id: '42', title: 'Calma', author: 'autor', pageUrl: 'https://freesound.org/s/42', license: 'Creative Commons 0', licenseUrl: null, downloadUrl: 'https://cdn.freesound.org/p.mp3', mimeType: 'audio/mpeg', durationSeconds: 60, attribution: 'autor' } },
    store, ...over,
  }
  return { d, store, counts }
}

describe('prepareDailyShort', () => {
  it('prepares one Short end to end with zero spend and full evidence', async () => {
    const { d, store, counts } = deps()
    const { outcome, textCalls } = await prepareDailyShort(cfg, d)
    expect(outcome).toMatchObject({ status: 'prepared', topic: goodProposal.topic, projectId: 'p1', renderJobId: 'rj1' })
    expect(store.calls).toEqual(['project', 'script', 'storyboard', 'scenes', 'asset:voice', 'asset:image', 'asset:image', 'asset:image', 'asset:image', 'asset:image', 'asset:music', 'render', 'item'])
    expect(counts).toMatchObject({ text: 3, image: 5, voice: 1 })
    expect(textCalls).toBe(3)
    const item = store.items[0] as Record<string, any>
    expect(item.status).toBe('prepared')
    expect(item.spend).toMatchObject({ usd: 0, textCalls: 3, imageCalls: 5, voiceCalls: 1, tier: 'free' })
    expect(item.sources.filter((s: { status: string }) => s.status === 'accepted')).toHaveLength(2)
    expect(item.checks.every((c: { ok: boolean }) => c.ok)).toBe(true)
    expect(item.interest.video.kind).toBe('observed')
    expect(item.interest.components.interest.kind).toBe('calculated')
    // image assets carry the allowance accounting so the free quota is tracked
    expect(store.assets.filter(a => a.kind === 'image').every(a => a.provenance.allowancePool === 'cloudflare-neurons')).toBe(true)
    expect(store.assets.find(a => a.kind === 'music')!.license).toBe('public_domain')
  })
  it('prepares at most one Short a day', async () => {
    const items: ItemRow[] = [{ topic: 'otro tema', topic_key: 'otro tema', theme: 'otros', status: 'prepared', prepared_on: '2026-10-12', created_at: '2026-10-12T07:00:00Z', retention: null }]
    const { d, counts } = deps({ items })
    const { outcome } = await prepareDailyShort(cfg, d)
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'already_prepared_today' })
    expect(counts.text).toBe(0)
  })
  it('does not spend a single call when free options cannot reach the minimum quality', async () => {
    const { d, counts } = deps({ freeModels: () => ({ ok: false, reasons: ['Voz: ninguna opción gratuita con calidad ≥ 4/5 en español está disponible (Falta configurar la clave en el servidor).'] }) })
    const { outcome } = await prepareDailyShort(cfg, d)
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'quality_floor_unmet' })
    expect(counts).toEqual({ text: 0, image: 0, voice: 0, fetch: 0 })
  })
  it('skips without data or without proven interest', async () => {
    expect((await prepareDailyShort(cfg, deps({ opportunities: pool().slice(0, 2) }).d)).outcome).toMatchObject({ reason: 'no_data' })
    const flat = [1, 2, 3, 4, 5, 6].map(i => opp(i, 1000 + i))
    expect((await prepareDailyShort(cfg, deps({ opportunities: flat }).d)).outcome).toMatchObject({ reason: 'no_proven_interest' })
  })
  it('discards a fact that does not have two reliable sources and records why', async () => {
    const { d, store } = deps({ fetchPage: async () => ({ ok: false, status: 404, text: '' }) })
    const { outcome } = await prepareDailyShort({ ...cfg, maxCandidatesPerDay: 1 }, d)
    expect(outcome.status).toBe('skipped')
    expect(store.discarded).toHaveLength(1)
    expect(store.discarded[0]).toMatchObject({ reason: expect.stringMatching(/Menos de 2 fuentes/) })
    expect(store.calls).not.toContain('project')
  })
  it('discards when the verification step does not support the fact', async () => {
    const { d, store } = deps({
      async text(_t, input) {
        const raw = input.schemaName === 'short_proposal' ? goodProposal : { supported: false, contradictions: ['las fuentes dicen 600 millones'], note: '' }
        return { data: input.validate(raw)!, model: 'm', estimatedUsd: 0 }
      },
    })
    await prepareDailyShort({ ...cfg, maxCandidatesPerDay: 1 }, d)
    expect(store.discarded[0]).toMatchObject({ reason: expect.stringMatching(/no respaldan el dato.*600 millones/) })
  })
  it('retries a script that fails the controls once with feedback, then discards it', async () => {
    const bad = { ...goodScript, scenes: [{ ...goodScript.scenes[0], narration: 'Hoy hablaremos de algo muy interesante sobre el universo entero' }, ...goodScript.scenes.slice(1)] }
    const seen: string[] = []
    const { d, store, counts } = deps({
      async text(_t, input) {
        seen.push(input.user)
        const raw = input.schemaName === 'short_proposal' ? goodProposal : input.schemaName === 'short_verification' ? { supported: true, contradictions: [], note: '' } : bad
        return { data: input.validate(raw)!, model: 'm', estimatedUsd: 0 }
      },
    })
    await prepareDailyShort({ ...cfg, maxCandidatesPerDay: 1 }, d)
    expect(seen.filter(u => u.startsWith('Dato verificado'))).toHaveLength(2)
    expect(seen.at(-1)).toMatch(/Corrige estos fallos/)
    expect(store.discarded[0]).toMatchObject({ reason: expect.stringMatching(/controles/) })
    expect(counts.image).toBe(0)
  })
  it('does not repeat a topic', async () => {
    const items: ItemRow[] = [{ topic: 'Densidad de una estrella de neutrones', topic_key: 'x', theme: 'espacio', status: 'published', prepared_on: '2026-09-01', created_at: '2026-09-01T00:00:00Z', retention: null }]
    const { d, store } = deps({ items })
    const { outcome } = await prepareDailyShort({ ...cfg, maxCandidatesPerDay: 1 }, d)
    expect(outcome.status).toBe('skipped')
    expect(store.calls).not.toContain('project')
  })
  it('keeps a topic the owner discarded out for good, but may retry an automatic discard after two weeks', async () => {
    const mk = (reason: string): ItemRow[] => [{ topic: 'Estrella de neutrones: por qué pesa tanto', topic_key: 'y', theme: 'espacio', status: 'discarded', prepared_on: '2026-09-01', created_at: '2026-09-01T00:00:00Z', retention: null, discarded_reason: reason }]
    expect((await prepareDailyShort(cfg, deps({ items: mk('Descartado por el propietario en la pantalla de aprobación.') }).d)).outcome.status).toBe('skipped')
    expect((await prepareDailyShort(cfg, deps({ items: mk('Menos de 2 fuentes fiables que contengan el dato.') }).d)).outcome.status).toBe('prepared')
  })
  it('stops at the daily text-call cap instead of spending more', async () => {
    const { d } = deps()
    const { outcome, textCalls } = await prepareDailyShort({ ...cfg, maxTextCalls: 2 }, d)
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'text_budget_exhausted' })
    expect(textCalls).toBe(2)
  })
  it('does not create the Short when the free voice comes out wrong', async () => {
    const { d, store } = deps({ generateVoice: async () => ({ provider: 'gemini', mimeType: 'audio/wav', uri: `data:audio/wav;base64,${wav(2).toString('base64')}` }) })
    const { outcome } = await prepareDailyShort(cfg, d)
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'voice_quality' })
    expect(store.calls).not.toContain('project')
  })
  it('does not create the Short when a free image fails, and leaves nothing behind', async () => {
    let n = 0
    const { d, store } = deps({ generateImage: async () => { if (++n === 3) throw new Error('429 cuota'); return { provider: 'cloudflare', mimeType: 'image/png', uri: 'data:image/png;base64,iVBORw0KGgo=' } } })
    const { outcome } = await prepareDailyShort(cfg, d)
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'generation_failed' })
    expect(store.calls).toEqual([])
  })
  it('rolls everything back when persistence fails midway', async () => {
    const store = fakeStore({ failAt: 'scenes' })
    const { outcome } = await prepareDailyShort(cfg, deps({ store }).d)
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'storage_failed' })
    expect(store.calls.at(-1)).toBe('rollback')
    expect(store.items).toHaveLength(0)
  })
  it('goes ahead without music when none is available', async () => {
    const { d, store } = deps({ findMusic: async () => null })
    const { outcome } = await prepareDailyShort(cfg, d)
    expect(outcome.status).toBe('prepared')
    expect((store.items[0] as { plan: { musicMissing: boolean } }).plan.musicMissing).toBe(true)
  })
})
