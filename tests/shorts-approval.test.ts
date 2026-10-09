import { describe, expect, it } from 'vitest'
import { approvalBlockers, assertShortApproved } from '../lib/shorts/approval'

const ok = { owner_id: 'u', action_type: 'publish', entity_type: 'short', entity_id: 's1', status: 'approved' }
const good = {
  status: 'ready_for_approval',
  quality: { gates: [{ name: 'a', pass: true, detail: '' }] },
  facts: { sources: [{ url: 'https://es.wikipedia.org/wiki/A', domain: 'wikipedia.org', quote: 'q', verified_at: '' }, { url: 'https://www.britannica.com/b', domain: 'britannica.com', quote: 'q', verified_at: '' }] },
}

describe('puerta de publicación', () => {
  it('bloquea sin aprobación o con una ajena', () => {
    expect(() => assertShortApproved('u', 's1', null)).toThrow(/aprobación explícita/)
    expect(() => assertShortApproved('u', 's1', { ...ok, status: 'pending' })).toThrow()
    expect(() => assertShortApproved('u', 's1', { ...ok, status: 'rejected' })).toThrow()
    expect(() => assertShortApproved('u', 's1', { ...ok, entity_id: 's2' })).toThrow()
    expect(() => assertShortApproved('u', 's1', { ...ok, owner_id: 'otro' })).toThrow()
    expect(() => assertShortApproved('u', 's1', { ...ok, action_type: 'view' })).toThrow()
  })
  it('permite solo la aprobación exacta de ese Short', () => {
    expect(() => assertShortApproved('u', 's1', ok)).not.toThrow()
  })
})

describe('aprobación en el servidor', () => {
  it('sin bloqueos si todo está confirmado', () => {
    expect(approvalBlockers(good, { sources: true, hook: true })).toEqual([])
  })
  it('exige revisar fuentes y hook', () => {
    expect(approvalBlockers(good, {})).toHaveLength(2)
  })
  it('bloquea con controles fallidos, menos de 2 fuentes o estado incorrecto', () => {
    expect(approvalBlockers({ ...good, quality: { gates: [{ name: 'hook', pass: false, detail: 'x' }] } }, { sources: true, hook: true }).join()).toMatch(/hook/)
    expect(approvalBlockers({ ...good, facts: { sources: good.facts.sources.slice(0, 1) } }, { sources: true, hook: true }).join()).toMatch(/2 fuentes/)
    expect(approvalBlockers({ ...good, status: 'discarded' }, { sources: true, hook: true }).join()).toMatch(/estado/)
  })
})
