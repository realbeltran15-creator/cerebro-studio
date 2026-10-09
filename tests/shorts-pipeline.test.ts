import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/shorts/gemini', async () => {
  const actual = await vi.importActual<typeof import('../lib/shorts/gemini')>('../lib/shorts/gemini')
  return { ...actual, generateJson: vi.fn(), synthesizeSpeech: vi.fn() }
})
vi.mock('../lib/shorts/cloudflare', () => ({ generateImage: vi.fn() }))
vi.mock('../lib/shorts/sources', () => ({ verifySources: vi.fn() }))
vi.mock('../lib/shorts/radar', async () => {
  const actual = await vi.importActual<typeof import('../lib/shorts/radar')>('../lib/shorts/radar')
  return { ...actual, ideateTopics: vi.fn(async () => 0), enrichOpportunity: vi.fn() }
})

import { generateImage } from '../lib/shorts/cloudflare'
import { FreeTierExhausted, generateJson, synthesizeSpeech } from '../lib/shorts/gemini'
import { prepareDailyShort } from '../lib/shorts/pipeline'
import { verifySources } from '../lib/shorts/sources'

type Row = Record<string, any>
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed))
  const uploads: string[] = []
  let n = 0
  const get = (r: Row, col: string) => col.split('->>').reduce((v, k) => v?.[k], r)
  const from = (t: string) => {
    tables[t] ??= []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: any
    const filters: ((r: Row) => boolean)[] = []
    let max = Infinity
    const run = (): { data: any; error: any } => {
      if (op === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: `id${++n}`, status: 'discarded' === r.status ? r.status : r.status, ...r }))
        if (t === 'shorts') for (const it of items) {
          if (it.status !== 'discarded' && tables.shorts.some(s => s.owner_id === it.owner_id && s.run_date === it.run_date && s.status !== 'discarded')) return { data: null, error: { message: 'duplicate key' } }
        }
        tables[t].push(...items)
        return { data: items, error: null }
      }
      const rows = tables[t].filter(r => filters.every(f => f(r))).slice(0, max)
      if (op === 'update') { rows.forEach(r => Object.assign(r, payload)); return { data: rows, error: null } }
      return { data: rows, error: null }
    }
    const b: any = {
      select: () => b, insert: (p: any) => { op = 'insert'; payload = p; return b }, update: (p: any) => { op = 'update'; payload = p; return b },
      eq: (c: string, v: any) => { filters.push(r => get(r, c) === v); return b }, neq: (c: string, v: any) => { filters.push(r => get(r, c) !== v); return b },
      in: (c: string, v: any[]) => { filters.push(r => v.includes(get(r, c))); return b },
      not: (c: string, _o: string, v: any) => { filters.push(r => get(r, c) !== v && get(r, c) !== undefined); return b },
      order: () => b, limit: (x: number) => { max = x; return b },
      maybeSingle: () => { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }) },
      single: () => { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }) },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }
  const storage = { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null } } }) }
  return { db: { from, storage } as any, tables, uploads }
}

const OWNER = 'owner-1'
const good = (over: Row = {}) => ({
  id: 'opp1', owner_id: OWNER, title: 'Los pulpos tienen tres corazones', status: 'discovered', created_at: '2026-10-01',
  observed_metrics: { similar_views: [9000, 12000, 15000, 20000, 30000, 8000], niche_median_views: 5000 }, calculated_metrics: { trend: 'rising' }, evidence: [], ...over,
})
const SOURCES = [
  { url: 'https://es.wikipedia.org/wiki/Octopoda', domain: 'wikipedia.org', quote: 'q'.repeat(30), verified_at: 'x' },
  { url: 'https://www.britannica.com/animal/octopus', domain: 'britannica.com', quote: 'q'.repeat(30), verified_at: 'x' },
]
const script = {
  hook: 'El pulpo tiene tres corazones', key_datum: 'tres corazones', category: 'mar', title: 'El pulpo tiene tres corazones', description: 'Curiosidad #Shorts', tags: ['pulpo'],
  beats: [1, 2, 3, 4, 5].map(i => ({ text: `Dos bombean sangre a las branquias y uno al resto del cuerpo del animal marino ${i}`, visual_prompt: 'cinematic octopus underwater, centered' })),
}

function mockLLM(over: { facts?: any; script?: any } = {}) {
  vi.mocked(generateJson).mockImplementation(async (prompt: string) => {
    if (prompt.includes('ENCAJE')) return { fits: [{ index: 0, fit: 9, category: 'mar' }] } as any
    if (prompt.includes('UN dato concreto')) return (over.facts ?? { claim: 'Los pulpos tienen tres corazones', key_datum: 'tres corazones', candidate_urls: ['u1', 'u2'] }) as any
    return (over.script ?? script) as any
  })
}

const env = { GEMINI_API_KEY: 'k', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't', YOUTUBE_API_KEY: 'y', SUPABASE_SERVICE_ROLE_KEY: 's' }
beforeEach(() => {
  vi.resetAllMocks()
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  vi.mocked(verifySources).mockResolvedValue({ sources: SOURCES, checked: [] })
  vi.mocked(synthesizeSpeech).mockResolvedValue({ wav: new Uint8Array(100), seconds: 32, sampleRate: 24000, pauses: [] })
  vi.mocked(generateImage).mockResolvedValue({ bytes: new Uint8Array(20000), mime: 'image/jpeg' })
  mockLLM()
})
const seed = (o: Row[] = [good()]) => ({ automations: [{ id: 'a1', owner_id: OWNER, kind: 'shorts_factory', enabled: true, config: { factory: {} } }], opportunities: o })

