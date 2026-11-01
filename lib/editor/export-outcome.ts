/** Distingue una cancelación voluntaria de un fallo técnico al terminar una exportación. */
export type ExportEnd = { kind: 'cancelled'; message: string } | { kind: 'failed' }

export function exportEnd(e: unknown, signalAborted: boolean, abortReason: string | null | undefined): ExportEnd {
  const aborted = signalAborted || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError')
  if (!aborted) return { kind: 'failed' }
  return { kind: 'cancelled', message: abortReason === 'unmount' ? 'Cancelado: se salió del editor antes de terminar el render.' : 'Cancelado por el usuario.' }
}
