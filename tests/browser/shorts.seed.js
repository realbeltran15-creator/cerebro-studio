// Runs after manual-editor.setup.js (media + upload mocks). Seeds one prepared Short and one published Short, and mocks the publication routes.
(() => {
const asset = (id, type, title) => ({ id, project_id: 'p1', owner_id: 'u1', asset_type: type, storage_path: `u1/p1/${id}`, license_status: 'generated', source_provider: 'test', provenance: { title }, created_at: '2026-10-12T07:00:00Z' })
const clip = (id, vis, voice, dur, text) => ({ id, sceneId: id, position: 1, narration: `subtítulo ${id}`, visualAssetId: vis, voiceAssetId: voice, durationMs: dur, motion: 'none', text })
const source = (url, domain, status, reason) => ({ url, title: domain, domain, status, reason })
window.__DB = {
  render_jobs: [{ id: 'job1', project_id: 'p1', status: 'draft', composition: { version: 1, storyboardId: 'sb', title: 'La cucharadita más pesada', format: '9:16', subtitles: true, hookText: '6.000 millones', hookMs: 800, clips: [clip('a', 'img', 'v1', 1000, { content: '6.000 millones', position: 'center', sizePct: 8 }), clip('b', 'img', 'v2', 1000, null)], musicAssetId: null, musicVolume: 0.12, duckMusic: true, fadeMs: 150 } }],
  assets: [asset('img', 'image', 'Foto'), asset('v1', 'voice', 'Voz 1'), asset('v2', 'voice', 'Voz 2')],
  publication_jobs: [],
  shorts_factory_items: [
    {
      id: 'it1', status: 'prepared', topic: 'Densidad de una estrella de neutrones', theme: 'espacio', project_id: 'p1', render_job_id: 'job1', publication_job_id: null, created_at: '2026-10-12T07:05:00Z',
      interest: { video: { title: 'Por qué una estrella de neutrones pesa tanto', url: 'https://www.youtube.com/watch?v=vid6', channel: 'Canal', views: 50000 }, nicheMedianViews: 1050, poolSize: 6, score: 9, components: { interest: { value: 10, kind: 'calculated', note: '50.000 vistas observadas ÷ mediana del nicho 1.050 = 47.6×' }, history: { value: 0, kind: 'inferred', note: 'Sin historial suficiente de retención a 7 días.' } } },
      sources: [source('https://www.nasa.gov/neutron', 'nasa.gov', 'accepted', 'Contiene el dato (100% de los términos clave).'), source('https://www.esa.int/neutron', 'esa.int', 'accepted', 'Contiene el dato (100% de los términos clave).'), source('https://blog-raro.com/x', 'blog-raro.com', 'rejected', 'Dominio sin clasificar como fiable.')],
      verification: { supported: true, statement: 'Una cucharadita de estrella de neutrones pesaría unos 6.000 millones de toneladas', note: 'Coinciden' },
      checks: [{ id: 'hook_fact_2s', ok: true, message: 'Gancho y dato principal en los primeros 2 s' }, { id: 'screen_text_0s', ok: true, message: 'Texto en pantalla desde el segundo 0 con el dato' }],
      plan: { title: 'La cucharadita más pesada del universo', description: 'Una curiosidad.', hashtags: ['ciencia'], seconds: 28, scenes: 5, music: null, musicMissing: true },
      spend: { usd: 0, textCalls: 3, imageCalls: 5, voiceCalls: 1, models: { image: 'cloudflare', voice: 'gemini' } }, discarded_reason: null, video_id: null, published_at: null, retention: null,
    },
    {
      id: 'it0', status: 'published', topic: 'Por qué el cielo es azul', theme: 'ciencia', project_id: 'p0', render_job_id: null, publication_job_id: 'pj0', created_at: '2026-09-20T07:05:00Z',
      interest: {}, sources: [], verification: {}, checks: [], plan: { title: 'El cielo azul' }, spend: { usd: 0 }, discarded_reason: null, video_id: 'abcDEF12345', published_at: '2026-09-21T10:00:00Z',
      retention: { averageViewPercentage: 71.4, views: 820, averageViewDuration: 20, window: { startDate: '2026-09-21', endDate: '2026-09-27' }, source: 'youtube_analytics_v2', fetchedAt: '2026-10-01T00:00:00Z', usableForLearning: true },
    },
  ],
}
window.__PUBLISH_CALLS = []
const prevFetch = window.fetch
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  const m = url.match(/\/api\/publish\/youtube\/([^/]+)\/(approve|publish)$/)
  if (m) {
    window.__PUBLISH_CALLS.push({ job: m[1], action: m[2], body: init?.body ? JSON.parse(init.body) : null })
    const json = m[2] === 'approve' ? { approved: true } : { videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
    return new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } })
  }
  return prevFetch(input, init)
}
history.replaceState(null, '', '/shorts')
})()
