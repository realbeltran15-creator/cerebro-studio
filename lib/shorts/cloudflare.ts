import { FreeTierExhausted } from './gemini'

export const imageModel = () => process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || '@cf/black-forest-labs/flux-1-schnell'

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

/** Imagen con Cloudflare Workers AI (neuronas gratuitas diarias). Falla en vez de pasar a de pago. */
export async function generateImage(prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
  if (!account || !token) throw new Error('Faltan CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN')
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${imageModel()}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, steps: 6 }),
    cache: 'no-store',
    signal: AbortSignal.timeout(90_000),
  })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok) {
    const detail = type.includes('json') ? JSON.stringify(await res.json().catch(() => ({}))).slice(0, 300) : ''
    // 429 o error de capacidad/cuota de neuronas: tratarlo como cuota gratuita agotada.
    if (res.status === 429 || /neurons|quota|limit/i.test(detail)) throw new FreeTierExhausted('Cuota gratuita de Cloudflare Workers AI agotada')
    throw new Error(`Cloudflare Workers AI ${res.status}: ${detail}`)
  }
  let bytes: Uint8Array
  if (type.includes('json')) {
    const json: any = await res.json()
    const b64 = json?.result?.image
    if (!b64) throw new Error('Cloudflare no devolvió imagen')
    bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  } else {
    bytes = new Uint8Array(await res.arrayBuffer())
  }
  if (bytes.length < 10_000 || !(isJpeg(bytes) || isPng(bytes))) throw new Error('Imagen inválida o demasiado pequeña')
  return { bytes, mime: isPng(bytes) ? 'image/png' : 'image/jpeg' }
}
