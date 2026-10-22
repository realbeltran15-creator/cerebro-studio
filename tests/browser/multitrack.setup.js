// Adds a blue picture to the manual-editor fixture, for overlays.
;(() => {
  window.__DB.assets.push({ id: 'img2', project_id: 'p1', owner_id: 'u1', asset_type: 'image', storage_path: 'u1/p1/img2', license_status: 'owned', source_provider: 'test', provenance: { title: 'Foto azul' }, created_at: '2026-10-21T20:00:00Z' })
  const ready = window.__MEDIA_READY
  window.__MEDIA_READY = (async () => {
    await ready
    const oc = new OffscreenCanvas(800, 800); const x = oc.getContext('2d'); x.fillStyle = '#2040e0'; x.fillRect(0, 0, 800, 800)
    window.__URLS.img2 = URL.createObjectURL(await oc.convertToBlob({ type: 'image/png' }))
  })()
})()
// «Reopen» in the test: the saved montage survives a reload of the page (the in-memory database would start over otherwise).
try { const kept = sessionStorage.getItem('__KEEP_JOBS'); if (kept) window.__DB.render_jobs = JSON.parse(kept) } catch { /* ignore */ }
