/**
 * Logica pura de los endpoints de cola (sin Next, testeable). Desactivada por defecto: si la configuracion no la activa -> 404.
 * dry_run se fuerza SIEMPRE: el cliente no puede pedir ejecucion real. Propiedad verificada en servidor; un trabajo ajeno es 404 (no filtra existencia).
 */
import type { QueueConfig } from './config'
import type { Job, QueueStore } from './types'

export type ApiRequest = {
  action: 'enqueue' | 'get' | 'cancel'
  method: string
  origin: string | null
  host: string | null
  user: { id: string } | null
  body?: unknown
  jobId?: string
}
export type ApiResponse = { status: number; body: Record<string, unknown>; headers?: Record<string, string> }
export type ApiDeps = {
  config: QueueConfig
  store: QueueStore
  rateLimit: (userId: string, action: string) => { allowed: boolean; retryAfterS: number }
  /** Comprueba que el proyecto pertenece al usuario (la funcion SQL tambien lo hace). */
  now?: () => number
}

export const ALLOWED_KINDS = ['video_production'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY = /^[A-Za-z0-9._:-]{8,128}$/
const MAX_PAYLOAD_BYTES = 8 * 1024

const publicJob = (j: Job) => ({
  id: j.id, kind: j.kind, status: j.status, projectId: j.projectId, dryRun: j.dryRun, currentStep: j.currentStep, awaitingReason: j.awaitingReason,
  cancelRequested: j.cancelRequested, attempts: j.attempts, error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt,
  steps: j.steps.map(s => ({ name: s.name, status: s.status, attempts: s.attempts, durationMs: s.durationMs ?? null, dependsOn: s.dependsOn ?? [], error: s.error ?? null })),
  result: j.result,
})

const err = (status: number, error: string, extra: Record<string, unknown> = {}): ApiResponse => ({ status, body: { error, ...extra } })

/** CSRF: en peticiones que cambian estado el Origin debe existir y coincidir con el Host. */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false
  try { return new URL(origin).host === host } catch { return false }
}

export async function handleQueueRequest(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  if (!deps.config.enabled) return err(404, 'Not found')
  if (!req.user) return err(401, 'Unauthorized')
  const mutating = req.method !== 'GET'
  if (mutating && !sameOrigin(req.origin, req.host)) return err(403, 'Origen no permitido')
  const rl = deps.rateLimit(req.user.id, `queue:${req.action}`)
  if (!rl.allowed) return { status: 429, body: { error: `Demasiadas solicitudes. Espera ${rl.retryAfterS} s.` }, headers: { 'Retry-After': String(rl.retryAfterS) } }
  const now = deps.now?.() ?? Date.now()

  if (req.action === 'enqueue') {
    if (req.method !== 'POST') return err(405, 'Method not allowed')
    const b = (req.body && typeof req.body === 'object' ? req.body : null) as Record<string, unknown> | null
    if (!b) return err(400, 'Cuerpo invalido')
    if (b.dryRun === false || b.dry_run === false) return err(400, 'dry_run es obligatorio: esta fase no admite ejecucion real')
    if (typeof b.kind !== 'string' || !(ALLOWED_KINDS as readonly string[]).includes(b.kind)) return err(400, 'Tipo de trabajo no permitido')
    if (typeof b.idempotencyKey !== 'string' || !KEY.test(b.idempotencyKey)) return err(400, 'idempotencyKey invalida')
    if (b.projectId !== undefined && b.projectId !== null && (typeof b.projectId !== 'string' || !UUID.test(b.projectId))) return err(400, 'projectId invalido')
    const payload = (b.payload ?? {}) as unknown
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return err(400, 'payload invalido')
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) return err(413, 'payload demasiado grande')
    try {
      const out = await deps.store.enqueue({ ownerId: req.user.id, projectId: (b.projectId as string | null | undefined) ?? null, kind: b.kind, idempotencyKey: b.idempotencyKey, payload: payload as Record<string, unknown>, dryRun: true }, now)
      if (out.payloadMismatch) return err(409, 'Esa clave de idempotencia ya existe con otro contenido', { jobId: out.job.id })
      return { status: out.created ? 201 : 200, body: { job: publicJob(out.job), created: out.created } }
    } catch (e) {
      // Mensajes de la base (p. ej. proyecto ajeno) no se devuelven tal cual.
      const msg = e instanceof Error ? e.message : ''
      if (/insufficient_privilege|project/i.test(msg)) return err(404, 'Proyecto no encontrado')
      return err(500, 'No se pudo encolar')
    }
  }

  if (!req.jobId || !UUID.test(req.jobId)) return err(400, 'id invalido')
  if (req.action === 'get') {
    if (req.method !== 'GET') return err(405, 'Method not allowed')
    const job = await deps.store.get(req.jobId)
    if (!job || job.ownerId !== req.user.id) return err(404, 'Not found')
    return { status: 200, body: { job: publicJob(job) } }
  }
  if (req.action === 'cancel') {
    if (req.method !== 'POST') return err(405, 'Method not allowed')
    const job = await deps.store.get(req.jobId)
    if (!job || job.ownerId !== req.user.id) return err(404, 'Not found')
    const ok = await deps.store.requestCancel(req.jobId, req.user.id, now)
    return ok ? { status: 202, body: { cancelRequested: true } } : err(409, 'El trabajo ya termino')
  }
  return err(400, 'Accion desconocida')
}
