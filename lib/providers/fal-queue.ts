/**
 * fal.ai queue client (server-only, FAL_KEY). Long generations (video, some images and music)
 * are submitted once and polled; a submitted request is never re-submitted automatically,
 * so a retry cannot create a second charge. Only the idempotent reads (status, result) are retried.
 *
 * Hosts this module needs: queue.fal.run (submit, status_url and response_url) and, to download the
 * finished files, fal's file CDN (v3.fal.media, v3b.fal.media, fal.media; see isFalMediaUrl).
 * Authentication: `Authorization: Key <FAL_KEY>`.
 */
const QUEUE = 'https://queue.fal.run'
const key = () => process.env.FAL_KEY?.trim() ?? ''
export const falConfigured = () => Boolean(key())

const headers = () => ({ Authorization: `Key ${key()}`, 'Content-Type': 'application/json' })

/**
 * Output files are only downloaded from fal's own file CDN (fal.media and its subdomains such as v3.fal.media),
 * so a result can never point the server at an arbitrary host. Extra hosts can be added without a code change
 * through FAL_EXTRA_MEDIA_HOSTS (comma-separated hostnames) if fal moves its CDN.
 */
export function isFalMediaUrl(value: unknown) {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password) return false
    const host = u.hostname.toLowerCase()
    if (host === 'fal.media' || host.endsWith('.fal.media')) return true
    const extra = (process.env.FAL_EXTRA_MEDIA_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(h => /^[a-z0-9.-]+$/.test(h))
    return extra.includes(host)
  } catch { return false }
}

/** Readable, secret-free explanation of a rejected request. The status stays in "(NNN)" for the route's error mapping. */
async function rejection(r: Response, what: string) {
  const body = await r.json().catch(() => null) as { detail?: unknown } | null
  const raw = typeof body?.detail === 'string' ? body.detail
    : Array.isArray(body?.detail) ? (body!.detail as Array<{ msg?: unknown }>).map(d => (typeof d?.msg === 'string' ? d.msg : '')).filter(Boolean).join('; ') : ''
  const detail = raw.replace(/[\r\n]+/g, ' ').slice(0, 160)
  const hint = r.status === 401 ? ' La clave de fal.ai no es válida.'
    : r.status === 403 ? ' fal.ai deniega el acceso (clave sin permiso o cuenta sin saldo): revisa el panel de fal.'
    : r.status === 429 ? ' Demasiadas solicitudes a fal.ai; espera un momento.'
    : r.status === 422 ? ' Los parámetros no son válidos para este modelo.' : ''
  return new Error(`${what} (${r.status}).${hint}${detail && r.status === 422 ? ` ${detail}` : ''}`)
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const TRANSIENT = new Set([500, 502, 503, 504])

/** GET with up to 2 retries on network errors and 5xx. Reads are idempotent, so this can never duplicate a charge. */
async function getWithRetry(url: string, timeoutMs: number) {
  let last: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(800 * attempt)
    try {
      const r = await fetch(url, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      if (!TRANSIENT.has(r.status) || attempt === 2) return r
      last = new Error(`fal.ai ${r.status}`)
    } catch (e) { last = e; if (attempt === 2) throw e }
  }
  throw last instanceof Error ? last : new Error('fal.ai no respondió.')
}

/** Endpoint ids are documented model paths such as "fal-ai/veo3/fast". */
function checkEndpoint(endpoint: string) {
  if (!/^[a-z0-9-]+\/[a-z0-9./-]+$/i.test(endpoint) || endpoint.includes('..')) throw new Error('Invalid fal endpoint.')
  return endpoint
}

/** Only URLs on fal's queue host are ever polled, so a token can never point the server elsewhere. */
export function safeQueueUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'queue.fal.run' ? u.toString() : null } catch { return null }
}

export type FalJob = { requestId: string; statusUrl: string; responseUrl: string }

