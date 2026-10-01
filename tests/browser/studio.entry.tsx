import { createRoot } from 'react-dom/client'
import Page from '@/app/studio/page'
import { catalog } from '@/lib/providers/catalog'

// Server routes replaced in the page: FAL and ElevenLabs "configured", OpenAI not.
const w = window as any
const configured = new Set(['FAL_KEY', 'ELEVENLABS_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'])
const models = catalog.map(m => ({
  id: m.id, modality: m.modality, provider: m.provider, label: m.label, strength: m.strength, price: m.price, priceConfirmed: m.priceConfirmed, sync: m.sync,
  tier: m.tier, quality: m.quality, speed: m.speed, limits: m.limits ?? null, capabilities: m.capabilities,
  formats: m.formats ?? null, durations: m.durations ?? null, maxVariants: m.maxVariants ?? 1, negative: Boolean(m.negative),
  ready: m.env.every(e => configured.has(e)), creditsExhausted: false, missing: m.env.filter(e => !configured.has(e)),
}))
w.__GEN = []
let polls = 0
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('/api/studio/catalog')) return json({ models, providers: [], openAiVoices: ['onyx', 'nova'], geminiVoices: ['Charon', 'Kore'], textReady: false, balances: { elevenlabs: { used: 1000, limit: 30000, remaining: 29000, resetsAt: '2026-10-15T00:00:00Z', tier: 'creator' } } })
  if (url.startsWith('/api/stock/search?')) return json({ items: [{ source: 'freesound', id: '42', kind: 'audio', title: 'Jungle night', author: 'ana', authorUrl: null, pageUrl: 'https://freesound.org/s/42/', license: 'Creative Commons 0', licenseUrl: null, licenseStatus: 'public_domain', attribution: 'x', thumbUrl: null, previewUrl: null, durationSeconds: 30, width: null, height: null }] })
  if (url.startsWith('/api/stock/search')) return json({ sources: [{ id: 'freesound', configured: true, kinds: ['audio'] }, { id: 'pexels', configured: false, kinds: ['image', 'video'] }] })
  if (url.startsWith('/api/stock/import')) { w.__IMPORTS = [...(w.__IMPORTS ?? []), JSON.parse(String(init?.body))]; return json({ asset: { id: 'imp1' }, duplicate: false }, 201) }
  if (url.startsWith('/api/providers/voices')) return json({ voices: [{ voice_id: 'abcdefghijklmnopqrst', name: 'Narrador grave', labels: { accent: 'latino' } }] })
  if (url.startsWith('/api/studio/generate')) { w.__GEN.push(JSON.parse(String(init?.body))); return json({ job: { token: 'tok-1', requestId: 'r1' } }, 202) }
  if (url.startsWith('/api/studio/job')) {
    polls++
    if (polls < 2) return json({ state: 'running', position: null })
    const asset = { id: 'gen1', project_id: 'p1', owner_id: 'u1', asset_type: 'image', storage_path: 'u1/p1/gen1.png', source_provider: 'fal:FLUX.2 Pro', license_status: 'generated', provenance: { catalogModel: 'fal:fal-ai/flux-2-pro', originalPrompt: 'selva tras la lluvia', sceneId: 's2' }, created_at: '2026-09-30T08:00:00Z' }
    if (!w.__DB.assets.some((a: any) => a.id === 'gen1')) w.__DB.assets.push(asset)
    return json({ state: 'done', assets: [asset] })
  }
  const m = url.match(/\/api\/assets\/([^/]+)\/signed-url/)
  if (m) { await w.__IMG_READY; return json({ url: w.__IMG }) }
  return realFetch(input, init)
}
createRoot(document.getElementById('root')!).render(<Page />)
