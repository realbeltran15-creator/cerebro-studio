import { describe, expect, it } from 'vitest'
import { internalNavTarget, unsavedAtRisk } from '@/lib/editor/nav-guard'

const base = { href: '/editor/style?project=1', target: null, download: false, button: 0, meta: false, origin: 'https://app.test', currentUrl: 'https://app.test/editor/manual?job=7' }
describe('aviso de cambios sin guardar', () => {
  it('protege cuando el autoguardado está apagado o falla; no cuando ya está a salvo', () => {
    expect(unsavedAtRisk({ dirty: true, autoSave: false, saveState: 'pending' })).toBe(true)
    expect(unsavedAtRisk({ dirty: true, autoSave: true, saveState: 'error' })).toBe(true)
    expect(unsavedAtRisk({ dirty: true, autoSave: true, saveState: 'conflict' })).toBe(true)
    expect(unsavedAtRisk({ dirty: true, autoSave: true, saveState: 'pending' })).toBe(false)
    expect(unsavedAtRisk({ dirty: false, autoSave: false, saveState: 'saved' })).toBe(false)
  })
  it('solo intercepta navegación interna que cambia de página', () => {
    expect(internalNavTarget(base)).toBe('/editor/style?project=1')
    expect(internalNavTarget({ ...base, href: 'https://otro.test/x' })).toBeNull()
    expect(internalNavTarget({ ...base, target: '_blank' })).toBeNull()
    expect(internalNavTarget({ ...base, meta: true })).toBeNull()
    expect(internalNavTarget({ ...base, button: 1 })).toBeNull()
    expect(internalNavTarget({ ...base, download: true })).toBeNull()
    expect(internalNavTarget({ ...base, href: '/editor/manual?job=7#x' })).toBeNull()
    expect(internalNavTarget({ ...base, href: null })).toBeNull()
  })
})
