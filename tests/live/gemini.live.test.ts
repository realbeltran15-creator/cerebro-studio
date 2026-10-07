/**
 * Live Gemini checks through Cerebro Studio's own code (opt-in: LIVE_GEMINI=1 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca-bundle> npx vitest run tests/live;
 * in the sandbox Node only uses the egress proxy that injects the Network Secret with NODE_USE_ENV_PROXY=1).
 * Only free-tier, small text/TTS calls; never video. The real key is never read here: when it is injected
 * by the sandbox proxy (Network Secret) the process only needs a non-secret placeholder so the
 * app's "is configured" checks pass, and the proxy replaces the x-goog-api-key header.
 */
import { describe, expect, it } from 'vitest'
import { catalog, isConfigured } from '@/lib/providers/catalog'
import { pickModel } from '@/lib/providers/router'
import { routeText, runTextTask, TextRouteError } from '@/lib/providers/text'
import { startGeneration } from '@/lib/providers/adapters'
import { generationProvenance } from '@/lib/providers/provenance'

const live = process.env.LIVE_GEMINI === '1'
const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY?.trim() || 'proxy-injected-placeholder' }
if (live) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY

describe.skipIf(!live)('Gemini through the real integration', () => {
  it('routes quality-first: tasks Gemini reaches go to it, the top-quality draft is not downgraded', () => {
    expect(routeText('tags', env).map(m => m.id)).toEqual(['gemini:gemini-3.8-flash'])
    expect(routeText('packaging', env).map(m => m.id)).toEqual(['gemini:gemini-3.8-flash'])
    expect(routeText('script_draft', env)).toEqual([])
  })

  it('runs a structured text task and reports usage, tier and cost', async () => {
    const r = await runTextTask('tags', {
      system: 'Eres un clasificador. Responde en español.', user: 'Devuelve 3 etiquetas para un vídeo sobre la selva peruana.',
      schema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } }, required: ['tags'] }, schemaName: 'tags', requestId: 'live-test',
      validate: v => { const t = (v as { tags?: unknown }).tags; return Array.isArray(t) && t.length > 0 && t.every(x => typeof x === 'string') ? t as string[] : null },
    }).catch((e: unknown) => {
      // Google answers 502/503 during demand spikes: the integration must report it, not crash.
      if (e instanceof TextRouteError && e.status !== null && e.status >= 500) { console.warn('Gemini text unavailable (provider overload):', e.status, e.attempts); return null }
      throw e
    })
    if (!r) return
    expect(r.data.length).toBeGreaterThan(0)
    expect(r.model.id).toBe('gemini:gemini-3.8-flash')
    expect(r.usage.inputTokens === null || r.usage.inputTokens > 0).toBe(true)
  }, 240000)

  it('fails honestly when no eligible model exists', async () => {
    await expect(runTextTask('script_draft', { system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'x', requestId: 'live-test', validate: v => v })).rejects.toBeInstanceOf(TextRouteError)
  })

  it('selects Gemini TTS for Spanish voice and produces a WAV with provenance', async () => {
    const availability = Object.fromEntries(catalog.map(m => [m.id, { ready: isConfigured(m, env) }]))
    const picked = pickModel(catalog, { modality: 'voice', strategy: 'free_only', needs: ['spanish'] }, availability)
    expect(picked?.model.id).toBe('gemini:gemini-3.8-flash-tts')
    const res = await startGeneration({
      model: picked!.model, prompt: 'Bienvenidos a Cerebro Studio.', finalPrompt: 'Bienvenidos a Cerebro Studio.', options: {},
      context: { ownerId: 'live', projectId: 'live', requestId: 'live-test' }, voice: 'Charon', instructions: 'Voz grave y tranquila.',
    } as never)
    expect(res.kind).toBe('assets')
    if (res.kind !== 'assets') return
    const a = res.assets[0]
    expect(a.mimeType).toBe('audio/wav')
    const bytes = Buffer.from(a.uri.split(',')[1], 'base64')
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes.length).toBeGreaterThan(10000)
    const prov = generationProvenance({ provider: a.provider, requestId: 'live-test', projectId: 'live', mimeType: a.mimeType, metadata: a.metadata })
    expect(prov.model).toBe('gemini-3.8-flash-tts')
  }, 120000)
})
