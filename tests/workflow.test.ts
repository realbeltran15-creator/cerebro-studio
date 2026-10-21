import { describe, expect, it } from 'vitest'
import { EMPTY_STORE, parseStore, projectCost, projectWorkflow, recordTransitions, setApproval, setCostLimit, type WfData } from '@/lib/workflow'

const P = { id: 'p1', name: 'Proyecto', description: null }
const empty: WfData = { scripts: [], storyboards: [], scenes: [], assets: [], renders: [], publications: [] }
const gen = (id: string, extra: Record<string, unknown> = {}, type = 'image', license = 'generated') => ({ id, project_id: 'p1', asset_type: type, license_status: license, provenance: extra })

describe('production workflow', () => {
  it('a new project starts with every step pending and the idea as next action', () => {
    const f = projectWorkflow(P, empty)
    expect(f.steps.map(s => s.state)).toEqual(Array(8).fill('pending'))
    expect(f.next?.id).toBe('idea')
  })
  it('derives states from real rows and asks for approval of materials and montage', () => {
    const data: WfData = {
      ...empty,
      scripts: [{ project_id: 'p1', status: 'approved', source_opportunity_id: 'o', idea: null }],
      storyboards: [{ id: 'b', project_id: 'p1' }], scenes: [{ storyboard_id: 'b' }, { storyboard_id: 'b' }],
      assets: [gen('a1', { cost: { amount: 0.04, currency: 'USD', reported: true } }), gen('r1', { purpose: 'render' }, 'video')],
      publications: [{ project_id: 'p1', platform: 'youtube', status: 'draft' }],
    }
    const f = projectWorkflow(P, data)
    const st = Object.fromEntries(f.steps.map(s => [s.id, s.state]))
    expect(st).toMatchObject({ idea: 'done', script: 'done', storyboard: 'done', materials: 'needs_approval', montage: 'needs_approval', thumbnail: 'pending', publication: 'needs_approval', analytics: 'pending' })
    const approved = projectWorkflow(P, data, { costLimitUsd: null, approvals: { materials: '2026-10-21T10:00:00Z', montage: '2026-10-21T10:00:00Z' } })
    expect(approved.steps.find(s => s.id === 'materials')?.state).toBe('done')
    expect(approved.next?.id).toBe('publication')
  })
  it('failures and licence problems come first, with a retry action', () => {
    const f = projectWorkflow(P, { ...empty, assets: [gen('a', {}, 'image', 'unknown')], renders: [{ project_id: 'p1', status: 'failed', error: 'sin memoria' }] })
    expect(f.steps.find(s => s.id === 'materials')?.state).toBe('blocked')
    expect(f.steps.find(s => s.id === 'montage')).toMatchObject({ state: 'failed', action: 'Reintentar render' })
    expect(f.next?.id).toBe('montage')
  })
  it('sums only reported costs and warns over the project limit', () => {
    const assets = [gen('a', { cost: { amount: 1.5, currency: 'USD' } }), gen('b', { cost: { amount: null, reported: false } }), gen('c', { costTier: 'free' }, 'image', 'licensed')]
    expect(projectCost(assets)).toEqual({ usd: 1.5, unreported: 1 })
    const f = projectWorkflow(P, { ...empty, assets }, { costLimitUsd: 1, approvals: {} })
    expect(f.overBudget).toBe(true)
    expect(f.warnings.join(' ')).toMatch(/límite de 1.00 USD/)
  })
  it('records state transitions after the first sighting only', () => {
    const f1 = projectWorkflow(P, empty)
    const first = recordTransitions(EMPTY_STORE, [f1], 't1')
    expect(first.changed).toBe(true); expect(first.store.history).toHaveLength(0)
    const f2 = projectWorkflow({ ...P, description: 'idea' }, empty)
    const second = recordTransitions(first.store, [f2], 't2')
    expect(second.store.history).toEqual([{ at: 't2', projectId: 'p1', step: 'idea', from: 'pending', to: 'done' }])
    expect(recordTransitions(second.store, [f2], 't3').changed).toBe(false)
  })
  it('settings round-trip and reject garbage', () => {
    let s = setCostLimit(EMPTY_STORE, 'p1', 2.345)
    s = setApproval(s, 'p1', 'montage', '2026-10-21T10:00:00Z')
    expect(parseStore(JSON.parse(JSON.stringify(s))).projects.p1).toEqual({ costLimitUsd: 2.35, approvals: { montage: '2026-10-21T10:00:00Z' } })
    expect(parseStore({ projects: { x: { costLimitUsd: -1, approvals: { montage: 'nope' } } }, history: [{ at: 1 }] })).toEqual({ projects: { x: { costLimitUsd: null, approvals: {} } }, history: [], lastStates: {} })
  })
})
