import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { CounterUnavailableError, MemoryCacheStore, SupabaseCacheStore, isMissingTable, openStore, quotaDayKey, quotaDayStart } from '@/lib/research/cache'
import { addUnits, effectiveUsage, emptyLedger, ledgerHeader, parseLedger } from '@/lib/research/ledger'
import { BudgetError, isQuotaExceeded, quotaLimits, readUsage, reserveSpend } from '@/lib/research/quota'
import { parseLedgerHeader, quotaErrorResponse, syncBrowserLedger } from '@/lib/research/guard'
import { getTopicAnalysis } from '@/lib/research/sample'
import { YouTubeApiError, type YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { QuotaNote } from '@/app/market-intelligence/insight-panels'

// SIMULATED: no YouTube call and no database; these check the counters, not Google's real behaviour.
const NOW = Date.parse('2026-10-13T12:00:00Z')
let n = 0
const mem = () => new MemoryCacheStore(`q-${++n}-${Math.random()}`)
const okSearch = vi.fn(async () => ({ videos: Array.from({ length: 6 }, (_, i): YouTubeVideoResult => ({ videoId: `q${++n}`, url: '', title: `tema video ${i}`, channelId: `c${n}`, channelTitle: 'C', publishedAt: new Date(NOW - 5 * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: 'es', observed: { views: 1000, likes: 1, comments: 1, durationSeconds: 600, channelSubscribers: 5000, fetchedAt: '' }, calculated: { viewsPerDay: 200, viewsToSubscribers: 0.2, engagementRate: 1 } } as YouTubeVideoResult)), approxTotal: 5 }))

describe('1. the counter does not reset because of milliseconds', () => {
  it('the quota day boundary is the same for every instant of the same second and of the same day', () => {
    const base = Date.parse('2026-10-13T15:30:10.000Z')
    for (const ms of [0, 1, 123, 500, 999]) expect(quotaDayStart(base + ms)).toBe(quotaDayStart(base))
    expect(quotaDayStart(base) % 1000).toBe(0)
    expect(quotaDayStart(base + 3 * 3600_000 + 777)).toBe(quotaDayStart(base))
  })
  it('a ledger written at one millisecond and read at another keeps its units; only a new Pacific day empties it', () => {
    let l = emptyLedger(NOW + 111); l = addUnits(l, 204, NOW + 222, 2); l = addUnits(l, 102, NOW + 999, 1)
    expect(l).toMatchObject({ units: 306, searches: 3 })
    expect(parseLedger(JSON.stringify(l), NOW + 456).units).toBe(306)
    expect(parseLedger(JSON.stringify(l), NOW + 86400000 + 5).units).toBe(0)
    expect(effectiveUsage(null, l, 6000, NOW + 7).usedToday).toBe(306)
  })
  it('the server figure of the same day, taken at a different millisecond, is not discarded', () => {
    const server = { usedToday: 5000, cap: 6000, persistent: true, day: quotaDayKey(NOW + 31) }
    expect(effectiveUsage(server, emptyLedger(NOW), 6000, NOW + 900).remaining).toBe(1000)
  })
})

describe('2. two independent daily limits: quota units AND search.list calls', () => {
  const limits = { ...quotaLimits({}), unitCap: 6000, searchCap: 4 }
  it('the search limit stops a day that still has plenty of units, and does not leave a reservation behind', async () => {
    const store = mem()
    await reserveSpend(store, 'a', 102, 2, NOW, limits); await reserveSpend(store, 'b', 102, 2, NOW, limits)
    await expect(reserveSpend(store, 'c', 102, 1, NOW, limits)).rejects.toMatchObject({ limit: 'searches' })
    expect(await store.unitsSince(NOW - 1000)).toBe(204); expect(await store.searchesSince(NOW - 1000)).toBe(4)
  })
  it('the unit limit stops a day that still has searches left (neither implies the other)', async () => {
    const store = mem(), big = { ...limits, unitCap: 300, searchCap: 100 }
    await reserveSpend(store, 'a', 204, 2, NOW, big)
    await expect(reserveSpend(store, 'b', 204, 2, NOW, big)).rejects.toMatchObject({ limit: 'units' })
    await reserveSpend(store, 'chart', 2, 0, NOW, big)   // a chart costs units but no search
  })
  it('parallel reservations from several instances cannot pass either limit', async () => {
    const store = mem()
    const res = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => reserveSpend(store, `p${i}`, 10, 2, NOW, limits)))
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(2)
    expect(res.filter(r => r.status === 'rejected' && r.reason instanceof BudgetError)).toHaveLength(6)
  })
  it('a settled reservation counts what was really spent, in both limits', async () => {
    const store = mem(), s = await reserveSpend(store, 'a', 204, 2, NOW, limits)
    await s.settle(102, 1)
    expect(await store.unitsSince(NOW - 1000)).toBe(102); expect(await store.searchesSince(NOW - 1000)).toBe(1)
  })
  it('a topic analysis needs 2 searches, a growth measurement 1; the app refuses before calling YouTube when searches are short', async () => {
    const store = mem(); okSearch.mockClear()
    await store.put('v1|usage|x', 'usage', {}, 0, 1e9, NOW, 59)    // 59 of the default 60 searches already used
    await expect(getTopicAnalysis({ topic: 'tema nuevo', region: null, language: null }, { store, search: okSearch, owner: 'q1', now: () => NOW })).rejects.toMatchObject({ limit: 'searches' })
    expect(okSearch).not.toHaveBeenCalled()
  })
  it('the Supabase store enforces both limits through the database function and through the non-atomic fallback', async () => {
    const rows: Array<Record<string, unknown>> = []
    const chain = () => { let f: Array<(r: Record<string, unknown>) => boolean> = []; const api = { select: () => api, eq: (k: string, v: unknown) => { f = [...f, r => r[k] === v]; return api }, gte: (k: string, v: string) => { f = [...f, r => String(r[k]) >= v]; return api }, limit: async () => ({ data: rows.filter(r => f.every(x => x(r))), error: null }), upsert: async (row: Record<string, unknown>) => { rows.push(row); return { error: null } }, then: (res: (x: unknown) => void) => res({ data: rows.filter(r => f.every(x => x(r))), error: null }) }; return api }
    const store = new SupabaseCacheStore({ from: () => chain() } as never, 'u1')   // no rpc: fallback path
    expect((await store.reserve('k1', 100, 6000, 600000, NOW, { need: 2, cap: 3 })).ok).toBe(true)
    const r2 = await store.reserve('k2', 100, 6000, 600000, NOW, { need: 2, cap: 3 })
    expect(r2).toMatchObject({ ok: false, reason: 'search_budget', usedSearches: 2 })
  })
  it('the limits respect what the owner declares other applications use, and never exceed the official ones', () => {
    expect(quotaLimits({})).toMatchObject({ unitCap: 6000, searchCap: 60 })
    expect(quotaLimits({ YOUTUBE_EXTERNAL_RESERVED_UNITS: '5000', YOUTUBE_EXTERNAL_RESERVED_SEARCHES: '70' })).toMatchObject({ unitCap: 5000, searchCap: 30 })
    expect(quotaLimits({ RESEARCH_DAILY_UNIT_CAP: '9000', RESEARCH_DAILY_SEARCH_CAP: '90', YOUTUBE_EXTERNAL_RESERVED_UNITS: '4000' })).toMatchObject({ unitCap: 6000, searchCap: 90 })
    expect(quotaLimits({ RESEARCH_DAILY_UNIT_CAP: '99999', RESEARCH_DAILY_SEARCH_CAP: '9999' })).toMatchObject({ unitCap: 6000, searchCap: 60 })
  })
})

