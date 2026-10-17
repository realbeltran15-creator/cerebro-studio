/**
 * Higgsfield official API (server-only). Docs checked 2026-10-07: https://docs.higgsfield.ai
 *  - Auth: `Authorization: Key KEY_ID:KEY_SECRET` (create keys at console.higgsfield.ai).
 *  - Submit: POST https://api.higgsfield.ai/<model path> → { status: 'queued', request_id, status_url }
 *  - Status: GET /requests/{request_id}/status → completed | failed | nsfw | canceled (+ images[].url | video.url)
 *  - Billing: account credits; failed/nsfw requests are refunded. Outputs kept ≥ 7 days (Cerebro copies them).
 * A submitted request is never re-submitted automatically (Idempotency-Key = Cerebro request id).
 */
const API = 'https://api.higgsfield.ai'
const id = () => process.env.HIGGSFIELD_API_KEY_ID?.trim() ?? ''
const secret = () => process.env.HIGGSFIELD_API_KEY_SECRET?.trim() ?? ''
export const higgsfieldConfigured = () => Boolean(id() && secret())
const headers = () => ({ Authorization: `Key ${id()}:${secret()}`, 'Content-Type': 'application/json' })

export type HiggsfieldJob = { requestId: string }
export type HiggsfieldStatus = { status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled'; images?: Array<{ url: string }>; video?: { url: string } | null; error?: string | null }

/** Only documented model paths: letters, digits, dots and dashes in 2–5 segments. */
export function checkModelPath(path: string) {
  if (!/^[a-z0-9.-]+(\/[a-z0-9.-]+){1,4}$/i.test(path) || path.includes('..')) throw new Error('Ruta de modelo Higgsfield no válida.')
  return path
}

export async function higgsfieldSubmit(modelPath: string, input: Record<string, unknown>, idempotencyKey: string): Promise<HiggsfieldJob> {
  const r = await fetch(`${API}/${checkModelPath(modelPath)}`, { method: 'POST', headers: { ...headers(), 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input), cache: 'no-store', signal: AbortSignal.timeout(60000) })
  const j = await r.json().catch(() => ({})) as { request_id?: string; error?: string; detail?: unknown }
  if (!r.ok || !j.request_id) throw new Error(`Higgsfield rechazó la petición (${r.status}).`)
  if (!/^[0-9a-f-]{36}$/i.test(j.request_id)) throw new Error('Higgsfield devolvió un identificador no válido.')
  return { requestId: j.request_id }
}

export async function higgsfieldStatus(job: HiggsfieldJob): Promise<HiggsfieldStatus> {
  if (!/^[0-9a-f-]{36}$/i.test(job.requestId)) throw new Error('Identificador no válido.')
  const r = await fetch(`${API}/requests/${job.requestId}/status`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`Higgsfield no respondió al estado (${r.status}).`)
  return await r.json() as HiggsfieldStatus
}

/** Request body per documented model (OpenAPI spec). */
export function higgsfieldInput(path: string, prompt: string, o: { format?: string; durationSeconds?: number; variants?: number; negative?: string }) {
  if (path.startsWith('higgsfield-ai/soul')) return { prompt, num_images: Math.min(Math.max(o.variants ?? 1, 1), 4), resolution: '2K', aspect_ratio: o.format === '9:16' ? '9:16' : o.format === '1:1' ? '1:1' : '16:9' }
  if (path.startsWith('kling-video/')) return { prompt, duration: o.durationSeconds === 10 ? 10 : 5, ...(o.negative ? { negative_prompt: o.negative } : {}) }
  if (path.startsWith('minimax/hailuo')) return { prompt, duration: o.durationSeconds === 10 ? 10 : 6, prompt_optimizer: true }
  return { prompt }
}