export async function falSubmit(endpoint: string, input: Record<string, unknown>): Promise<FalJob> {
  if (!falConfigured()) throw new Error('fal.ai is not configured.')
  const r = await fetch(`${QUEUE}/${checkEndpoint(endpoint)}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(input), cache: 'no-store', signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) throw await rejection(r, 'fal.ai rechazó la solicitud')
  const j = await r.json() as { request_id?: string; status_url?: string; response_url?: string }
  const statusUrl = safeQueueUrl(j.status_url), responseUrl = safeQueueUrl(j.response_url)
  if (!j.request_id || !statusUrl || !responseUrl) throw new Error('fal.ai no devolvió un trabajo válido.')
  return { requestId: j.request_id, statusUrl, responseUrl }
}

export type FalStatus = { state: 'queued' | 'running' | 'done'; position: number | null }

export async function falStatus(job: FalJob): Promise<FalStatus> {
  const url = safeQueueUrl(job.statusUrl)
  if (!url) throw new Error('Invalid fal status URL.')
  const r = await getWithRetry(url, 15000)
  if (!r.ok && r.status !== 202) throw new Error(`fal.ai status ${r.status}.`)
  const j = await r.json() as { status?: string; queue_position?: number }
  const state = j.status === 'COMPLETED' ? 'done' : j.status === 'IN_PROGRESS' ? 'running' : 'queued'
  return { state, position: typeof j.queue_position === 'number' ? j.queue_position : null }
}

export async function falResult(job: FalJob): Promise<unknown> {
  const url = safeQueueUrl(job.responseUrl)
  if (!url) throw new Error('Invalid fal response URL.')
  const r = await getWithRetry(url, 30000)
  if (!r.ok) {
    // A failed or filtered job answers its result URL with an error and a reason (e.g. the safety checker).
    const body = await r.json().catch(() => null) as { detail?: unknown } | null
    const reason = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail) ? (body!.detail as Array<{ msg?: unknown }>).map(d => (typeof d?.msg === 'string' ? d.msg : '')).filter(Boolean).join('; ') : ''
    throw new Error(`fal.ai no pudo entregar el resultado (${r.status})${reason ? `: ${reason.replace(/[\r\n]+/g, ' ').slice(0, 200)}` : ''}. Revisa el panel de fal antes de repetir: los trabajos fallidos no se cobran.`)
  }
  return r.json()
}

export type FalCheck = { state: 'ok' | 'not_configured' | 'invalid_key' | 'no_access' | 'unreachable' | 'unexpected'; message: string }

/**
 * Credential and reachability check without generating anything: an empty body has no prompt, so after
 * authenticating the key fal answers 422 and queues no job. 401/403 mean a bad key or an account without access/balance.
 * If fal ever accepted the empty body (2xx) the queued request is reported, never retried.
 */
export async function checkFalConnection(): Promise<FalCheck> {
  if (!falConfigured()) return { state: 'not_configured', message: 'FAL_KEY no está definida en este despliegue.' }
  try {
    const r = await fetch(`${QUEUE}/fal-ai/wan/v2.2-5b/text-to-video/fast-wan`, {
      method: 'POST', headers: headers(), body: '{}', cache: 'no-store', signal: AbortSignal.timeout(20000),
    })
    if (r.status === 422) return { state: 'ok', message: 'Clave aceptada por fal.ai (rechazó la petición vacía, como se esperaba; no se creó ningún trabajo).' }
    if (r.status === 401) return { state: 'invalid_key', message: 'fal.ai no acepta la clave (401). Revisa que FAL_KEY sea la clave nueva y que el despliegue sea posterior al cambio.' }
    if (r.status === 403) return { state: 'no_access', message: 'fal.ai deniega el acceso (403): clave sin permiso o cuenta sin saldo.' }
    if (r.ok) return { state: 'unexpected', message: `fal.ai aceptó la petición vacía (${r.status}); puede haberse creado un trabajo. Revisa el panel de fal.` }
    return { state: 'unexpected', message: `Respuesta inesperada de fal.ai (${r.status}).` }
  } catch { return { state: 'unreachable', message: 'No se pudo contactar con queue.fal.run desde el servidor.' } }
}
