import { describe, expect, it } from 'vitest'
import { exportEnd } from '@/lib/editor/export-outcome'

describe('fin de exportación: cancelada vs fallida', () => {
  it('abort del usuario => cancelled (no error técnico)', () => {
    expect(exportEnd(new DOMException('Cancelado', 'AbortError'), true, 'user')).toEqual({ kind: 'cancelled', message: 'Cancelado por el usuario.' })
    expect(exportEnd(new Error('x'), true, null).kind).toBe('cancelled')
  })
  it('AbortError sin señal también cuenta como cancelación; salir del editor tiene su mensaje', () => {
    expect(exportEnd({ name: 'AbortError' }, false, 'unmount')).toMatchObject({ kind: 'cancelled', message: expect.stringContaining('se salió del editor') })
  })
  it('un error real sigue siendo fallo', () => {
    expect(exportEnd(new Error('codec no soportado'), false, null)).toEqual({ kind: 'failed' })
    expect(exportEnd('boom', false, undefined)).toEqual({ kind: 'failed' })
  })
})
