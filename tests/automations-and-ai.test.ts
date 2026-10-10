import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAutomation, matchKeywords, type Automation } from '@/lib/automations/run'
import { proposeScript } from '@/lib/providers/openai-text'
import { ElevenLabsVoiceProvider, generateSoundEffect } from '@/lib/providers/elevenlabs'

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
afterEach(() => vi.unstubAllGlobals())

// Records writes; select queries return the table's fixture rows.
function fakeDb(tables: Record<string, unknown[]>) {
  const writes: Array<{ op: string; table: string; payload: any; filters: unknown[] }> = []
  const db = { from(table: string) {
    const q: { op: string; payload: any; filters: unknown[]; single: boolean } = { op: 'select', payload: null, filters: [], single: false }
    const chain: any = new Proxy({}, { get(_, p) {
      if (p === 'then') return (res: any) => {
        if (q.op === 'insert') { writes.push({ op: 'insert', table, payload: q.payload, filters: [] }); return Promise.resolve({ data: q.single ? { id: 'run1' } : null, error: null }).then(res) }
        if (q.op === 'update') { writes.push({ op: 'update', table, payload: q.payload, filters: q.filters }); return Promise.resolve({ data: null, error: null }).then(res) }
        return Promise.resolve({ data: tables[table] ?? [], error: null }).then(res)
      }
      if (p === 'insert' || p === 'update') return (payload: unknown) => { q.op = p; q.payload = payload; return chain }
      if (p === 'single' || p === 'maybeSingle') return () => { q.single = true; return chain }
      return (...args: unknown[]) => { q.filters.push([p, ...args]); return chain }
    } })
    return chain
  } } as any
  return { db, writes }
}

const automation = (over: Partial<Automation>): Automation => ({ id: 'a1', owner_id: 'u1', kind: 'trend_watch', name: 'Vigía', enabled: true, schedule: 'daily', config: {}, last_run_at: null, ...over })

describe('automations', () => {
  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('chart=mostPopular')) return json({ items: [
        { id: 'v1', snippet: { title: 'Rescate: SUPERVIVENCIA extrema', channelId: 'c' }, statistics: { viewCount: '900' } },
        { id: 'v2', snippet: { title: 'Receta de tortilla', channelId: 'c' }, statistics: { viewCount: '5' } },
        { id: 'v3', snippet: { title: 'Supervivéncia en el desierto', channelId: 'c' }, statistics: { viewCount: '7' } },
      ] })
      if (url.includes('/videos?')) return json({ items: [{ id: 'abcdefghijk', snippet: { title: 'Old', channelId: 'c' }, statistics: { viewCount: '1500' } }] })
      if (url.includes('/channels?')) return json({ items: [{ id: 'c', statistics: { subscriberCount: '100' } }] })
      throw new Error(`unexpected ${url}`)
    }))
  })

  it('matches keywords ignoring case and accents', () => {
    const videos = [{ title: 'SUPERVIVÉNCIA' }, { title: 'otra cosa' }] as any
    expect(matchKeywords(videos, ['supervivencia'])).toHaveLength(1)
    expect(matchKeywords(videos, [])).toHaveLength(0)
  })

  it('saves new trend matches for the owner and skips duplicates', async () => {
    const { db, writes } = fakeDb({ opportunities: [{ source_id: 'https://www.youtube.com/watch?v=v3' }] })
    const r = await executeAutomation(db, automation({ config: { region: 'ES', keywords: ['supervivencia'], autoSave: true } }), 'manual')
    expect(r.ok).toBe(true)
    expect(r.ok && r.summary).toMatchObject({ checked: 3, matched: 2, saved: 1, duplicates: 1 })
    const inserted = writes.find(w => w.op === 'insert' && w.table === 'opportunities')!.payload
    expect(inserted.map((o: any) => [o.source_id, o.owner_id, o.status])).toEqual([['https://www.youtube.com/watch?v=v1', 'u1', 'discovered']])
  })

  it('refreshes opportunity metrics with history, growth and an owner filter', async () => {
    const { db, writes } = fakeDb({ opportunities: [{ id: 'o1', source_id: 'https://www.youtube.com/watch?v=abcdefghijk', observed_metrics: { views: 1000, fetchedAt: new Date(Date.now() - 2 * 86400000).toISOString() }, calculated_metrics: {} }] })
    const r = await executeAutomation(db, automation({ id: 'a2', kind: 'opportunity_refresh' }), 'schedule')
    expect(r.ok).toBe(true)
    const upd = writes.find(w => w.op === 'update' && w.table === 'opportunities')!
    expect(upd.payload.observed_metrics.history.map((h: any) => h.views)).toEqual([1000])
    expect(upd.payload.calculated_metrics.viewsGainedSinceLastCheck).toBe(500)
    expect(upd.payload.calculated_metrics.viewsPerDaySinceLastCheck).toBe(250)
    expect(upd.filters).toContainEqual(['eq', 'owner_id', 'u1'])
    expect(writes.filter(w => w.table === 'automation_runs' && w.op === 'update').map(w => w.payload.status)).toEqual(['succeeded'])
  })
})

describe('script assistance', () => {
  it('drops sources that are not in the project research', async () => {
    process.env.OPENAI_API_KEY = 'o'
    vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: JSON.stringify({
      hooks: ['h1'], cta: 'c', notes: [],
      sections: [{ heading: 'S', basis: 'verified_fact', text: 't', sources: ['https://ok', 'https://invented'] }, { heading: 'X', basis: 'bogus', text: 'y', sources: [] }],
    }) } }] })))
    const p = await proposeScript({ mode: 'draft', projectName: 'P', projectDescription: null, title: 'T', idea: null, brief: null, hook: null, cta: null, sections: [], research: [], allowedSources: ['https://ok'] }, 'rid')
    expect(p.sections.map(s => [s.basis, s.sources])).toEqual([['verified_fact', ['https://ok']], ['reconstruction', []]])
    expect(p.notes[0]).toContain('Se descartaron 1 fuente(s)')
  })
})

describe('ElevenLabs', () => {
  it('falls back to the default voice and clamps SFX duration', async () => {
    process.env.ELEVENLABS_API_KEY = 'k'; process.env.ELEVENLABS_VOICE_ID = 'AAAAAAAAAAAAAAAAAAAA'
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => { seen.push(`${String(input)} ${init?.body}`); return new Response(new Uint8Array([1, 2, 3])) }))
    const ctx = { ownerId: 'u', projectId: 'p', requestId: 'r' }
    await new ElevenLabsVoiceProvider().synthesize(ctx, 'hola', 'not-a-voice')
    const sfx = await generateSoundEffect(ctx, 'viento', 60)
    expect(seen[0]).toContain('/text-to-speech/AAAAAAAAAAAAAAAAAAAA')
    expect(seen[1]).toContain('"duration_seconds":30') // API limit is 30 s (eleven_text_to_sound_v2)
    expect(sfx.uri.startsWith('data:audio/mpeg;base64,')).toBe(true)
  })
})