describe('pipeline de la Fábrica de Shorts', () => {
  it('se bloquea y nombra lo que falta si no hay credenciales', async () => {
    delete process.env.CLOUDFLARE_API_TOKEN
    const { db, tables } = fakeDb(seed())
    const r = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(r).toEqual({ status: 'blocked', missing: ['CLOUDFLARE_API_TOKEN'] })
    expect(tables.shorts ?? []).toHaveLength(0)
  })

  it('camino feliz: deja un Short listo para aprobar con fuentes, controles y assets', async () => {
    const { db, tables, uploads } = fakeDb(seed())
    const r = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(r.status).toBe('ready')
    const s = tables.shorts[0]
    expect(s.status).toBe('ready_for_approval')
    expect(s.facts.sources).toHaveLength(2)
    expect(s.quality.all_pass).toBe(true)
    expect(s.manifest.scenes).toHaveLength(5)
    expect(s.manifest.scenes[0].captions.length).toBeGreaterThan(0)
    expect(s.manifest.hook.key_datum).toBe('tres corazones')
    expect(s.manifest.music.kind).toBe('procedural')
    expect(s.topic_selection.score.interest.basis).toBe('observed')
    expect(s.topic_selection.score.fit.basis).toBe('inferred')
    expect(s.synthetic_content ?? true).toBe(true)
    expect(uploads).toHaveLength(6) // 5 imágenes + voz
    expect(uploads.every(p => p.startsWith(`${OWNER}/`))).toBe(true)
    expect(tables.opportunities[0].status).toBe('experiment_approved')
  })

  it('ancla los cortes de escena a las pausas reales de la voz', async () => {
    vi.mocked(synthesizeSpeech).mockResolvedValue({ wav: new Uint8Array(100), seconds: 32, sampleRate: 24000, pauses: [8.0, 14.0, 20.2, 26.1] })
    const { db, tables } = fakeDb(seed())
    await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    const m = tables.shorts[0].manifest
    const ends = m.scenes.slice(0, -1).map((x: any) => x.end)
    expect(ends.every((e: number) => [8.0, 14.0, 20.2, 26.1].some(p => Math.abs(p - e) < 0.01))).toBe(true)
    expect(m.timing_basis).toBe('scene_cuts_snapped_to_voice_pauses')
    expect(m.scenes[0].start).toBe(0)
    expect(m.scenes.at(-1).end).toBeCloseTo(32.8, 1)
    expect(m.scenes.every((x: any, i: number) => i === 0 || Math.abs(x.start - m.scenes[i - 1].end) < 1e-6)).toBe(true)
  })

  it('no crea un segundo Short el mismo día', async () => {
    const { db } = fakeDb(seed())
    await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    const again = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(again.status).toBe('exists')
  })

  it('descarta sin interés comprobado (vídeos similares por debajo de la mediana del nicho)', async () => {
    const weak = good({ observed_metrics: { similar_views: [100, 200, 300, 250, 150], niche_median_views: 5000 } })
    const { db, tables } = fakeDb(seed([weak]))
    const r = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(r).toMatchObject({ status: 'discarded', reason: 'sin_interes_comprobado' })
    expect(tables.shorts[0].status).toBe('discarded')
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('descarta el tema (y la oportunidad) si no logra 2 fuentes fiables', async () => {
    vi.mocked(verifySources).mockResolvedValue({ sources: SOURCES.slice(0, 1), checked: [] })
    const { db, tables } = fakeDb(seed())
    const r = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(r).toMatchObject({ status: 'discarded', reason: 'sin_dos_fuentes_fiables' })
    expect(tables.opportunities[0].status).toBe('discarded')
    expect(synthesizeSpeech).not.toHaveBeenCalled()
  })

  it('descarta si el hook no contiene el dato principal', async () => {
    mockLLM({ script: { ...script, hook: 'Un animal muy curioso' } })
    const { db } = fakeDb(seed())
    const r = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(r).toMatchObject({ status: 'discarded', reason: 'guion_bajo_calidad_minima' })
    expect(synthesizeSpeech).not.toHaveBeenCalled()
  })

  it('descarta si la voz gratuita no cumple duración/hook (no se paga otra voz)', async () => {
    vi.mocked(synthesizeSpeech).mockResolvedValue({ wav: new Uint8Array(100), seconds: 75, sampleRate: 24000, pauses: [] })
    const { db } = fakeDb(seed())
    const r = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(r).toMatchObject({ status: 'discarded', reason: 'audio_bajo_calidad_minima' })
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('si se agota la cuota gratuita de imágenes, hoy no hay Short', async () => {
    vi.mocked(generateImage).mockRejectedValue(new FreeTierExhausted('neuronas'))
    const { db, tables } = fakeDb(seed())
    const r = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(r).toMatchObject({ status: 'discarded', reason: 'cuota_gratuita_agotada' })
    expect(tables.shorts[0].status).toBe('discarded')
  })

  it('no repite temas ya usados', async () => {
    const used = { id: 's0', owner_id: OWNER, status: 'uploaded_private', run_date: '2026-10-01', topic: 'Los pulpos tienen tres corazones', topic_key: 'corazones pulpos tres tienen' }
    const { db } = fakeDb({ ...seed(), shorts: [used] })
    const r = await prepareDailyShort(db, OWNER, { today: '2026-10-09' })
    expect(r).toMatchObject({ status: 'discarded', reason: 'sin_interes_comprobado' })
  })
})
