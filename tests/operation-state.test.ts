import { describe, expect, it } from 'vitest'
import { operationLabels, operationState } from '@/lib/operation-state'

describe('operationState', () => {
  it('mapea los estados existentes a los cuatro estados', () => {
    expect(operationState('draft')).toBe('prepared')
    expect(operationState('approved')).toBe('prepared')
    expect(operationState('awaiting_approval')).toBe('awaiting_approval')
    expect(operationState('needs_review')).toBe('awaiting_approval')
    expect(operationState('publishing')).toBe('running')
    expect(operationState('running')).toBe('running')
  })
  it('«publicado/completado» sin evidencia NO es verificado', () => {
    expect(operationState('published')).toBe('uncertain')
    expect(operationState('completed', { outputExists: true })).toBe('verified')
    expect(operationState('completed', { outputExists: true, outputVerified: false })).toBe('uncertain')
    expect(operationState('published', { outputVerified: true })).toBe('verified')
  })
  it('fallos, cancelaciones e interrupciones se muestran aparte y no se convierten en éxito', () => {
    expect(operationState('failed', { outputVerified: true })).toBe('failed')
    expect(operationState('cancelled')).toBe('cancelled')
    expect(operationState('completed', { outputVerified: true }, { interrupted: true })).toBe('uncertain')
    expect(operationState('algo-raro')).toBe('uncertain')
  })
  it('todos los estados tienen etiqueta en español', () => {
    for (const k of ['prepared', 'awaiting_approval', 'running', 'verified', 'failed', 'cancelled', 'uncertain'] as const) expect(operationLabels[k].length).toBeGreaterThan(3)
  })
})
