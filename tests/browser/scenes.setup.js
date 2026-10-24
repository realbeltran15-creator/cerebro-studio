// A 4-second video with three scenes (red, blue, green) recorded in the browser, added to the Library and to the montage.
window.__MEDIA_READY = window.__MEDIA_READY.then(async () => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360
  const g = c.getContext('2d'), stream = c.captureStream(30), r = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), parts = []
  r.ondataavailable = e => parts.push(e.data); r.start(200)
  const t0 = performance.now()
  await new Promise(res => { const f = () => { const t = performance.now() - t0; g.fillStyle = t < 1400 ? '#d02020' : t < 2800 ? '#2040e0' : '#20c040'; g.fillRect(0, 0, 640, 360); if (t < 4300) requestAnimationFrame(f); else res() }; f() })
  r.stop(); await new Promise(res => (r.onstop = res))
  window.__URLS.scenes = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }))
})
window.__DB.assets.push({ id: 'scenes', project_id: 'p1', owner_id: 'u1', asset_type: 'video', storage_path: 'u1/p1/uploads/scenes.webm', license_status: 'owned', source_provider: 'upload', provenance: { title: 'Tres escenas', durationSeconds: 4 }, created_at: '2026-09-27T20:00:00.000Z' })
window.__DB.render_jobs[0].composition.clips.push({ id: 'sc', sceneId: 'sc', position: 4, narration: null, visualAssetId: 'scenes', voiceAssetId: null, durationMs: 4000, motion: 'none' })
