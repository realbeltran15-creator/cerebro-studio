// Realistic, awkward data (long titles, long unbroken URLs, many rows) layered on the studio seed for mobile checks.
(() => {
  const db = window.__DB
  const long = 'Documental extraordinariamente largo sobre la supervivencia de Juliane Koepcke en la selva peruana después del accidente aéreo de 1971 con una URL https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijklmnopqrstuvwxyz0123456789'
  db.opportunities = Array.from({ length: 12 }, (_, i) => ({
    id: `o${i}`, owner_id: 'u1', project_id: i === 0 ? 'p1' : null, source_platform: 'youtube', source_id: `https://www.youtube.com/watch?v=abc${i}abcdefghijklmnopqrstuvwxyz`, query: long.slice(0, 90), region: 'ES', language: 'es',
    title: `${i + 1}. ${long}`, status: 'new', confidence: null, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-29T00:00:00Z',
    observed_metrics: { views: 1234567, likes: 45678, comments: 910, channelSubscribers: 98765, fetchedAt: '2026-09-29T00:00:00Z', source: 'youtube-data-api', history: [{ at: '2026-09-20T00:00:00Z', views: 1000000 }, { at: '2026-09-29T00:00:00Z', views: 1234567 }] },
    calculated_metrics: { viewsPerDay: 20000, viewsToSubscribers: 12.5, engagementRate: 3.7 },
    evidence: [{ note: long, url: 'https://example.com/evidencia-muy-larga-sin-espacios-' + 'x'.repeat(120) }],
  }))
  const types = ['image', 'video', 'voice', 'music', 'sfx', 'subtitle', 'thumbnail']
  db.assets = Array.from({ length: 24 }, (_, i) => ({
    id: `as${i}`, owner_id: 'u1', project_id: 'p1', asset_type: types[i % types.length], storage_path: `u1/p1/as${i}.bin`, source_provider: i % 2 ? 'fal:FLUX.2 Pro' : 'elevenlabs', source_url: null, license_status: i % 3 ? 'generated' : 'unverified',
    provenance: { title: `${long.slice(0, 70)} ${i}`, originalPrompt: long, catalogModel: 'fal:fal-ai/flux-2-pro', costTier: 'paid', estimateUsd: 0.045, sceneId: i % 2 ? 's2' : null, mimeType: 'image/png' }, created_at: '2026-09-28T00:00:00Z',
  }))
  db.projects = Array.from({ length: 8 }, (_, i) => ({ ...db.projects[0], id: i === 0 ? 'p1' : `p${i + 1}`, name: i === 0 ? db.projects[0].name : `Proyecto ${i + 1}: ${long.slice(0, 120)}` }))
  db.scripts = [{ id: 'sc1', owner_id: 'u1', project_id: 'p1', title: long.slice(0, 110), version: 3, status: 'approved', hook: long.slice(0, 80), sections: [{ id: 'a', heading: 'H', basis: 'verified_fact', text: long, sources: [] }], updated_at: '2026-09-29T00:00:00Z', created_at: '2026-09-28T00:00:00Z' }]
  db.publication_jobs = [{ id: 'j1', owner_id: 'u1', project_id: 'p1', platform: 'youtube', status: 'draft', payload: { title: long.slice(0, 100) }, created_at: '2026-09-29T00:00:00Z' }]
})()