describe('3. other applications sharing the Google Cloud project', () => {
  it('when YouTube says the quota is spent, both limits lock for the rest of the quota day, and open again the next Pacific day', async () => {
    const store = mem()
    const exhausted = vi.fn(async () => { throw new YouTubeApiError('Se ha agotado la cuota', 403, 'quotaExceeded') })
    expect(isQuotaExceeded(new YouTubeApiError('x', 403, 'quotaExceeded'))).toBe(true); expect(isQuotaExceeded(new YouTubeApiError('x', 403, 'forbidden'))).toBe(false)
    await expect(getTopicAnalysis({ topic: 'tema uno', region: null, language: null }, { store, search: exhausted, owner: 'q2', now: () => NOW })).rejects.toBeInstanceOf(YouTubeApiError)
    okSearch.mockClear()
    await expect(getTopicAnalysis({ topic: 'tema dos', region: null, language: null }, { store, search: okSearch, owner: 'q2', now: () => NOW + 3600_000 })).rejects.toMatchObject({ limit: 'exhausted' })
    expect(okSearch).not.toHaveBeenCalled()
    expect((await readUsage(store, quotaLimits({}), NOW + 3600_000)).exhausted).toBe(true)
    const nextDay = quotaDayStart(NOW) + 86400000 + 60_000
    await getTopicAnalysis({ topic: 'tema dos', region: null, language: null }, { store, search: okSearch, owner: 'q2', now: () => nextDay }); expect(okSearch).toHaveBeenCalled()
  })
  it('the usage is never reported as verified, and the screen says it is only what this app counted', async () => {
    const u = await readUsage(mem(), quotaLimits({}), NOW)
    expect(u.verified).toBe(false); expect(effectiveUsage(null, emptyLedger(NOW), 6000, NOW).verified).toBe(false)
    const html = renderToStaticMarkup(createElement(QuotaNote, { usage: { usedToday: 204, cap: 6000, searchesToday: 2, searchCap: 60, persistent: true, exhausted: false } }))
    expect(html).toMatch(/no la cifra oficial/); expect(html).toMatch(/otras aplicaciones/); expect(html).not.toMatch(/disponible|confirmad/i)
    expect(renderToStaticMarkup(createElement(QuotaNote, { usage: { usedToday: 0, cap: 6000, searchesToday: 0, searchCap: 60, persistent: true, exhausted: true } }))).toMatch(/cuota de hoy está agotada/)
  })
})

