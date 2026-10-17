/**
 * Speech-to-text for subtitles (server-only). Quality first: whisper-large-v3 (lower word error rate)
 * is preferred; the turbo variants are used as fallbacks. All options below have free allowances.
 * Groq: OpenAI-compatible /audio/transcriptions, free plan 20 req/day, 25 MB per file.
 * Cloudflare Workers AI: @cf/openai/whisper-large-v3-turbo, base64 audio, inside the 10k neurons/day.
 */
import type { CostTier } from './directory'

export type Segment = { start: number; end: number; text: string }
export type Transcript = { text: string; segments: Segment[]; language: string | null; provider: string; model: string; tier: CostTier }

export type SttModel = { id: string; label: string; quality: 1 | 2 | 3 | 4 | 5; tier: CostTier; env: string[]; maxBytes: number; note: string }
export const sttModels: SttModel[] = [
  { id: 'groq:whisper-large-v3', label: 'Whisper large v3 (Groq)', quality: 5, tier: 'freemium', env: ['GROQ_API_KEY'], maxBytes: 25 * 1024 * 1024, note: 'Mayor precisión (WER 10,3 %). Gratis con límites; después $0.111/hora.' },
  { id: 'groq:whisper-large-v3-turbo', label: 'Whisper large v3 turbo (Groq)', quality: 4, tier: 'freemium', env: ['GROQ_API_KEY'], maxBytes: 25 * 1024 * 1024, note: 'Más rápido, algo menos preciso (WER 12 %). Gratis con límites; después $0.04/hora.' },
  { id: 'cloudflare:@cf/openai/whisper-large-v3-turbo', label: 'Whisper large v3 turbo (Cloudflare)', quality: 4, tier: 'free', env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], maxBytes: 20 * 1024 * 1024, note: 'Dentro del cupo gratuito diario de Workers AI.' },
]

export const sttConfigured = (m: SttModel, env: Record<string, string | undefined> = process.env) => m.env.every(n => Boolean(env[n]?.trim()))

/** Configured models, best quality first (subtitles must be accurate), then free over freemium. */
export function routeStt(env: Record<string, string | undefined> = process.env) {
  const rank: Record<CostTier, number> = { free: 0, local: 0, freemium: 1, credits: 1, paid: 2 }
  return sttModels.filter(m => sttConfigured(m, env)).sort((a, b) => b.quality - a.quality || rank[a.tier] - rank[b.tier])
}

async function groq(model: string, audio: Blob, filename: string, language?: string): Promise<Omit<Transcript, 'provider' | 'model' | 'tier'>> {
  const form = new FormData()
  form.set('file', audio, filename)
  form.set('model', model)
  form.set('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  if (language) form.set('language', language)
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY?.trim() ?? ''}` }, body: form, signal: AbortSignal.timeout(180000) })
  if (!r.ok) throw Object.assign(new Error(`Groq STT ${r.status}`), { status: r.status })
  const j = await r.json() as { text?: string; language?: string; segments?: Array<{ start: number; end: number; text: string }> }
  return { text: (j.text ?? '').trim(), language: j.language ?? language ?? null, segments: (j.segments ?? []).map(s => ({ start: s.start, end: s.end, text: s.text.trim() })).filter(s => s.text) }
}

async function cloudflare(audio: Blob, language?: string): Promise<Omit<Transcript, 'provider' | 'model' | 'tier'>> {
  const bytes = Buffer.from(await audio.arrayBuffer())
  const body: Record<string, unknown> = { audio: bytes.toString('base64'), task: 'transcribe', vad_filter: true }
  if (language) body.language = language
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '')}/ai/run/@cf/openai/whisper-large-v3-turbo`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN?.trim() ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
  })
  if (!r.ok) throw Object.assign(new Error(`Cloudflare STT ${r.status}`), { status: r.status })
  const j = await r.json() as { result?: { text?: string; segments?: Array<{ start: number; end: number; text: string }>; transcription_info?: { language?: string } } }
  const res = j.result ?? {}
  return { text: (res.text ?? '').trim(), language: res.transcription_info?.language ?? language ?? null, segments: (res.segments ?? []).map(s => ({ start: s.start, end: s.end, text: s.text.trim() })).filter(s => s.text) }
}

/** Transcribes with the best configured model, falling back to the next one on failure. */
export async function transcribe(audio: Blob, filename: string, language?: string, only?: string): Promise<Transcript & { attempts: string[] }> {
  const attempts: string[] = []
  const candidates = routeStt().filter(m => !only || m.id === only)
  if (!candidates.length) throw new Error('No hay ningún proveedor de transcripción configurado (GROQ_API_KEY o Cloudflare Workers AI).')
  for (const m of candidates) {
    if (audio.size > m.maxBytes) { attempts.push(`${m.id}: archivo demasiado grande`); continue }
    try {
      const [provider, model] = [m.id.split(':')[0], m.id.slice(m.id.indexOf(':') + 1)]
      const t = provider === 'groq' ? await groq(model, audio, filename, language) : await cloudflare(audio, language)
      if (!t.text) throw new Error('transcripción vacía')
      return { ...t, provider, model, tier: m.tier, attempts }
    } catch (error) { attempts.push(`${m.id}: ${error instanceof Error ? error.message : 'error'}`) }
  }
  throw Object.assign(new Error('Ningún proveedor pudo transcribir el archivo.'), { attempts })
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0')
function stamp(sec: number, sep: ',' | '.') {
  const s = Math.max(0, sec)
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}${sep}${pad(Math.round((s % 1) * 1000) % 1000, 3)}`
}

export function toSrt(segments: Segment[]) {
  return segments.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text}\n`).join('\n')
}

export function toVtt(segments: Segment[]) {
  return `WEBVTT\n\n${segments.map(s => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text}\n`).join('\n')}`
}
