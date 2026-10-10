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
;(() => {
  const db = window.__DB
  const clip = (n, narration, seconds, visual) => ({ id: `c${n}`, sceneId: `rs${n}`, position: n, narration, visualAssetId: visual ? `as${n}` : null, voiceAssetId: null, durationMs: seconds * 1000, motion: 'none' })
  db.render_jobs = [{
    id: 'rj1', owner_id: 'u1', project_id: 'p1', status: 'draft', output_format: '16:9', created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z',
    composition: { version: 1, storyboardId: 'b1', title: 'Juliane larga', format: '16:9', fadeMs: 400, subtitles: true, clips: [
      clip(1, 'Una introducción larga con contexto histórico que no engancha a nadie todavía', 20, false),
      clip(2, '¿Por qué nadie sobrevivió a aquella caída de 3000 metros?', 12, true),
      clip(3, 'Ella despertó sola en la selva y caminó once días siguiendo un arroyo.', 20, true),
      clip(4, 'Así volvió a la civilización.', 10, true),
    ] },
  }]
})()
;(() => {
  const db = window.__DB
  const vid = (i, views, pct, dur) => ({ id: i, owner_id: 'u1', platform: 'youtube', external_content_id: `vid${i}`, metric_date: '2026-09-28', project_id: i === 1 ? 'p1' : null, observed: { title: `Vídeo analizado ${i}`, periodStart: '2026-09-01', periodEnd: '2026-09-28', views, averageViewPercentage: pct, averageViewDuration: dur, estimatedMinutesWatched: views / 3, subscribersGained: 3 }, calculated: { likesPer1000Views: 20, subscribersPer1000Views: 1 } })
  db.metric_snapshots = [vid(1, 5000, 70, 40), vid(2, 400, 50, 30), vid(3, 500, 45, 200), vid(4, 450, 40, 180), vid(5, 520, 35, 30), vid(6, 480, 30, 150)]
})()
