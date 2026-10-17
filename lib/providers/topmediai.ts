import { isPublicHttpsUrl } from './safe-url'
import type { GeneratedAsset, ProviderContext } from './types'

/**
 * TopMediai official API (server-only, TOPMEDIAI_API_KEY).
 *
 * What is documented (docs.topmediai.com, read through a search engine on 2026-10-10):
 *  - Auth: header `x-api-key`.
 *  - POST /v1/text2speech  {text (1–500 chars), speaker (voice id), emotion?}
 *  - GET  /v1/get_api_key_info  → remaining quota per service for that key (no generation cost).
 *  - Music: POST /v2/submit … plus task-detail endpoints (not wired: their exact paths/response were not confirmed).
 *  - There is NO sound-effects API (web tool only).
 *
 * STATUS: unverified. The response of text2speech was not seen anywhere, so the parser accepts raw audio
 * or JSON with a URL under a few common keys and otherwise fails loudly. Run the free check
 * (`topmediaiKeyInfo`) first. The API is bought separately from the consumer subscriptions.
 */
const BASE = 'https://api.topmediai.com'
const key = () => process.env.TOPMEDIAI_API_KEY?.trim() ?? ''
export const topmediaiConfigured = () => Boolean(key())
export const TOPMEDIAI_MAX_CHARS = 500

const headers = () => ({ 'x-api-key': key(), 'Content-Type': 'application/json' })

/** Reads the key's remaining quota. Costs nothing. Only numeric/status fields are returned; the key itself is never echoed. */
export async function topmediaiKeyInfo(): Promise<{ ok: boolean; fields: Record<string, string | number | boolean | null>; raw?: undefined }> {
  if (!topmediaiConfigured()) throw new Error('TopMediai no está configurado.')
  const r = await fetch(`${BASE}/v1/get_api_key_info`, { headers: { 'x-api-key': key() }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`TopMediai respondió ${r.status}.`)
  const j = await r.json().catch(() => null) as Record<string, unknown> | null
  const body = j && typeof j.data === 'object' && j.data ? j.data as Record<string, unknown> : j ?? {}
  const fields: Record<string, string | number | boolean | null> = {}
  for (const [k, v] of Object.entries(body)) {
    if (/key$|^x_api_key|token|secret|email/i.test(k)) continue
    if (typeof v === 'number' || typeof v === 'boolean' || v === null || (typeof v === 'string' && v.length <= 60)) fields[k] = v
  }
  return { ok: true, fields }
}

const URL_KEYS = ['oss_url', 'audio_url', 'url', 'file_url', 'download_url', 'audio']

/** Finds an audio URL in the places APIs of this kind usually put it. Exported for tests. */
export function findAudioUrl(json: unknown): string | null {
  const roots: unknown[] = [json]
  if (json && typeof json === 'object') roots.push((json as Record<string, unknown>).data, (json as Record<string, unknown>).result)
  for (const root of roots) {
    if (typeof root === 'string' && /^https:\/\//.test(root)) return root
    if (root && typeof root === 'object') for (const k of URL_KEYS) { const v = (root as Record<string, unknown>)[k]; if (typeof v === 'string' && /^https:\/\//.test(v)) return v }
  }
  return null
}

export async function topmediaiSpeech(context: ProviderContext, text: string, speaker: string, emotion?: string): Promise<GeneratedAsset> {
  if (!topmediaiConfigured()) throw new Error('TopMediai no está configurado.')
  const clean = text.trim()
  if (!clean || clean.length > TOPMEDIAI_MAX_CHARS) throw new Error(`TopMediai admite entre 1 y ${TOPMEDIAI_MAX_CHARS} caracteres por petición (rechazó el texto).`)
  const voice = speaker.trim() || process.env.TOPMEDIAI_SPEAKER?.trim() || ''
  if (!voice || voice.length > 80) throw new Error('Falta el ID del speaker de TopMediai (campo de voz o TOPMEDIAI_SPEAKER) (no válido).')
  const r = await fetch(`${BASE}/v1/text2speech`, {
    method: 'POST', headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ text: clean, speaker: voice, ...(emotion?.trim() ? { emotion: emotion.trim().slice(0, 40) } : {}) }),
  })
  if (!r.ok) throw new Error(`TopMediai text2speech failed (${r.status}).`)
  const type = r.headers.get('content-type')?.split(';')[0] ?? ''
  const meta = { speaker: voice, emotion: emotion?.trim() || null, characters: clean.length, text: clean.slice(0, 200), unverifiedResponse: true }
  if (type.startsWith('audio/')) {
    const bytes = Buffer.from(await r.arrayBuffer())
    if (!bytes.length) throw new Error('TopMediai devolvió audio vacío.')
    return { provider: 'topmediai', mimeType: type, uri: `data:${type};base64,${bytes.toString('base64')}`, metadata: meta }
  }
  const json = await r.json().catch(() => null)
  const url = findAudioUrl(json)
  if (!isPublicHttpsUrl(url)) {
    const shape = json && typeof json === 'object' ? Object.keys(json as object).slice(0, 8).join(', ') : typeof json
    throw new Error(`TopMediai respondió con un formato que no se reconoce (campos: ${shape}). No se ha guardado nada; se necesita una respuesta real para ajustar el adaptador.`)
  }
  return { provider: 'topmediai', mimeType: /\.wav(\?|$)/i.test(url) ? 'audio/wav' : 'audio/mpeg', uri: url, metadata: meta }
}
