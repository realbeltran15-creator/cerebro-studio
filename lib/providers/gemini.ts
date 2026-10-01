import type { GeneratedAsset, ProviderContext } from './types'

/**
 * Google Gemini API (server-only, GEMINI_API_KEY) — the official way to use Google's generation
 * models (the ones behind Google Flow) from an application. Endpoints per ai.google.dev, 2026-10-01.
 */
const API = 'https://generativelanguage.googleapis.com/v1beta'
const key = () => process.env.GEMINI_API_KEY?.trim() ?? ''
export const geminiConfigured = () => Boolean(key())
const headers = () => ({ 'x-goog-api-key': key(), 'Content-Type': 'application/json' })

export const geminiVoices = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Achernar', 'Rasalgethi', 'Laomedeia', 'Gacrux', 'Alnilam', 'Schedar', 'Zubenelgenubi', 'Sadaltager', 'Pulcherrima', 'Achird', 'Sadachbia', 'Vindemiatrix', 'Sulafat'] as const

/** Text-to-speech through the Interactions API; returns WAV (24 kHz mono 16-bit). */
export async function geminiSpeech(context: ProviderContext, text: string, voice: string, style?: string): Promise<GeneratedAsset> {
  if (!geminiConfigured()) throw new Error('Gemini API is not configured.')
  const model = 'gemini-3.8-flash-tts'
  const v = (geminiVoices as readonly string[]).includes(voice) ? voice : 'Charon'
  const content: Record<string, unknown> = { type: 'text', text: text.slice(0, 4000) }
  if (style?.trim()) content.annotations = [{ type: 'speech_metadata', style: style.trim().slice(0, 500) }]
  const r = await fetch(`${API}/interactions`, {
    method: 'POST', headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ model, input: [{ type: 'user_input', content: [content] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: v }] } }),
  })
  if (!r.ok) throw new Error(`Gemini TTS failed (${r.status}).`)
  const j = await r.json() as { steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string }> }>; usage?: Record<string, unknown> }
  const audio = (j.steps ?? []).filter(s => s.type === 'model_output').flatMap(s => s.content ?? []).filter(c => c.type === 'audio' && c.data).pop()
  if (!audio?.data) throw new Error('Gemini TTS returned no audio.')
  return { provider: 'gemini', mimeType: 'audio/wav', uri: `data:audio/wav;base64,${audio.data}`, metadata: { model, voice: v, style: style?.trim().slice(0, 300) || null, text: text.slice(0, 200), usage: j.usage ?? null } }
}

export type VeoJob = { operation: string; model: string }

/** Starts a Veo generation (long-running operation). */
export async function veoSubmit(model: string, prompt: string, o: { aspectRatio: '16:9' | '9:16'; durationSeconds: 4 | 6 | 8; negativePrompt?: string }): Promise<VeoJob> {
  if (!geminiConfigured()) throw new Error('Gemini API is not configured.')
  if (!/^veo-[a-z0-9.-]+$/.test(model)) throw new Error('Invalid Veo model.')
  const parameters: Record<string, unknown> = { aspectRatio: o.aspectRatio, durationSeconds: String(o.durationSeconds), resolution: '720p', personGeneration: 'allow_adult' }
  if (o.negativePrompt?.trim()) parameters.negativePrompt = o.negativePrompt.trim().slice(0, 1000)
  const r = await fetch(`${API}/models/${model}:predictLongRunning`, {
    method: 'POST', headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ instances: [{ prompt: prompt.slice(0, 4000) }], parameters }),
  })
  if (!r.ok) throw new Error(`Veo rechazó la solicitud (${r.status}).`)
  const j = await r.json() as { name?: string }
  if (!j.name || !/^models\/[a-z0-9.-]+\/operations\/[A-Za-z0-9_-]+$/.test(j.name)) throw new Error('Veo no devolvió una operación válida.')
  return { operation: j.name, model }
}

export type VeoStatus = { state: 'running' } | { state: 'done'; videoUri: string } | { state: 'failed'; error: string }

export async function veoStatus(job: VeoJob): Promise<VeoStatus> {
  if (!/^models\/[a-z0-9.-]+\/operations\/[A-Za-z0-9_-]+$/.test(job.operation)) throw new Error('Invalid Veo operation.')
  const r = await fetch(`${API}/${job.operation}`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`Veo status ${r.status}.`)
  const j = await r.json() as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }>; raiMediaFilteredReasons?: string[] } } }
  if (!j.done) return { state: 'running' }
  if (j.error) return { state: 'failed', error: j.error.message?.slice(0, 300) ?? 'Veo devolvió un error.' }
  const uri = j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
  if (!uri) return { state: 'failed', error: j.response?.generateVideoResponse?.raiMediaFilteredReasons?.[0]?.slice(0, 300) ?? 'Veo terminó sin vídeo (posible filtro de seguridad).' }
  return { state: 'done', videoUri: uri }
}

/** Downloads the video (the URI needs the API key) and returns it as a data URI for the private bucket. */
export async function veoDownload(videoUri: string): Promise<string> {
  const u = new URL(videoUri)
  if (u.protocol !== 'https:' || u.hostname !== 'generativelanguage.googleapis.com') throw new Error('Unexpected Veo download host.')
  // The key is only sent to Google's API host; a redirect to storage is followed without it.
  let r = await fetch(u, { headers: { 'x-goog-api-key': key() }, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(90000) })
  const location = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null
  if (location) {
    const next = new URL(location, u)
    if (next.protocol !== 'https:' || !/(^|\.)(googleapis\.com|googleusercontent\.com)$/.test(next.hostname)) throw new Error('Unexpected Veo redirect host.')
    r = await fetch(next, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(90000) })
  }
  if (!r.ok) throw new Error(`No se pudo descargar el vídeo de Veo (${r.status}).`)
  const bytes = Buffer.from(await r.arrayBuffer())
  if (!bytes.length || bytes.byteLength > 200 * 1024 * 1024) throw new Error('Tamaño de vídeo no válido.')
  return `data:video/mp4;base64,${bytes.toString('base64')}`
}
