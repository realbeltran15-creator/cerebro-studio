// Two photos of the same kind of scene with different light: one dark and cool, one bright and warm (gradients, so they have contrast).
window.__MEDIA_READY = window.__MEDIA_READY.then(async () => {
  const make = async (top, bottom) => { const c = new OffscreenCanvas(960, 540), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 540); gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, 960, 540); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(380, 200, 200, 140); return URL.createObjectURL(await c.convertToBlob({ type: 'image/png' })) }
  window.__URLS.dark = await make('#2a3550', '#0a0d18')
  window.__URLS.bright = await make('#ffd9a0', '#b07040')
})
const a = (id, title) => ({ id, project_id: 'p1', owner_id: 'u1', asset_type: 'image', storage_path: `u1/p1/${id}`, license_status: 'owned', source_provider: 'upload', provenance: { title }, created_at: '2026-09-27T20:00:00Z' })
window.__DB.assets.push(a('dark', 'Foto oscura'), a('bright', 'Foto luminosa'))
const k = (id, vis) => ({ id, sceneId: id, position: 1, narration: null, visualAssetId: vis, voiceAssetId: null, durationMs: 3000, motion: 'none', camera: { kind: 'none', amount: 0.1 }, transition: 'cut' })
window.__DB.render_jobs[0].composition.clips = [k('d', 'dark'), k('b', 'bright')]
window.__DB.render_jobs[0].composition.audioClips = []
window.__DB.render_jobs[0].composition.subtitles = false
