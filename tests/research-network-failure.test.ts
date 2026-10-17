import { describe, expect, it } from 'vitest'
import { isNetworkFailure, networkFailureMessage } from '@/lib/research/net-error'
import type { ServerUsage } from '@/lib/research/ledger'

const u = (usedToday: number, searchesToday: number, persistent = true): ServerUsage => ({ usedToday, cap: 6000, persistent, searchesToday, searchCap: 60 })

describe('network failure («Failed to fetch»)', () => {
  it('recognises the browser errors that mean "no HTTP answer", not API errors', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkFailure(new Error('Load failed'))).toBe(true)
    expect(isNetworkFailure(new SyntaxError('Unexpected token < in JSON'))).toBe(false)
    expect(isNetworkFailure(new Error('YouTube rechazó la clave API.'))).toBe(false)
  })
  it('says it is safe to retry only when a persistent counter shows nothing was spent', () => {
    expect(networkFailureMessage(u(0, 0), u(0, 0))).toMatch(/No se ha gastado cuota.*seguro reintentar/)
  })
  it('reports what the server did spend before the connection dropped', () => {
    const m = networkFailureMessage(u(0, 0), u(204, 2))
    expect(m).toMatch(/204 unidades · 2 búsquedas/); expect(m).not.toMatch(/seguro reintentar/)
  })
  it('does not claim "no quota spent" when the counter is not persistent', () => {
    const m = networkFailureMessage(u(0, 0, false), u(0, 0, false))
    expect(m).not.toMatch(/seguro reintentar|No se ha gastado/); expect(m).toMatch(/No se puede comprobar/)
  })
  it('does not guess when the server cannot be asked at all', () => {
    expect(networkFailureMessage(null, null)).toMatch(/tampoco se pudo comprobar el consumo/)
  })
})
