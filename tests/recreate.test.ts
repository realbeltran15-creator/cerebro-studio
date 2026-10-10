import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalYouTubeUrl, youtubeVideoId } from '@/lib/recreate/youtube-url'
import { checkOriginality, ngramOverlap } from '@/lib/recreate/originality'
import { validateAnalysis, validatePlan, publicAnalysis } from '@/lib/recreate/validate'
import { characterRequest, FREE_IMAGE_MODEL, FREE_VOICE_MODEL, matchClipsToScenes, sceneImageRequest, voiceRequest } from '@/lib/recreate/batch'
import { sceneRows, storyboardRow } from '@/lib/recreate/build'
import { modelById } from '@/lib/providers/catalog'

const state: { user: { id: string } | null; project: boolean } = { user: { id: 'u1' }, project: true }
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => { const b: Record<string, unknown> = {}; for (const m of ['select', 'eq']) b[m] = () => b; b.maybeSingle = async () => ({ data: state.project ? { id: 'p1' } : null }); return b },
  }),
}))

const scene = (i: number, o: Record<string, unknown> = {}) => ({
  action: `acción ${i}`, seconds: 3, characters: ['Lucía'], narration: `Lucía descubre la pista número ${i} en el viejo faro`,
  visual_prompt_en: `Ultra-realistic cinematic shot, vertical 9:16, Lucía with red coat at a lighthouse, scene ${i}`, animation_prompt_en: 'Slow push-in, her hair moves in the wind.', ...o,
})
const plan = (o: Record<string, unknown> = {}) => ({
  title: 'La noche en que el faro abandonado volvió a encenderse solo', description: 'Un misterio breve 🔦',
  characters: [{ name: 'Lucía', age: '30', personality: 'curiosa', appearance: 'pelo corto negro', outfit: 'abrigo rojo', expression: 'asombro', unique_traits: 'cicatriz en la ceja', prompt_en: 'Half-body portrait of a woman, short black hair, red coat' }],
  scenes: Array.from({ length: 6 }, (_, i) => scene(i + 1)), ...o,
})

