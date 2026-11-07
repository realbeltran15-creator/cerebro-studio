import { describe, expect, it } from 'vitest'
import { distanceToCriteria, meetsCriteria } from '../app/market-intelligence/auto-niche'

const a = (demand: number, competition: number, supply: number) => ({ indices: { demand, competition, supply, growth: null, opportunity: 0 } })
const c = { minDemand: 60, maxCompetition: 40, maxSupply: 50 }

describe('nichos desatendidos por parámetros', () => {
  it('cumple solo si demanda >= mínimo y competencia/oferta <= máximo (los límites cuentan)', () => {
    expect(meetsCriteria(a(60, 40, 50), c)).toBe(true)
    expect(meetsCriteria(a(80, 10, 5), c)).toBe(true)
    expect(meetsCriteria(a(59, 10, 5), c)).toBe(false)
    expect(meetsCriteria(a(80, 41, 5), c)).toBe(false)
    expect(meetsCriteria(a(80, 10, 51), c)).toBe(false)
  })
  it('poca oferta sin demanda no cumple (caso real: demanda 20, oferta 7, competencia 53)', () => {
    expect(meetsCriteria(a(20, 53, 7), c)).toBe(false)
  })
  it('la distancia es 0 si cumple y suma lo que falta en cada parámetro', () => {
    expect(distanceToCriteria(a(70, 30, 40), c)).toBe(0)
    expect(distanceToCriteria(a(50, 45, 55), c)).toBe(10 + 5 + 5)
  })
})
