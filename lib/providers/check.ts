import { checkFalConnection } from './fal-queue'
import { topmediaiConfigured, topmediaiKeyInfo } from './topmediai'

/**
 * Connection checks that cost nothing and never generate anything. They run on the server so the keys
 * never reach the browser, and the answers never contain a key. Each one uses an endpoint whose purpose
 * is to validate or inspect the credential itself:
 *  - Cloudflare: GET /user/tokens/verify (token status).
 *  - Gemini: GET /models (lists models; no generation).
 *  - TopMediai: GET /v1/get_api_key_info (remaining quota for the key).
 *  - fal.ai: an empty body that fal rejects with 422 after validating the key.
 */
export type CheckProvider = 'fal' | 'cloudflare' | 'gemini' | 'topmediai'
export type CheckResult = { state: 'ok' | 'not_configured' | 'invalid_key' | 'no_access' | 'unreachable' | 'unexpected'; message: string; details?: Record<string, string | number | boolean | null> }

export const checkable: CheckProvider[] = ['fal', 'cloudflare', 'gemini', 'topmediai']

export async function checkCloudflare(): Promise<CheckResult> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim(), account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  if (!token || !account) return { state: 'not_configured', message: 'Faltan CLOUDFLARE_ACCOUNT_ID y/o CLOUDFLARE_API_TOKEN en este despliegue.' }
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
    if (r.status === 401 || r.status === 403) return { state: 'invalid_key', message: `Cloudflare no acepta el token (${r.status}).` }
    const j = await r.json().catch(() => null) as { success?: boolean; result?: { status?: string } } | null
    if (r.ok && j?.success && j.result?.status === 'active') return { state: 'ok', message: 'Token de Cloudflare activo. Esta comprobación no usa neuronas; el permiso «Workers AI» solo se confirma al generar.', details: { status: 'active' } }
    return { state: 'unexpected', message: `Respuesta inesperada de Cloudflare (${r.status}${j?.result?.status ? `, ${j.result.status}` : ''}).` }
  } catch { return { state: 'unreachable', message: 'No se pudo contactar con api.cloudflare.com desde el servidor.' } }
}

export async function checkGemini(): Promise<CheckResult> {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) return { state: 'not_configured', message: 'GEMINI_API_KEY no está definida en este despliegue.' }
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
    if (r.status === 400 || r.status === 401 || r.status === 403) return { state: 'invalid_key', message: `Gemini no acepta la clave (${r.status}).` }
    if (!r.ok) return { state: 'unexpected', message: `Respuesta inesperada de Gemini (${r.status}).` }
    const names = ((await r.json().catch(() => ({}))) as { models?: Array<{ name?: string }> }).models?.map(m => String(m.name ?? '')) ?? []
    const has = (re: RegExp) => names.filter(n => re.test(n)).length
    return {
      state: 'ok',
      message: 'Clave de Gemini válida. Listar modelos no genera nada ni consume cupo. Ojo: que un modelo aparezca en la lista no significa que tengas cupo gratuito para usarlo (imagen, Veo y Lyria exigen facturación).',
      details: { models: names.length, imageModels: has(/image|banana/), videoModels: has(/veo/), musicModels: has(/lyria/), ttsModels: has(/tts/) },
    }
  } catch { return { state: 'unreachable', message: 'No se pudo contactar con generativelanguage.googleapis.com desde el servidor.' } }
}

export async function checkTopMediai(): Promise<CheckResult> {
  if (!topmediaiConfigured()) return { state: 'not_configured', message: 'TOPMEDIAI_API_KEY no está definida. La API de TopMediai se contrata aparte de tus suscripciones.' }
  try {
    const info = await topmediaiKeyInfo()
    return { state: 'ok', message: 'Clave de TopMediai aceptada. Consultar la cuota de la clave no consume créditos.', details: info.fields }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (/ 40[13]\b|\(40[13]\)|respondió 40[13]/.test(m)) return { state: 'invalid_key', message: `TopMediai no acepta la clave: ${m}` }
    return { state: 'unreachable', message: `No se pudo consultar TopMediai: ${m || 'sin respuesta'}` }
  }
}

export async function runCheck(provider: CheckProvider): Promise<CheckResult> {
  switch (provider) {
    case 'fal': { const r = await checkFalConnection(); return { state: r.state as CheckResult['state'], message: r.message } }
    case 'cloudflare': return checkCloudflare()
    case 'gemini': return checkGemini()
    case 'topmediai': return checkTopMediai()
  }
}
