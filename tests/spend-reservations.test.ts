import { describe, expect, it } from 'vitest'
import { capViolation, spendStatus } from '@/lib/providers/spend'
import { heldUsd, holdSpend, releaseSpend } from '@/lib/providers/spend-reservations'

const status = (today = 0) => spendStatus([], [], { dailyUsd: 1, monthlyUsd: 10 }, new Date(), today ? [{ createdAt: new Date().toISOString(), estimateUsd: today, tier: 'paid' }] : [])

describe('reservas de gasto (misma instancia)', () => {
  it('capViolation tiene en cuenta lo ya aceptado pero aún sin contabilizar', () => {
    expect(capViolation(status(), 0.6)).toBeNull()
    expect(capViolation(status(), 0.6, 0.5)).toMatch(/Tope diario/)
  })
  it('N peticiones simultáneas con tope 1 USD y 0,4 USD cada una: solo 2 pasan', async () => {
    const owner = `u-${Math.random()}`
    const request = async () => {
      await new Promise(r => setTimeout(r, Math.random() * 5))          // lecturas de BD asíncronas
      const violation = capViolation(status(), 0.4, heldUsd(owner))
      if (violation) return 'blocked'
      holdSpend(owner, 0.4)                                              // sin await entre la comprobación y la reserva
      return 'sent'
    }
    const results = await Promise.all(Array.from({ length: 10 }, request))
    expect(results.filter(r => r === 'sent')).toHaveLength(2)
  })
  it('liberar la reserva la quita; caduca sola; usuarios aislados', () => {
    const a = `a-${Math.random()}`, b = `b-${Math.random()}`
    const id = holdSpend(a, 0.5, 1000)
    expect(heldUsd(a, 1001)).toBe(0.5); expect(heldUsd(b, 1001)).toBe(0)
    releaseSpend(a, id); expect(heldUsd(a, 1001)).toBe(0)
    holdSpend(a, 0.5, 1000); expect(heldUsd(a, 1000 + 121_000)).toBe(0)
  })
})
