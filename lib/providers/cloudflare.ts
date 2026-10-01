import type { GeneratedAsset, ProviderContext } from './types'

/**
 * Cloudflare Workers AI (server-only). Free daily allowance of 10,000 neurons on Free and Paid
 * plans; nothing here can exceed it on the Free plan because Cloudflare refuses the request.
 * REST: POST /client/v4/accounts/{account}/ai/run/{model} with a Bearer API token.
 */
const account = () => process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? ''
const token = () => process.env.CLOUDFLARE_API_TOKEN?.trim() ?? ''
export const cloudflareConfigured = () => Boolean(account() && token())

async function run(model: string, input: Record<string, unknown>) {
  if (!cloudflareConfigured()) throw new Error('Cloudflare Workers AI is not configured.')
  if (!/^@cf\/[a-z0-9-]+\/[a-z0-9.-]+$/i.test(model)) throw new Error('Invalid Cloudflare model.')
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account())}/ai/run/${model}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input), cache: 'no-store', signal: AbortSignal.timeout(90000),
  })
  if (!r.ok) throw new Error(`Cloudflare Workers AI failed (${r.status}).`)
  return r
}

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
  return `data:${fallbackMime};base64,${b64}`
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
