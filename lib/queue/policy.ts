/**
 * Politica de errores por paso (Fase 4B.0). Principio: nunca reintentar solo lo que pueda cobrar o publicar dos veces.
 *  - 401/403: permanente, sin reintento.
 *  - 429: el proveedor NO proceso la peticion. Solo se reintenta si el paso es seguro, el reintento esta autorizado
 *    (retryOn429) y quedan intentos; se respeta Retry-After (nunca antes). Si no, falla y libera la reserva.
 *  - 5xx / timeout / error desconocido: resultado incierto. Paso seguro: reintento con backoff. Paso irreversible:
 *    se queda en awaiting_approval (no se libera la reserva: pudo cobrarse) hasta que una persona lo revise.
 *  - Otros 4xx: permanente.
 */
export class StepError extends Error {
  constructor(message: string, readonly opts: { httpStatus?: number; code?: string; retryAfterMs?: number } = {}) {
    super(message)
    this.name = 'StepError'
  }
  get httpStatus() { return this.opts.httpStatus }
  get code() { return this.opts.code }
  get retryAfterMs() { return this.opts.retryAfterMs }
}

export type PolicyInput = {
  error: unknown
  stepKind: 'safe' | 'irreversible'
  retryOn429: boolean
  jobAttempts: number
  maxAttempts: number
}

export type Decision =
  | { action: 'retry'; delayMs: number; code: string }
  | { action: 'fail'; code: string; message: string; httpStatus?: number; releaseReservation: boolean }
  | { action: 'await'; reason: 'uncertain_outcome'; code: string; message: string }

export const BACKOFF_BASE_MS = 5_000
export const BACKOFF_MAX_MS = 5 * 60_000
export const RETRY_AFTER_MAX_MS = 60 * 60_000

export const backoff = (attempt: number) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1))

export function decide(i: PolicyInput): Decision {
  const e = i.error
  const status = e instanceof StepError ? e.httpStatus : undefined
  const message = e instanceof Error ? e.message : String(e)
  const hasAttempts = i.jobAttempts < i.maxAttempts

  if (status === 401 || status === 403) {
    return { action: 'fail', code: status === 401 ? 'auth_error' : 'forbidden', message, httpStatus: status, releaseReservation: true }
  }
  if (status === 429) {
    if (i.stepKind === 'safe' && i.retryOn429 && hasAttempts) {
      const ra = e instanceof StepError ? e.retryAfterMs : undefined
      return { action: 'retry', code: 'rate_limited', delayMs: Math.min(RETRY_AFTER_MAX_MS, Math.max(ra ?? 0, backoff(i.jobAttempts))) }
    }
    return { action: 'fail', code: 'rate_limited', message, httpStatus: 429, releaseReservation: true }
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return { action: 'fail', code: (e instanceof StepError && e.code) || 'client_error', message, httpStatus: status, releaseReservation: true }
  }
  // 5xx, timeout, red o error desconocido: resultado incierto.
  const code = (e instanceof StepError && e.code) || (status ? 'server_error' : 'unknown_error')
  if (i.stepKind === 'irreversible') return { action: 'await', reason: 'uncertain_outcome', code, message }
  if (hasAttempts) return { action: 'retry', code, delayMs: backoff(i.jobAttempts) }
  return { action: 'fail', code: 'max_attempts_exceeded', message, httpStatus: status, releaseReservation: true }
}
