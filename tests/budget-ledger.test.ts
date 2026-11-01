import { describe, expect, it } from 'vitest'
import { createMemoryLedger, isFreeCost } from '@/lib/budget/ledger'

const O = 'o1'
const now = new Date('2026-11-01T10:00:00Z')
const reserve = (l: ReturnType<typeof createMemoryLedger>, key: string, cost: Parameters<typeof l.reserve>[0]['cost'], over: Partial<Parameters<typeof l.reserve>[0]> = {}) =>
  l.reserve({ ownerId: O, jobId: 'j', step: 's', provider: 'p', projectId: null, cost, keyBase: key, now, ...over })

describe('presupuesto agregado', () => {
  it('por defecto no hay nada autorizado, salvo coste exactamente 0', () => {
    const l = createMemoryLedger()
    expect(reserve(l, 'a', { eur: 0.01 })).toMatchObject({ ok: false, code: 'budget_exhausted' })
    expect(reserve(l, 'b', { eur: 0 })).toMatchObject({ ok: true })
    expect(isFreeCost({ eur: 0, credits: 0 })).toBe(true)
    expect(isFreeCost({ eur: null })).toBe(false)
  })

  it('precio desconocido o inválido bloquea', () => {
    const l = createMemoryLedger(); l.setLimit({ ownerId: O, provider: 'p', unit: 'eur', dailyLimit: 100 })
    expect(reserve(l, 'a', { eur: null })).toMatchObject({ ok: false, code: 'unknown_price' })
    expect(reserve(l, 'b', { eur: -1 })).toMatchObject({ ok: false, code: 'invalid_amount' })
    expect(reserve(l, 'c', { eur: Number.NaN })).toMatchObject({ ok: false, code: 'invalid_amount' })
    expect(l.entries()).toHaveLength(0)
  })

  it('reservas acumulan hasta el límite y la reserva repetida con la misma clave no duplica', () => {
    const l = createMemoryLedger(); l.setLimit({ ownerId: O, provider: 'p', unit: 'credits', dailyLimit: 10 })
    expect(reserve(l, 'a', { credits: 6 })).toEqual({ ok: true, reused: false })
    expect(reserve(l, 'a', { credits: 6 })).toEqual({ ok: true, reused: true })
    expect(l.used(O, 'p', 'credits', now)).toBe(6)
    expect(reserve(l, 'b', { credits: 5 })).toMatchObject({ ok: false, code: 'budget_exhausted' })
    expect(reserve(l, 'c', { credits: 4 })).toMatchObject({ ok: true })
  })

  it('conciliar sustituye lo reservado por lo real; liberar devuelve el hueco', () => {
    const l = createMemoryLedger(); l.setLimit({ ownerId: O, provider: 'p', unit: 'usd', dailyLimit: 10 })
    reserve(l, 'a', { usd: 8 }); reserve(l, 'x', { usd: 0 })
    l.settle('a', O, { usd: 3 })
    expect(l.used(O, 'p', 'usd', now)).toBe(3)
    reserve(l, 'b', { usd: 7 }); l.release('b', O)
    expect(l.used(O, 'p', 'usd', now)).toBe(3)
    expect(reserve(l, 'c', { usd: 7 })).toMatchObject({ ok: true })
  })

  it('el día reinicia el contador y los propietarios/proveedores están aislados', () => {
    const l = createMemoryLedger(); l.setLimit({ ownerId: O, provider: 'p', unit: 'eur', dailyLimit: 1 })
    reserve(l, 'a', { eur: 1 })
    expect(reserve(l, 'b', { eur: 1 })).toMatchObject({ ok: false })
    expect(reserve(l, 'b', { eur: 1 }, { now: new Date('2026-11-02T00:01:00Z') })).toMatchObject({ ok: true })
    expect(reserve(l, 'c', { eur: 1 }, { ownerId: 'o2' })).toMatchObject({ ok: false })       // otro propietario no hereda límites
    expect(reserve(l, 'd', { eur: 1 }, { provider: 'q' })).toMatchObject({ ok: false })
  })

  it('el límite por proyecto restringe más que el general', () => {
    const l = createMemoryLedger()
    l.setLimit({ ownerId: O, provider: 'p', unit: 'eur', dailyLimit: 10 })
    l.setLimit({ ownerId: O, provider: 'p', projectId: 'proj', unit: 'eur', dailyLimit: 2 })
    expect(reserve(l, 'a', { eur: 3 }, { projectId: 'proj' })).toMatchObject({ ok: false })
    expect(reserve(l, 'b', { eur: 3 }, { projectId: 'otro' })).toMatchObject({ ok: true })
  })
})