describe('4. a failing counter never opens unlimited searches', () => {
  const db = (error: { code?: string; message?: string } | null) => ({ from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error }) }) }) }) })
  it('a transient database error refuses (fail closed) instead of falling back to an empty memory counter', async () => {
    await expect(openStore(db({ code: '08006', message: 'connection failure' }) as never, 'u')).rejects.toBeInstanceOf(CounterUnavailableError)
    await expect(openStore(db({ code: '57014', message: 'canceling statement due to statement timeout' }) as never, 'u')).rejects.toBeInstanceOf(CounterUnavailableError)
  })
  it('only a missing table (migration not applied) falls back to memory', async () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true); expect(isMissingTable({ code: 'PGRST205' })).toBe(true); expect(isMissingTable({ code: '08006' })).toBe(false)
    expect(await openStore(db({ code: '42P01', message: 'relation "public.research_cache" does not exist' }) as never, 'u')).toBeInstanceOf(MemoryCacheStore)
  })
  it('a store whose reservation fails stops the analysis before any call to YouTube', async () => {
    const broken = Object.assign(mem(), { reserve: async () => { throw new CounterUnavailableError() } })
    okSearch.mockClear()
    await expect(getTopicAnalysis({ topic: 'tema roto', region: null, language: null }, { store: broken, search: okSearch, owner: 'q3', now: () => NOW })).rejects.toBeInstanceOf(CounterUnavailableError)
    expect(okSearch).not.toHaveBeenCalled()
  })
  it('the HTTP answer for a broken counter is 503, and for an exhausted budget 429', () => {
    expect(quotaErrorResponse(new CounterUnavailableError())?.status).toBe(503)
    expect(quotaErrorResponse(new BudgetError('x', 1, 2, 'searches'))?.status).toBe(429)
    expect(quotaErrorResponse(new Error('other'))).toBeNull()
  })
  it('without a persistent counter a cold server cannot forget what the browser already spent: the browser tally can only raise the figure', async () => {
    const store = mem(), header = ledgerHeader({ day: quotaDayKey(NOW), units: 5900, searches: 58 }, NOW)
    expect(parseLedgerHeader(header, NOW)).toEqual({ units: 5900, searches: 58 })
    expect(parseLedgerHeader('0,0,2020-01-01', NOW)).toBeNull(); expect(parseLedgerHeader('garbage', NOW)).toBeNull()
    await syncBrowserLedger(store, header, NOW)
    expect(await store.unitsSince(quotaDayStart(NOW))).toBe(5900); expect(await store.searchesSince(quotaDayStart(NOW))).toBe(58)
    await syncBrowserLedger(store, ledgerHeader({ day: quotaDayKey(NOW), units: 100, searches: 1 }, NOW), NOW)   // a lower claim changes nothing
    expect(await store.unitsSince(quotaDayStart(NOW))).toBe(5900)
    await expect(reserveSpend(store, 'x', 204, 2, NOW, quotaLimits({}))).rejects.toBeInstanceOf(BudgetError)
  })
})
