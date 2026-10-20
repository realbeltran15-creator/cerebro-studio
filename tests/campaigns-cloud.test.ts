import { describe, expect, it } from 'vitest'
import { changedSince, fromRow, isUuid, mergeCampaigns, tableMissing, toRow, withUuidIds, loadSynced, saveSynced, SYNCED_KEY } from '@/lib/campaigns/cloud'
import { create } from '@/lib/campaigns/store'
import type { SavedCampaign } from '@/lib/campaigns/types'

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const c = (id: string, updatedAt: string, name = id): SavedCampaign => ({ ...create({ ...create().brief, name }, '2026-10-01T00:00:00.000Z'), id, updatedAt })

describe('campaigns cloud sync', () => {
  it('new campaigns get uuid ids', () => { expect(isUuid(create().id)).toBe(true) })

  it('converts legacy cmp_ ids once and keeps uuid ids', () => {
    let n = 10
    const { list, renamed } = withUuidIds([c('cmp_abc', '2026-10-02'), c(U(1), '2026-10-02')], () => U(n++))
    expect(list.map(x => x.id)).toEqual([U(10), U(1)])
    expect(renamed).toEqual({ cmp_abc: U(10) })
  })

  it('merges by id: newer copy wins and only local-newer or local-only campaigns are uploaded', () => {
    const local = [c(U(1), '2026-10-05T00:00:00Z', 'local newer'), c(U(2), '2026-10-01T00:00:00Z', 'local older'), c(U(3), '2026-10-03T00:00:00Z', 'only here')]
    const remote = [c(U(1), '2026-10-04T00:00:00Z', 'remote'), c(U(2), '2026-10-06T00:00:00Z', 'remote newer'), c(U(4), '2026-10-02T00:00:00Z', 'only remote')]
    const { list, upload } = mergeCampaigns(local, remote, new Set())
    expect(list.map(x => x.brief.name)).toEqual(['remote newer', 'local newer', 'only here', 'only remote'])
    expect(upload.map(x => x.id).sort()).toEqual([U(1), U(3)])
  })

  it('does not resurrect a campaign deleted on another device', () => {
    const { list, upload } = mergeCampaigns([c(U(1), '2026-10-05T00:00:00Z')], [], new Set([U(1)]))
    expect(list).toEqual([]); expect(upload).toEqual([])
  })

  it('maps to a table row: owner, name, and project only when it is one of the owner projects', () => {
    const x = c(U(1), '2026-10-05T00:00:00Z', 'Mi campaña'); x.brief.projectId = U(9)
    expect(toRow(x, 'owner', new Set([U(9)]))).toMatchObject({ id: U(1), owner_id: 'owner', name: 'Mi campaña', project_id: U(9), status: 'borrador' })
    expect(toRow(x, 'owner', new Set()).project_id).toBeNull()
    x.brief.projectId = 'not-a-uuid'
    expect(toRow(x, 'owner', new Set(['not-a-uuid'])).project_id).toBeNull()
  })

  it('reads rows defensively (sanitised brief, unknown status, bad id)', () => {
    const r = fromRow({ id: U(1), name: 'x', status: 'publicada' as never, brief: { name: 'N', totalBudget: -5, platforms: ['meta_ads', 'evil'] }, notes: 'n', project_id: null, created_at: 'a', updated_at: 'b' })
    expect(r?.status).toBe('borrador'); expect(r?.brief.totalBudget).toBeNull(); expect(r?.brief.platforms).toEqual(['meta_ads'])
    expect(fromRow({ id: 'cmp_x', name: '', status: 'lista', brief: {}, notes: '', project_id: null, created_at: '', updated_at: '' })).toBeNull()
  })

  it('detects changes since the last save', () => {
    const a = c(U(1), 't1'), b = c(U(2), 't2')
    expect(changedSince([a, b], new Map([[U(1), 't1'], [U(2), 't0']])).map(x => x.id)).toEqual([U(2)])
  })

  it('recognises a missing table (migration not applied)', () => {
    expect(tableMissing({ code: 'PGRST205', message: "Could not find the table 'public.campaigns' in the schema cache" })).toBe(true)
    expect(tableMissing({ code: '42P01' })).toBe(true)
    expect(tableMissing({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(tableMissing(null)).toBe(false)
  })

  it('remembers synced ids and ignores junk', () => {
    const m = new Map<string, string>(); const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    saveSynced(s, [U(1)]); expect([...loadSynced(s)]).toEqual([U(1)])
    m.set(SYNCED_KEY, '{bad'); expect(loadSynced(s).size).toBe(0)
  })
})
