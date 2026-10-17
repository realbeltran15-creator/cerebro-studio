import { isPublicHttpsUrl } from './safe-url'

/**
 * Alibaba Cloud Model Studio (DashScope) — Wan text-to-video. Server-only (DASHSCOPE_API_KEY).
 *
 * STATUS: implemented from Alibaba's documentation (async task API: create with the header
 * X-DashScope-Async: enable, then poll /api/v1/tasks/{id}). It has NOT been run against the real
 * service: there is no key and this environment cannot reach Alibaba hosts. It is therefore marked
 * `unverified` in the catalogue and only runs when chosen by hand.
 *
 * Billing guard: the one-off free quota is NOT renewable and a verified account is billed per second
 * once it is used up. The route refuses to send a job when its local counter says the quota is gone.
 */
const key = () => process.env.DASHSCOPE_API_KEY?.trim() ?? ''
export const dashscopeConfigured = () => Boolean(key())

/** International (Singapore) endpoint by default: the free quota applies to that region. Override with DASHSCOPE_BASE_URL. */
export const dashscopeBase = () => {
  const raw = process.env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope-intl.aliyuncs.com'
  if (!isPublicHttpsUrl(raw, ['aliyuncs.com'])) throw new Error('DASHSCOPE_BASE_URL debe ser una dirección https de aliyuncs.com.')
  return raw.replace(/\/+$/, '')
}

export type WanJob = { taskId: string; base: string }

/** Wan sizes documented for the 2.x text-to-video models, by format. */
export const wanSize = { '16:9': '1280*720', '9:16': '720*1280', '1:1': '960*960' } as const

export function wanModelName(catalogId: string) {
  const fromEnv = process.env.DASHSCOPE_WAN_MODEL?.trim()
  const name = fromEnv || catalogId.slice('alibaba:'.length)
  if (!/^wan[0-9a-z.-]+$/i.test(name)) throw new Error('Nombre de modelo Wan no válido.')
  return name
}

export async function wanSubmit(model: string, prompt: string, o: { format: keyof typeof wanSize; durationSeconds: number; negativePrompt?: string }): Promise<WanJob> {
  if (!dashscopeConfigured()) throw new Error('DashScope no está configurado.')
  const base = dashscopeBase()
  const r = await fetch(`${base}/api/v1/services/aigc/video-generation/video-synthesis`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({
      model,
      input: { prompt: prompt.slice(0, 1500), ...(o.negativePrompt?.trim() ? { negative_prompt: o.negativePrompt.trim().slice(0, 500) } : {}) },
      parameters: { size: wanSize[o.format], duration: o.durationSeconds, prompt_extend: true, watermark: false },
    }),
  })
  if (!r.ok) throw new Error(`DashScope rechazó la solicitud (${r.status}).`)
  const j = await r.json() as { output?: { task_id?: string } }
  const id = j.output?.task_id
  if (!id || !/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error('DashScope no devolvió un identificador de tarea válido.')
  return { taskId: id, base }
}

export type WanStatus = { state: 'queued' | 'running' } | { state: 'done'; videoUrl: string } | { state: 'failed'; error: string }

export async function wanStatus(job: WanJob): Promise<WanStatus> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(job.taskId)) throw new Error('Tarea no válida.')
  // The base is re-validated (not trusted from the token) before the key is sent anywhere.
  const base = dashscopeBase()
  const r = await fetch(`${base}/api/v1/tasks/${job.taskId}`, { headers: { Authorization: `Bearer ${key()}` }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`DashScope estado ${r.status}.`)
  const j = await r.json() as { output?: { task_status?: string; video_url?: string; code?: string; message?: string } }
  const status = j.output?.task_status
  if (status === 'PENDING') return { state: 'queued' }
  if (status === 'RUNNING') return { state: 'running' }
  if (status === 'SUCCEEDED') {
    const url = j.output?.video_url
    // The result sits on Alibaba's object storage; anything else is refused and never downloaded.
    if (!isPublicHttpsUrl(url, ['aliyuncs.com'])) return { state: 'failed', error: 'DashScope devolvió el vídeo en un dominio no permitido. No se ha guardado nada.' }
    return { state: 'done', videoUrl: url }
  }
  return { state: 'failed', error: `DashScope: ${(j.output?.message || j.output?.code || status || 'error desconocido').slice(0, 200)}. Los fallos no consumen cuota.` }
}
