import type { GeneratedAsset, ProviderContext } from './types'
import type { ReferenceImage } from './references'

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
  // durationSeconds must be a JSON number: a string is rejected with INVALID_ARGUMENT (checked live 2026-10-10).
  const parameters: Record<string, unknown> = { aspectRatio: o.aspectRatio, durationSeconds: o.durationSeconds, resolution: '720p', personGeneration: 'allow_adult' }
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

export type GeminiImageOptions = { aspectRatio: '16:9' | '9:16' | '1:1'; references?: ReferenceImage[]; imageSize?: '1K' | '2K' | '4K' }

/**
 * Nano Banana models through generateContent. Paid only: with a free-tier key every image model
 * answers 429 (checked 2026-10-10), which the route reports as "cupo gratuito agotado / sin saldo".
 * Reference images travel as inline_data parts after the text.
 */
export async function geminiImage(context: ProviderContext, model: string, prompt: string, o: GeminiImageOptions): Promise<GeneratedAsset> {
  if (!geminiConfigured()) throw new Error('Gemini API is not configured.')
  if (!/^[a-z0-9.-]+$/.test(model)) throw new Error('Invalid Gemini image model.')
  const parts: Array<Record<string, unknown>> = [{ text: prompt.slice(0, 8000) }]
  for (const r of (o.references ?? []).slice(0, 14)) parts.push({ inlineData: { mimeType: r.mime, data: r.bytes.toString('base64') } })
  const imageConfig: Record<string, unknown> = { aspectRatio: o.aspectRatio }
  if (o.imageSize) imageConfig.imageSize = o.imageSize
  const r = await fetch(`${API}/models/${model}:generateContent`, {
    method: 'POST', headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(150000),
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig } }),
  })
  if (!r.ok) throw new Error(`Gemini image failed (${r.status}).`)
  const j = await r.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; thought?: boolean }> } }>; promptFeedback?: { blockReason?: string }; usageMetadata?: Record<string, unknown> }
  const candidate = j.candidates?.[0]
  const image = (candidate?.content?.parts ?? []).filter(p => p.inlineData?.data && !p.thought).pop()?.inlineData
  if (!image?.data) {
    const why = j.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'sin imagen'
    throw new Error(`Gemini no devolvió imagen (${String(why).slice(0, 60)}): puede ser un filtro de seguridad. No se ha guardado nada.`)
  }
  const mime = image.mimeType && /^image\/(png|jpeg|webp)$/.test(image.mimeType) ? image.mimeType : 'image/png'
  return { provider: 'gemini', mimeType: mime, uri: `data:${mime};base64,${image.data}`, metadata: { model, aspectRatio: o.aspectRatio, references: (o.references ?? []).map(x => x.assetId), usage: j.usageMetadata ?? null } }
}

/**
 * Video understanding of a PUBLIC YouTube URL through the official Gemini API (the API fetches the video itself;
 * Cerebro never downloads it). Checked live 2026-10-10 on the free key. Returns the model's JSON text.
 */
export async function geminiAnalyzeYouTube(youtubeUrl: string, prompt: string, model = 'gemini-3.8-flash'): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  if (!geminiConfigured()) throw Object.assign(new Error('Gemini API is not configured.'), { status: 0 })
  if (!/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(youtubeUrl)) throw new Error('Invalid YouTube URL.')
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new Error('Invalid Gemini model.')
  const r = await fetch(`${API}/models/${model}:generateContent`, {
    method: 'POST', headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ contents: [{ parts: [{ fileData: { fileUri: youtubeUrl } }, { text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
  })
  if (!r.ok) throw Object.assign(new Error(`Gemini ${r.status}`), { status: r.status })
  const j = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
  const text = (j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('')
  if (!text) throw new Error('Gemini no devolvió texto.')
  return { text, inputTokens: j.usageMetadata?.promptTokenCount ?? null, outputTokens: j.usageMetadata?.candidatesTokenCount ?? null }
}
