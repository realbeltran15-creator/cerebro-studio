import { detectPauses, pcmToWav, pcmSeconds, sampleRateFromMime, trimSilence } from './wav'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Cuota del plan gratuito agotada: el Short de hoy se descarta, nunca se pasa a un plan de pago. */
export class FreeTierExhausted extends Error {
  constructor(message = 'Cuota gratuita de Gemini agotada') { super(message); this.name = 'FreeTierExhausted' }
}

export const textModel = () => process.env.GEMINI_TEXT_MODEL?.trim() || 'gemini-3.8-flash'
export const ttsModel = () => process.env.GEMINI_TTS_MODEL?.trim() || 'gemini-2.5-flash-preview-tts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const BACKOFF_MS = [2000, 6000]

async function call(model: string, body: unknown, attempt = 0): Promise<any> {
  const key = process.env.GEMINI_API_KEY?.trim()
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-goog-api-key': key } : {}) },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(90_000),
  })
  if (res.status === 429) throw new FreeTierExhausted()
  if (res.status >= 500 && attempt < BACKOFF_MS.length) { await sleep(BACKOFF_MS[attempt]); return call(model, body, attempt + 1) }
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gemini ${model} ${res.status}: ${json?.error?.message ?? 'error'}`)
  return json
}

/** JSON estructurado con el modelo de texto gratuito. Sin herramientas de pago (sin grounding). */
export async function generateJson<T>(prompt: string, temperature = 0.7): Promise<T> {
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature } }
  let json: any
  let last: unknown
  // Si el modelo principal está saturado (5xx), se prueba otro modelo gratuito antes de rendirse.
  for (const model of [...new Set([textModel(), 'gemini-flash-latest', 'gemini-3.5-flash'])]) {
    try { json = await call(model, body); break } catch (e) {
      if (e instanceof FreeTierExhausted) throw e
      last = e
    }
  }
  if (!json) throw last instanceof Error ? last : new Error('Gemini no disponible')
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim()
  if (!text) throw new Error(`Gemini devolvió vacío (${json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? 'sin motivo'})`)
  try { return JSON.parse(text) as T } catch { throw new Error('Gemini no devolvió JSON válido') }
}

/** Voz con Gemini TTS (tier gratuito). Devuelve WAV recortado de silencios y su duración real. */
export async function synthesizeSpeech(text: string, voiceName: string) {
  const json = await call(ttsModel(), {
    contents: [{ parts: [{ text: `Lee en español de España, con voz clara, ritmo ágil y tono de curiosidad: ${text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  })
  const inline = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData
  if (!inline?.data) throw new Error('Gemini TTS no devolvió audio')
  const rate = sampleRateFromMime(inline.mimeType)
  const pcm = trimSilence(new Uint8Array(Buffer.from(inline.data, 'base64')), rate)
  return { wav: pcmToWav(pcm, rate), seconds: pcmSeconds(pcm, rate), sampleRate: rate, pauses: detectPauses(pcm, rate) }
}
