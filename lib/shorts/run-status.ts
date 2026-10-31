/**
 * What a factory run really was. The database only knows running / succeeded / failed («succeeded» = the code finished without throwing),
 * so «a Short exists» and «the day was skipped» are told apart here, from the stored outcome.
 */
export type RunKind = 'generated' | 'skipped' | 'error' | 'running'

export function shortsRunKind(run: { status: string; summary?: Record<string, unknown> | null }): RunKind {
  if (run.status === 'running') return 'running'
  if (run.status === 'failed') return 'error'
  const o = (run.summary ?? {}).outcome as { status?: string; reason?: string } | undefined
  if (o?.status === 'prepared') return 'generated'
  if (o?.status === 'skipped') {
    // A failed generation or a failed save is an error, not a skip for lack of data.
    return o.reason === 'generation_failed' || o.reason === 'storage_failed' || o.reason === 'voice_quality' ? 'error' : 'skipped'
  }
  return 'error'
}

export const RUN_KIND_LABEL: Record<RunKind, string> = {
  generated: 'Short generado', skipped: 'Omitida (sin Short)', error: 'Error de generación', running: 'Generación en proceso',
}
