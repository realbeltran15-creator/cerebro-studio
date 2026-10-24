// Adds a small Library to the manual-picker environment: one music file, two videos with known length and one picture.
;(() => {
  if (window.__DB.assets.length) return
  const a = (id, asset_type, provenance) => ({ id, project_id: 'p1', asset_type, storage_path: `u1/p1/${id}.bin`, provenance, license_status: 'owned', created_at: '2026-10-01T10:00:00Z' })
  window.__DB.assets = [a('m1', 'music', { title: 'Pista lo-fi', durationSeconds: 120 }), a('v1', 'video', { title: 'Lluvia', durationSeconds: 20 }), a('v2', 'video', { title: 'Calle', durationSeconds: 45 }), a('i1', 'image', { title: 'Ventana' }), a('o1', 'voice', { title: 'Voz que no es escena', durationSeconds: 5 })]
})()
