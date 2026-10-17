import { describe, expect, it } from 'vitest'
import { compareSnapshots, type SnapshotItem } from '@/lib/radar'
import { recordTrendSnapshot } from '@/lib/radar-history'

const item = (videoId: string, rank: number, views: number | null): SnapshotItem => ({ videoId, title: videoId, channelTitle: 'c', rank, views })

describe('trend comparison', () => {
  it('has no movements on the first snapshot', () => {
    expect(compareSnapshots([item('a', 1, 10)], null, null)).toEqual({ previousAt: null, movements: {}, dropped: [] })
  })

  it('detects new entries, rank moves, views gained and dropped videos', () => {
    const prev = [item('a', 1, 100), item('b', 2, 50), item('gone', 3, 5)]
    const now = [item('b', 1, 80), item('a', 2, 150), item('new', 3, 1)]
    const c = compareSnapshots(now, prev, '2026-09-25T07:00:00Z')
    expect(c.movements.b).toMatchObject({ status: 'up', rankChange: 1, viewsGained: 30 })
    expect(c.movements.a).toMatchObject({ status: 'down', rankChange: -1, viewsGained: 50 })
    expect(c.movements.new).toMatchObject({ status: 'new', rankChange: null })
    expect(c.dropped.map(d => d.videoId)).toEqual(['gone'])
  })
})

describe('recordTrendSnapshot', () => {
  it('stores ranked items for the owner and compares with the previous snapshot of the same category', async () => {
    const calls: Array<[string, ...unknown[]]> = []
    let inserted: any = null
    const db: any = { from: () => {
      const chain: any = new Proxy({}, { get(_, p) {
        if (p === 'then') return (res: any) => Promise.resolve({ data: [{ items: [item('v1', 2, 10)], fetched_at: 'T0' }], error: null }).then(res)
        if (p === 'insert') return (row: unknown) => { inserted = row; return Promise.resolve({ error: null }) }
        return (...args: unknown[]) => { calls.push([String(p), ...args]); return chain }
      } })
      return chain
    } }
    const videos = [{ videoId: 'v1', title: 'T1', channelTitle: 'C', observed: { views: 30 } }, { videoId: 'v2', title: 'T2', channelTitle: 'C', observed: { views: null } }] as any
    const c = await recordTrendSnapshot(db, { ownerId: 'u1', region: 'ES', categoryId: null, source: 'radar', videos })
    expect(calls).toContainEqual(['eq', 'owner_id', 'u1'])
    expect(calls).toContainEqual(['is', 'category_id', null])
    expect(inserted).toMatchObject({ owner_id: 'u1', region: 'ES', category_id: null, source: 'radar' })
    expect(inserted.items.map((i: SnapshotItem) => [i.videoId, i.rank])).toEqual([['v1', 1], ['v2', 2]])
    expect(c.movements.v1).toMatchObject({ status: 'up', rankChange: 1, viewsGained: 20 })
    expect(c.movements.v2.status).toBe('new')
  })
})