describe('YouTube URLs', () => {
  it('accepts only public youtube hosts and rebuilds the URL from the id', () => {
    expect(youtubeVideoId('https://youtu.be/jNQXAC9IVRw?t=3')).toBe('jNQXAC9IVRw')
    expect(canonicalYouTubeUrl('https://www.youtube.com/shorts/jNQXAC9IVRw?feature=share')).toBe('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    expect(canonicalYouTubeUrl('https://m.youtube.com/watch?v=jNQXAC9IVRw&list=x')).toBe('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    for (const bad of ['https://evil.com/watch?v=jNQXAC9IVRw', 'https://youtube.com.evil.com/watch?v=jNQXAC9IVRw', 'file:///etc/passwd', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=short', 'nada']) expect(canonicalYouTubeUrl(bad)).toBeNull()
  })
})

describe('originality guard', () => {
  const ref = 'hoy vamos a ver por qué los gatos siempre caen de pie y nadie se lo imagina nunca'
  it('measures repeated 4-word sequences, ignoring accents and punctuation', () => {
    expect(ngramOverlap('Hoy vamos a ver por qué los gatos siempre caen de pie', ref)).toBeGreaterThan(0.8)
    expect(ngramOverlap('Una niña encuentra un mapa dentro de un libro viejo', ref)).toBe(0)
  })
  it('refuses a narration that copies the reference and accepts a new one', () => {
    const copy = { title: 'Otro título distinto por completo aquí', scenes: [{ narration: 'hoy vamos a ver por qué los gatos siempre caen de pie y nadie se lo imagina nunca' }] }
    expect(checkOriginality(copy, { spokenText: ref }).ok).toBe(false)
    expect(checkOriginality({ title: 'x', scenes: [{ narration: 'Una niña encuentra un mapa dentro de un libro viejo' }] }, { spokenText: ref }).ok).toBe(true)
  })
  it('flags a near-identical title', () => {
    expect(checkOriginality({ title: 'Por qué los gatos caen de pie siempre', scenes: [] }, { spokenText: '', title: 'Por qué los gatos siempre caen de pie' }).ok).toBe(false)
  })
})

describe('plan validation follows the tutorial rules', () => {
  it('accepts a valid consistent plan and keeps the vertical prefix', () => {
    const p = validatePlan(plan(), true)!
    expect(p.scenes).toHaveLength(6)
    expect(p.scenes[0].visual_prompt_en).toMatch(/^Ultra-realistic cinematic shot, vertical 9:16/)
    expect(validatePlan(plan({ scenes: plan().scenes.map(s => ({ ...s, visual_prompt_en: 'a lighthouse at dawn' })) }), true)!.scenes[0].visual_prompt_en).toMatch(/^Ultra-realistic cinematic shot, vertical 9:16, a lighthouse/)
  })
  it('rejects wrong scene count, duration, total length, long narration, unknown characters and short titles', () => {
    expect(validatePlan(plan({ scenes: plan().scenes.slice(0, 5) }), true)).toBeNull()
    expect(validatePlan(plan({ scenes: [...plan().scenes.slice(0, 5), scene(6, { seconds: 6 })] }), true)).toBeNull()
    expect(validatePlan(plan({ scenes: plan().scenes.map(s => ({ ...s, seconds: 2 })) }), true)).toBeNull() // 12 s < 15 s
    expect(validatePlan(plan({ scenes: [...plan().scenes.slice(0, 5), scene(6, { narration: 'palabra '.repeat(30) })] }), true)).toBeNull()
    expect(validatePlan(plan({ scenes: [...plan().scenes.slice(0, 5), scene(6, { characters: ['Fantasma'] })] }), true)).toBeNull()
    expect(validatePlan(plan({ title: 'Título corto' }), true)).toBeNull()
  })
  it('a normal Short has no characters', () => {
    const p = validatePlan(plan(), false)!
    expect(p.characters).toEqual([])
    expect(p.scenes.every(s => s.characters.length === 0)).toBe(true)
    expect(validatePlan(plan({ characters: [] }), true)).toBeNull()
  })
})

describe('analysis', () => {
  it('needs a hook and at least two scenes, and the spoken text is never sent to the browser', () => {
    expect(validateAnalysis({ hook: 'x', scenes: [{ description: 'a' }] })).toBeNull()
    const a = validateAnalysis({ hook: 'gancho', scenes: [{ description: 'a', start: 0, end: 2 }, { description: 'b' }], spoken_text: 'texto original' })!
    expect(a.spoken_text).toBe('texto original')
    expect(publicAnalysis(a).spoken_text).toBe('')
  })
})

describe('free-only batch', () => {
  const p = validatePlan(plan(), true)!
  it('uses only the free image and voice models, never a paid one, and sends no cost confirmation', () => {
    expect(modelById(FREE_IMAGE_MODEL)?.tier).not.toBe('paid')
    expect(modelById(FREE_IMAGE_MODEL)?.confirm).toBeFalsy()
    expect(modelById(FREE_VOICE_MODEL)?.tier).not.toBe('paid')
    const bodies = [characterRequest('p1', p.characters[0]), sceneImageRequest('p1', p, p.scenes[0], 's1', { 'lucía': 'a1' }), voiceRequest('p1', p.scenes[0], 's1')]
    for (const b of bodies) { expect(b).not.toHaveProperty('confirmedEstimateUsd'); expect(String(b.modelId)).toMatch(/^(cloudflare|gemini):/) }
  })
  it('passes the character reference and locked identity to each scene image', () => {
    const b = sceneImageRequest('p1', p, p.scenes[0], 's1', { 'lucía': 'a1' })
    expect(b.referenceAssetIds).toEqual(['a1'])
    expect(String(b.identity)).toMatch(/Lucía: .*abrigo rojo/)
    expect(b.sceneId).toBe('s1')
  })
  it('matches clips to scenes by the number in the file name, else by order', () => {
    expect(matchClipsToScenes(['escena-3.mp4', 'escena-1.mp4', 'escena-2.mp4'], 6)).toEqual([3, 1, 2])
    expect(matchClipsToScenes(['a.mp4', 'b.mp4'], 6)).toEqual([1, 2])
    expect(matchClipsToScenes(['escena-9.mp4'], 6)).toEqual([1])
  })
})

describe('storyboard rows', () => {
  it('creates a 9:16 storyboard with scene rows that carry the animation prompt and identity', () => {
    const p = validatePlan(plan(), true)!
    expect(storyboardRow('u1', 'p1', p).aspect_ratio).toBe('9:16')
    const rows = sceneRows('u1', 'b1', p, { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' })
    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({ position: 1, duration_ms: 3000, video_prompt: 'Slow push-in, her hair moves in the wind.' })
    expect(rows[0].metadata).toMatchObject({ hook: true, characters: ['Lucía'] })
    expect(rows[1].metadata.hook).toBe(false)
  })
})

describe('POST /api/recreate/analyze', () => {
  let calls: string[]
  beforeEach(() => {
    state.user = { id: 'u1' }; state.project = true; calls = []
    for (const k of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'OPENAI_TEXT_API_KEY', 'TEXT_GATEWAY_BASE_URL']) delete process.env[k]
    process.env.GEMINI_API_KEY = 'k'
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const post = async (body: unknown) => { const { POST } = await import('@/app/api/recreate/analyze/route'); const r = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, json: await r.json() as Record<string, any> } }
  const reply = (obj: unknown) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: {} })
  const analysis = { hook: 'Un hombre abre una caja', hook_seconds: 2, scenes: [{ description: 'a', start: 0, end: 3 }, { description: 'b', start: 3, end: 6 }], pace: 'rápido', dominant_emotion: 'intriga', viral_element: 'misterio', narration_style: 'susurrado', spoken_text: 'hoy abrimos la caja que nadie quiso abrir jamás en este pueblo' }

  it('needs a session and an owned project', async () => {
    state.user = null
    expect((await post({ projectId: 'p1', url: 'https://youtu.be/jNQXAC9IVRw' })).status).toBe(401)
    state.user = { id: 'u1' }; state.project = false
    expect((await post({ projectId: 'p1', url: 'https://youtu.be/jNQXAC9IVRw' })).status).toBe(404)
  })

  it('rejects a non-YouTube link without calling any provider', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    const r = await post({ projectId: 'p1', url: 'https://evil.example/video' })
    expect(r.status).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })

  it('analyses the video, writes an original plan and never returns the reference spoken text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit) => {
      calls.push(String(u))
      if (String(u).includes(':generateContent')) {
        expect(String(init.body)).toContain('"fileUri":"https://www.youtube.com/watch?v=jNQXAC9IVRw"')
        return reply(analysis)
      }
      // text router (Gemini interactions): the writer must not receive the reference's words.
      expect(String(init.body)).not.toContain('nadie quiso abrir')
      return Response.json({ output_text: JSON.stringify(plan()) })
    }))
    const r = await post({ projectId: 'p1', url: 'https://youtu.be/jNQXAC9IVRw', consistent: true })
    expect(r.status).toBe(200)
    expect(r.json.plan.scenes).toHaveLength(6)
    expect(r.json.analysis.spoken_text).toBe('')
    expect(r.json.originality.ok).toBe(true)
    expect(calls.some(c => c.includes('openai.com'))).toBe(false)
  })

  it('explains a quota error and does not switch to a paid provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    const r = await post({ projectId: 'p1', url: 'https://youtu.be/jNQXAC9IVRw' })
    expect(r.status).toBe(429)
    expect(r.json.error).toMatch(/cupo gratuito/)
  })
})

describe('POST /api/recreate/save', () => {
  const inserted: Array<[string, unknown]> = []
  beforeEach(() => { inserted.length = 0; state.user = { id: 'u1' }; state.project = true })
  it('rejects a plan that breaks the rules before writing anything', async () => {
    const { POST } = await import('@/app/api/recreate/save/route')
    const r = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ projectId: 'p1', plan: { title: 'corto', scenes: [] }, consistent: false }) }))
    expect(r.status).toBe(400)
  })
  it('needs a session', async () => {
    state.user = null
    const { POST } = await import('@/app/api/recreate/save/route')
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}' }))).status).toBe(401)
  })
})
