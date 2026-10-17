import { createRoot } from 'react-dom/client'
import Page from '@/app/studio/recreate/page'

const w = window as any
w.__GEN = []; w.__SAVED = []
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const scene = (i: number) => ({ action: `a${i}`, seconds: 3, characters: ['Lucía'], narration: `Lucía descubre la pista ${i} en el faro`, visual_prompt_en: `Ultra-realistic cinematic shot, vertical 9:16, Lucía at a lighthouse ${i}`, animation_prompt_en: `Slow push-in ${i}` })
const plan = {
  title: 'La noche en que el faro abandonado volvió a encenderse solo', description: 'Misterio 🔦', consistent: true,
  characters: [{ name: 'Lucía', age: '30', personality: 'curiosa', appearance: 'pelo corto negro', outfit: 'abrigo rojo', expression: 'asombro', unique_traits: 'cicatriz', prompt_en: 'Portrait of a woman, red coat' }],
  scenes: Array.from({ length: 6 }, (_, i) => scene(i + 1)),
}
const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === '/api/recreate/analyze') { w.__ANALYZE = JSON.parse(String(init?.body)); return json({ analysis: { hook: 'Un hombre abre una caja', scenes: [], spoken_text: '' }, via: 'gemini-video', source: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', plan, originality: { narrationOverlap: 0, ok: true, problems: [] }, textModel: 'gemini:gemini-3.8-flash' }) }
  if (url === '/api/recreate/save') { w.__SAVED.push(JSON.parse(String(init?.body))); return json({ storyboardId: 'sb9', scenes: plan.scenes.map((_, i) => ({ id: `sc${i + 1}`, position: i + 1 })) }, 201) }
  if (url === '/api/studio/generate') {
    const body = JSON.parse(String(init?.body)); w.__GEN.push(body)
    // The free allowance runs out on the 4th request: the batch must stop and not try anything else.
    if (w.__GEN.length === 4) return json({ error: 'Cupo gratuito agotado en FLUX.2 klein 4B. No se ha enviado nada.', exhausted: true }, 409)
    const id = `g${w.__GEN.length}`
    w.__DB.assets.push({ id, project_id: 'p1', owner_id: 'u1', asset_type: body.modelId.startsWith('gemini') ? 'voice' : 'image', provenance: {}, created_at: '2026-10-10T00:00:00Z' })
    return json({ assets: [{ id }] }, 201)
  }
  return realFetch(input, init)
}
createRoot(document.getElementById('root')!).render(<Page />)
