/**
 * Text / reasoning layer with "quality first, then cost" routing.
 *
 * Every task declares the minimum quality it needs. Among the configured models that reach it,
 * the router prefers free tiers, then included credits, then the lowest price; if a model fails
 * (quota exhausted, invalid JSON, provider error) the next eligible one is tried. A cheaper model
 * is never used for a task whose required quality it does not reach.
 *
 * Endpoints (checked 2026-10-01): OpenAI chat/completions (json_schema), Gemini Interactions API
 * (response_format with JSON schema), Groq OpenAI-compatible chat/completions (json_object).
 */
import type { CostTier } from './directory'

export type TextProvider = 'openai' | 'gemini' | 'groq' | 'gateway'
export type TextTask = 'prompt_enhance' | 'script_hooks' | 'script_draft' | 'tags' | 'packaging' | 'analysis'

export type TextModel = {
  id: string
  provider: TextProvider
  model: () => string
  label: string
  tier: CostTier
  /** 1–5. Editorial ranking for structured Spanish writing tasks; used only to decide eligibility. */
  quality: 1 | 2 | 3 | 4 | 5
  /** USD per 1M tokens (input, output) on the paid tier; null = not published / plan-dependent. */
  price: { input: number; output: number } | null
  priceNote: string
  env: string[]
}

export const textModels: TextModel[] = [
  {
    id: 'groq:openai/gpt-oss-120b', provider: 'groq', model: () => 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)', tier: 'freemium', quality: 4,
    price: { input: 0.15, output: 0.6 }, priceNote: 'Plan gratuito de Groq con límites; después $0.15/$0.60 por 1M tokens.', env: ['GROQ_API_KEY'],
  },
  {
    id: 'groq:openai/gpt-oss-20b', provider: 'groq', model: () => 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (Groq)', tier: 'freemium', quality: 3,
    price: { input: 0.075, output: 0.3 }, priceNote: 'Plan gratuito de Groq con límites; después $0.075/$0.30 por 1M tokens.', env: ['GROQ_API_KEY'],
  },
  {
    id: 'gemini:gemini-3.8-flash', provider: 'gemini', model: () => 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'freemium', quality: 4,
    price: { input: 0.75, output: 3.75 }, priceNote: 'Nivel gratuito en Gemini API, limitado a unas 20 solicitudes al día para este modelo (límite informado por la propia API el 2026-10-07; puede cambiar); de pago $0.75/$3.75 por 1M tokens (precio hasta el 31-12-2026).', env: ['GEMINI_API_KEY'],
  },
  {
    // Any OpenAI-compatible gateway (e.g. OmniRoute with model "eco-router", LiteLLM, Ollama, LM Studio).
    // Quality is declared by the owner because the gateway decides the underlying model.
    id: 'gateway:configured', provider: 'gateway', model: () => process.env.TEXT_GATEWAY_MODEL?.trim() || 'eco-router', label: 'Pasarela propia (OmniRoute u otra compatible con OpenAI)', tier: 'local',
    get quality() { const q = Number(process.env.TEXT_GATEWAY_QUALITY); return (q >= 1 && q <= 5 ? Math.round(q) : 3) as 1 | 2 | 3 | 4 | 5 },
    price: null, priceNote: 'Coste según los modelos que elija tu pasarela (OmniRoute: gratis primero). Desde Vercel solo funciona si la pasarela es accesible por HTTPS.', env: ['TEXT_GATEWAY_BASE_URL'],
  },
  {
    id: 'openai:configured', provider: 'openai', model: () => process.env.OPENAI_TEXT_MODEL?.trim() || 'gpt-4.1-mini', label: 'OpenAI (modelo configurado)', tier: 'paid', quality: 5,
    price: null, priceNote: 'Depende de OPENAI_TEXT_MODEL. Referencia: GPT-5.6 Luna $0.20/$1.20 por 1M tokens.', env: [],
  },
]

/** Minimum quality per task. Factual script writing needs the most reliable instruction following. */
export const taskQuality: Record<TextTask, { min: 1 | 2 | 3 | 4 | 5; label: string }> = {
  tags: { min: 2, label: 'Etiquetas y clasificación' },
  prompt_enhance: { min: 3, label: 'Mejorar prompts multimedia' },
  packaging: { min: 4, label: 'Títulos, descripciones y miniaturas' },
  script_hooks: { min: 4, label: 'Hooks de guion' },
  analysis: { min: 4, label: 'Análisis de vídeos y oportunidades' },
  script_draft: { min: 5, label: 'Borrador de guion con reglas factuales' },
}

