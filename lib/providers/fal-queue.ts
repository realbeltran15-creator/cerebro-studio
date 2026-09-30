/**
 * fal.ai queue client (server-only, FAL_KEY). Long generations (video, some images and music)
 * are submitted once and polled; a submitted request is never re-submitted automatically,
 * so a retry cannot create a second charge.
 */
const QUEUE = 'https://queue.fal.run'
const key = () => process.env.FAL_KEY?.trim() ?? ''
export const falConfigured = () => Boolean(key())

const headers = () => ({ Authorization: `Key ${key()}`, 'Content-Type': 'application/json' })

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
  if (!r.ok) throw new Error(`fal.ai rechazó la solicitud (${r.status}).`)
  const j = await r.json() as { request_id?: string; status_url?: string; response_url?: string }
  const statusUrl = safeQueueUrl(j.status_url), responseUrl = safeQueueUrl(j.response_url)
  if (!j.request_id || !statusUrl || !responseUrl) throw new Error('fal.ai no devolvió un trabajo válido.')
  return { requestId: j.request_id, statusUrl, responseUrl }
}

export type FalStatus = { state: 'queued' | 'running' | 'done'; position: number | null }

export async function falStatus(job: FalJob): Promise<FalStatus> {
  const url = safeQueueUrl(job.statusUrl)
  if (!url) throw new Error('Invalid fal status URL.')
  const r = await fetch(url, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!r.ok && r.status !== 202) throw new Error(`fal.ai status ${r.status}.`)
  const j = await r.json() as { status?: string; queue_position?: number }
  const state = j.status === 'COMPLETED' ? 'done' : j.status === 'IN_PROGRESS' ? 'running' : 'queued'
  return { state, position: typeof j.queue_position === 'number' ? j.queue_position : null }
}

export async function falResult(job: FalJob): Promise<unknown> {
  const url = safeQueueUrl(job.responseUrl)
  if (!url) throw new Error('Invalid fal response URL.')
  const r = await fetch(url, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`fal.ai no pudo entregar el resultado (${r.status}). Revisa el panel de fal antes de repetir.`)
  return r.json()
}
