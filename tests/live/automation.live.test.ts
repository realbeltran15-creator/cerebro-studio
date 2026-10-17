/**
 * Live trend-watch automation with real YouTube data (read-only) and an in-memory database double:
 * nothing is written anywhere. Opt-in: LIVE_YOUTUBE=1 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca> npx vitest run tests/live/automation
 */
import { describe, expect, it } from 'vitest'
import { executeAutomation, type Automation } from '@/lib/automations/run'
import { trendingYouTubeVideos } from '@/lib/providers/youtube-data'

const live = process.env.LIVE_YOUTUBE === '1'
if (live && !process.env.YOUTUBE_API_KEY?.trim()) process.env.YOUTUBE_API_KEY = 'proxy-injected-placeholder'

function fakeDb(tables: Record<string, unknown[]>) {
  const writes: Array<{ op: string; table: string; payload: any }> = []
  const db = { from(table: string) {
    const q: { op: string; payload: any; single: boolean } = { op: 'select', payload: null, single: false }
    const chain: any = new Proxy({}, { get(_, p) {
      if (p === 'then') return (res: any) => {
        if (q.op === 'insert') { writes.push({ op: 'insert', table, payload: q.payload }); return Promise.resolve({ data: q.single ? { id: 'run1' } : null, error: null }).then(res) }
        if (q.op === 'update') { writes.push({ op: 'update', table, payload: q.payload }); return Promise.resolve({ data: null, error: null }).then(res) }
        return Promise.resolve({ data: tables[table] ?? [], error: null }).then(res)
      }
      if (p === 'insert' || p === 'update') return (payload: unknown) => { q.op = p; q.payload = payload; return chain }
      if (p === 'single' || p === 'maybeSingle') return () => { q.single = true; return chain }
      return () => chain
    } })
    return chain
  } } as any
  return { db, writes }
}
const automation = (config: Record<string, unknown>): Automation => ({ id: 'a1', owner_id: 'u1', kind: 'trend_watch', name: 'Vigía real', enabled: true, schedule: 'daily', config, last_run_at: null } as Automation)

/** A real keyword: the longest word of the first trending title, so the test works whatever is trending today. */
async function realKeyword() {
  const first = (await trendingYouTubeVideos({ regionCode: 'ES' }))[0]
  const word = first.title.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4).sort((a, b) => b.length - a.length)[0]
  return word
}

describe.skipIf(!live)('trend watch with real YouTube trending (no writes anywhere)', () => {
  it('matches real titles, builds opportunities with observed/calculated metrics and evidence', async () => {
    const { db, writes } = fakeDb({})
    const kw = await realKeyword()
    const r = await executeAutomation(db, automation({ region: 'ES', keywords: [kw], autoSave: true }), 'manual')
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (!r.ok) return
    const s = r.summary as { checked: number; matched: number; saved: number; duplicates: number }
    expect(s.checked).toBeGreaterThan(0)
    expect(s.matched).toBeGreaterThan(0)
    expect(s.saved).toBe(s.matched)
    const rows = writes.find(w => w.op === 'insert' && w.table === 'opportunities')!.payload as any[]
    expect(new Set(rows.map(o => o.source_id)).size).toBe(rows.length)
    expect(rows[0]).toMatchObject({ owner_id: 'u1', source_platform: 'youtube', status: 'discovered' })
    expect(rows[0].observed_metrics.source).toBe('youtube_data_api')
    expect(rows[0].evidence[0].url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/)
    expect(JSON.stringify(rows)).not.toMatch(/AIza|key=/)
  }, 90000)

  it('skips what is already saved (de-duplication)', async () => {
    const first = fakeDb({})
    const kw = await realKeyword()
    await executeAutomation(first.db, automation({ region: 'ES', keywords: [kw], autoSave: true }), 'manual')
    const known = (first.writes.find(w => w.table === 'opportunities')!.payload as any[]).map(o => ({ source_id: o.source_id }))
    const second = fakeDb({ opportunities: known })
    const r = await executeAutomation(second.db, automation({ region: 'ES', keywords: [kw], autoSave: true }), 'manual')
    expect(r.ok && (r.summary as { duplicates: number }).duplicates).toBeGreaterThan(0)
  }, 120000)
})
