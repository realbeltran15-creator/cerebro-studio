import type { GeneratedAsset, ProviderContext } from './types'
import type { ReferenceImage } from './references'

/**
 * Cloudflare Workers AI (server-only). Free daily allowance of 10,000 neurons on Free and Paid
 * plans; nothing here can exceed it on the Free plan because Cloudflare refuses the request.
 * REST: POST /client/v4/accounts/{account}/ai/run/{model} with a Bearer API token.
 */
const account = () => process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? ''
const token = () => process.env.CLOUDFLARE_API_TOKEN?.trim() ?? ''
export const cloudflareConfigured = () => Boolean(account() && token())

/** JSON for most models; multipart/form-data for FLUX.2 (the boundary header is set by fetch itself). */
async function run(model: string, input: Record<string, unknown> | FormData) {
  if (!cloudflareConfigured()) throw new Error('Cloudflare Workers AI is not configured.')
  if (!/^@cf\/[a-z0-9-]+\/[a-z0-9.-]+$/i.test(model)) throw new Error('Invalid Cloudflare model.')
  const multipart = input instanceof FormData
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account())}/ai/run/${model}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}`, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? input : JSON.stringify(input), cache: 'no-store', signal: AbortSignal.timeout(120000),
  })
  if (!r.ok) {
    // 429 = daily free allocation used (code 3036) or no capacity (3040); 403 = the model needs the Workers Paid plan (5035).
    const detail = await r.json().then(j => JSON.stringify((j as { errors?: unknown }).errors ?? '').slice(0, 160)).catch(() => '')
    throw new Error(`Cloudflare Workers AI failed (${r.status}).${detail && detail !== '""' ? ` ${detail}` : ''}`)
  }
  return r
}

/** PNG and JPEG are told apart by their first bytes; base64 of 0x89 'PNG' starts with "iVBOR", of 0xFF 0xD8 with "/9j/". */
export const sniffImageMime = (b64: string) => (b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('UklGR') ? 'image/webp' : 'image/jpeg')

/** Media may come back as raw bytes or as base64 inside {result:{<field>}} depending on the model. */
async function media(r: Response, field: string, fallbackMime: string) {
  const type = r.headers.get('content-type')?.split(';')[0] ?? ''
  if (!type.includes('json')) {
    const bytes = Buffer.from(await r.arrayBuffer())
    if (!bytes.length) throw new Error('Cloudflare returned an empty file.')
    return `data:${type || fallbackMime};base64,${bytes.toString('base64')}`
  }
  const j = await r.json() as { result?: Record<string, unknown>; success?: boolean }
  const b64 = j.result?.[field]
  if (typeof b64 !== 'string' || !b64) throw new Error('Cloudflare returned no media.')
  return `data:${fallbackMime.startsWith('image/') ? sniffImageMime(b64) : fallbackMime};base64,${b64}`
}

export async function cloudflareImage(context: ProviderContext, prompt: string): Promise<GeneratedAsset> {
  const model = '@cf/black-forest-labs/flux-1-schnell'
  const r = await run(model, { prompt: prompt.slice(0, 2048), steps: 8 })
  return { provider: 'cloudflare', mimeType: 'image/jpeg', uri: await media(r, 'image', 'image/jpeg'), metadata: { model, steps: 8, costTier: 'free_allowance' } }
}

export async function cloudflareSpeech(context: ProviderContext, text: string, lang = 'es'): Promise<GeneratedAsset> {
  const model = '@cf/myshell-ai/melotts'
  const r = await run(model, { prompt: text.slice(0, 4000), lang })
  return { provider: 'cloudflare', mimeType: 'audio/mpeg', uri: await media(r, 'audio', 'audio/mpeg'), metadata: { model, lang, text: text.slice(0, 200), costTier: 'free_allowance' } }
}

/**
 * FLUX.2 [klein] on Workers AI. Request is multipart even without references; reference images are the
 * fields input_image_0…3 and must be 512×512 or smaller (the caller shrinks them). Steps are fixed by the model.
 */
export async function cloudflareFlux2Image(context: ProviderContext, model: '@cf/black-forest-labs/flux-2-klein-4b' | '@cf/black-forest-labs/flux-2-klein-9b', prompt: string, o: { width: number; height: number; references?: ReferenceImage[]; seed?: number }): Promise<GeneratedAsset> {
  const refs = (o.references ?? []).slice(0, 4)
  const form = new FormData()
  form.append('prompt', prompt.slice(0, 4000))
  form.append('width', String(Math.min(1920, Math.max(256, Math.round(o.width / 16) * 16))))
  form.append('height', String(Math.min(1920, Math.max(256, Math.round(o.height / 16) * 16))))
  if (typeof o.seed === 'number') form.append('seed', String(Math.trunc(o.seed)))
  refs.forEach((r, i) => form.append(`input_image_${i}`, new Blob([new Uint8Array(r.bytes)], { type: r.mime }), `reference-${i}.${r.mime === 'image/png' ? 'png' : 'jpg'}`))
  const r = await run(model, form)
  const uri = await media(r, 'image', 'image/jpeg')
  return { provider: 'cloudflare', mimeType: uri.slice(5, uri.indexOf(';')), uri, metadata: { model, width: o.width, height: o.height, references: refs.map(x => x.assetId), costTier: 'free_allowance' } }
}
