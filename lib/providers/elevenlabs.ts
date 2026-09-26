import type { GeneratedAsset, ProviderContext, ProviderHealth, VoiceProvider } from './types'

/**
 * ElevenLabs adapters (server-only, ELEVENLABS_API_KEY).
 * Voice: text-to-speech with a multilingual model. SFX: sound-effect generation from a text prompt.
 * Both return audio as data URIs so persistGeneratedAsset stores them in the private bucket.
 */

const API = 'https://api.elevenlabs.io/v1'
const key = () => process.env.ELEVENLABS_API_KEY?.trim() ?? ''
export const elevenLabsConfigured = () => Boolean(key())

async function audio(path: string, body: Record<string, unknown>, requestId: string) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', Accept: 'audio/mpeg', 'X-Request-Id': requestId },
    body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(120000),
  })
  if (!response.ok) throw new Error(`ElevenLabs request failed (${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.byteLength > 25 * 1024 * 1024) throw new Error('ElevenLabs returned invalid audio size.')
  return `data:audio/mpeg;base64,${bytes.toString('base64')}`
}

export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly id = 'elevenlabs-voice'
  async health(): Promise<ProviderHealth> { return elevenLabsConfigured() ? 'ready' : 'unconfigured' }
  async synthesize(context: ProviderContext, text: string, voice?: string): Promise<GeneratedAsset> {
    if (!elevenLabsConfigured()) throw new Error('ElevenLabs is not configured.')
    // Voice ids are 20-char alphanumerics; anything else falls back to the configured default.
    const voiceId = voice && /^[A-Za-z0-9]{20}$/.test(voice) ? voice : process.env.ELEVENLABS_VOICE_ID?.trim()
    if (!voiceId) throw new Error('ElevenLabs needs ELEVENLABS_VOICE_ID or a voice id.')
    const model = process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2'
    const uri = await audio(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { text, model_id: model }, context.requestId)
    return { provider: this.id, mimeType: 'audio/mpeg', uri, metadata: { model, voiceId, text: text.slice(0, 200) } }
  }
}

export async function generateSoundEffect(context: ProviderContext, prompt: string, durationSeconds?: number): Promise<GeneratedAsset> {
  if (!elevenLabsConfigured()) throw new Error('ElevenLabs is not configured.')
  const body: Record<string, unknown> = { text: prompt, prompt_influence: 0.4 }
  if (durationSeconds) body.duration_seconds = Math.min(Math.max(durationSeconds, 0.5), 22)
  const uri = await audio('/sound-generation', body, context.requestId)
  return { provider: 'elevenlabs-sfx', mimeType: 'audio/mpeg', uri, metadata: { prompt: prompt.slice(0, 300), durationSeconds: body.duration_seconds ?? null } }
}

export type ElevenVoice = { voice_id: string; name: string; labels?: Record<string, string> }

export async function listVoices(): Promise<ElevenVoice[]> {
  if (!elevenLabsConfigured()) return []
  const r = await fetch(`${API}/voices`, { headers: { 'xi-api-key': key() }, cache: 'no-store' })
  if (!r.ok) throw new Error(`ElevenLabs voices failed (${r.status}).`)
  const j = await r.json() as { voices?: ElevenVoice[] }
  return (j.voices ?? []).map(v => ({ voice_id: v.voice_id, name: v.name, labels: v.labels }))
}