const tierRank: Record<CostTier, number> = { free: 0, local: 0, freemium: 1, credits: 1, paid: 2 }

export function textConfiguredFor(m: TextModel, env: Record<string, string | undefined> = process.env) {
  if (m.provider === 'openai') return Boolean(env.OPENAI_TEXT_API_KEY?.trim() || env.OPENAI_API_KEY?.trim())
  return m.env.every(n => Boolean(env[n]?.trim()))
}

/** Eligible models for a task, best value first: same required quality, then free → credits → paid, then price. */
export function routeText(task: TextTask, env: Record<string, string | undefined> = process.env, opts: { minQuality?: number; only?: TextProvider } = {}) {
  const min = Math.max(taskQuality[task].min, opts.minQuality ?? 0)
  return textModels
    .filter(m => m.quality >= min && textConfiguredFor(m, env) && (!opts.only || m.provider === opts.only))
    .sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || (a.price?.output ?? 99) - (b.price?.output ?? 99) || b.quality - a.quality)
}

export type TextUsage = { inputTokens: number | null; outputTokens: number | null }
export type TextResult<T> = { data: T; model: TextModel; usage: TextUsage; estimatedUsd: number | null; attempts: Array<{ model: string; error: string }> }

export class TextRouteError extends Error {
  constructor(message: string, readonly attempts: Array<{ model: string; error: string }>, readonly status: number | null = null) { super(message) }
}

const openaiKey = () => process.env.OPENAI_TEXT_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || ''

async function callOpenAI(m: TextModel, system: string, user: string, schema: object, name: string, requestId: string) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${openaiKey()}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId },
    body: JSON.stringify({ model: m.model(), temperature: 0.5, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } }),
    cache: 'no-store', signal: AbortSignal.timeout(90000),
  })
  if (!r.ok) throw Object.assign(new Error(`OpenAI ${r.status}`), { status: r.status })
  const j = await r.json() as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  if (j.choices?.[0]?.message?.refusal) throw new Error('refused')
  return { text: j.choices?.[0]?.message?.content ?? '', usage: { inputTokens: j.usage?.prompt_tokens ?? null, outputTokens: j.usage?.completion_tokens ?? null } }
}

async function callGroq(m: TextModel, system: string, user: string, schema: object) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY?.trim() ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: m.model(), temperature: 0.5, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `${system}\nResponde SOLO con un objeto JSON válido que cumpla este JSON Schema:\n${JSON.stringify(schema)}` }, { role: 'user', content: user }],
    }),
    cache: 'no-store', signal: AbortSignal.timeout(90000),
  })
  if (!r.ok) throw Object.assign(new Error(`Groq ${r.status}`), { status: r.status })
  const j = await r.json() as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  return { text: j.choices?.[0]?.message?.content ?? '', usage: { inputTokens: j.usage?.prompt_tokens ?? null, outputTokens: j.usage?.completion_tokens ?? null } }
}

/** First JSON object in a model reply (gateways may wrap it in prose or code fences). */
export function extractJson(text: string) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  if (t.startsWith('{')) return t
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  return a >= 0 && b > a ? t.slice(a, b + 1) : t
}

async function callGateway(m: TextModel, system: string, user: string, schema: object) {
  const base = (process.env.TEXT_GATEWAY_BASE_URL?.trim() ?? '').replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('TEXT_GATEWAY_BASE_URL no válida')
  const key = process.env.TEXT_GATEWAY_API_KEY?.trim()
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: m.model(), temperature: 0.5, messages: [{ role: 'system', content: `${system}\nResponde SOLO con un objeto JSON válido que cumpla este JSON Schema:\n${JSON.stringify(schema)}` }, { role: 'user', content: user }] }),
    cache: 'no-store', signal: AbortSignal.timeout(120000),
  })
  if (!r.ok) throw Object.assign(new Error(`Pasarela ${r.status}`), { status: r.status })
  const j = await r.json() as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string }
  return { text: extractJson(j.choices?.[0]?.message?.content ?? ''), usage: { inputTokens: j.usage?.prompt_tokens ?? null, outputTokens: j.usage?.completion_tokens ?? null } }
}

/** Extracts the text of a Gemini Interactions response, tolerating the documented shapes. */
export function geminiOutputText(j: Record<string, unknown>): string {
  const direct = (j.output_text ?? (j.interaction as Record<string, unknown> | undefined)?.output_text)
  if (typeof direct === 'string') return direct
  const steps = Array.isArray(j.steps) ? j.steps as Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> : []
  return steps.filter(s => s.type === 'model_output').flatMap(s => s.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('')
}

/** Google answers 502/503/504 during demand spikes ("high demand… try again later"): retry the same model once. */
const TRANSIENT = new Set([502, 503, 504])

async function callGemini(m: TextModel, system: string, user: string, schema: object) {
  const send = () => fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY?.trim() ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m.model(), input: user, system_instruction: system, response_format: { type: 'text', mime_type: 'application/json', schema }, generation_config: { temperature: 0.5 } }),
    cache: 'no-store', signal: AbortSignal.timeout(90000),
  })
  let r = await send()
  if (TRANSIENT.has(r.status)) { await new Promise(done => setTimeout(done, 1500)); r = await send() }
  if (!r.ok) throw Object.assign(new Error(`Gemini ${r.status}`), { status: r.status })
  const j = await r.json() as Record<string, unknown>
  const u = (j.usage ?? j.usage_metadata ?? j.usageMetadata ?? {}) as Record<string, number | undefined>
  return { text: geminiOutputText(j), usage: { inputTokens: u.promptTokenCount ?? u.total_input_tokens ?? u.input_tokens ?? null, outputTokens: u.candidatesTokenCount ?? u.total_output_tokens ?? u.output_tokens ?? null } }
}

export function estimateTextCost(m: TextModel, usage: TextUsage) {
  if (!m.price || usage.inputTokens === null || usage.outputTokens === null) return null
  return Math.round(((usage.inputTokens * m.price.input + usage.outputTokens * m.price.output) / 1e6) * 1e6) / 1e6
}

/**
 * Runs a structured task on the best-value model that reaches its required quality, falling back
 * to the next eligible model on failure. `validate` rejects outputs that are well-formed JSON but
 * not good enough (empty fields, wrong shape) so a weaker answer is never accepted silently.
 */
export async function runTextTask<T>(task: TextTask, input: { system: string; user: string; schema: object; schemaName: string; validate: (v: unknown) => T | null; requestId: string; minQuality?: number; only?: TextProvider }): Promise<TextResult<T>> {
  const candidates = routeText(task, process.env, { minQuality: input.minQuality, only: input.only })
  const attempts: Array<{ model: string; error: string }> = []
  if (!candidates.length) throw new TextRouteError('No hay ningún proveedor de texto configurado con la calidad que necesita esta tarea.', attempts)
  let lastStatus: number | null = null
  for (const m of candidates) {
    try {
      const raw = m.provider === 'openai' ? await callOpenAI(m, input.system, input.user, input.schema, input.schemaName, input.requestId)
        : m.provider === 'groq' ? await callGroq(m, input.system, input.user, input.schema)
        : m.provider === 'gateway' ? await callGateway(m, input.system, input.user, input.schema)
        : await callGemini(m, input.system, input.user, input.schema)
      let parsed: unknown
      try { parsed = JSON.parse(raw.text) } catch { throw new Error('JSON no válido') }
      const data = input.validate(parsed)
      if (data === null) throw new Error('respuesta incompleta')
      const usage = raw.usage
      const result: TextResult<T> = { data, model: m, usage, estimatedUsd: m.tier === 'paid' || m.tier === 'freemium' ? estimateTextCost(m, usage) : 0, attempts }
      console.info('text-usage', JSON.stringify({ task, provider: m.provider, model: m.model(), tier: m.tier, ...usage, estimatedUsd: result.estimatedUsd, fallbacks: attempts.length }))
      return result
    } catch (error) {
      lastStatus = (error as { status?: number }).status ?? null
      attempts.push({ model: m.id, error: error instanceof Error ? error.message.slice(0, 120) : 'error' })
    }
  }
  throw new TextRouteError('Ningún proveedor de texto pudo completar la tarea.', attempts, lastStatus)
}
