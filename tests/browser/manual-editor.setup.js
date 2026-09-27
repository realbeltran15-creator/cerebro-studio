// Runs before the app: synthetic media, signed-url fetch mock and the seeded database.
window.__UPLOADS = []
function wav(seconds, freq, rate = 22050) {
  const n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / rate) * 0.5 * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}
window.__MEDIA_READY = (async () => {
  const oc = new OffscreenCanvas(1600, 900); const x = oc.getContext('2d'); x.fillStyle = '#c0392b'; x.fillRect(0, 0, 1600, 900)
  const img = await oc.convertToBlob({ type: 'image/png' })
  const c = document.createElement('canvas'); c.width = 640; c.height = 360
  const cx = c.getContext('2d'), stream = c.captureStream(30), r = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), parts = []
  r.ondataavailable = e => parts.push(e.data); r.start()
  const t0 = performance.now()
  await new Promise(res => { const f = () => { cx.fillStyle = '#00c800'; cx.fillRect(0, 0, 640, 360); if (performance.now() - t0 < 3200) requestAnimationFrame(f); else res() }; f() })
  r.stop(); await new Promise(res => (r.onstop = res))
  const blobs = { img: img, vid: new Blob(parts, { type: 'video/webm' }), v1: wav(1.2, 220), v2: wav(1.5, 330), mus: wav(10, 110) }
  window.__URLS = Object.fromEntries(Object.entries(blobs).map(([k, b]) => [k, URL.createObjectURL(b)]))
})()
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  const m = url.match(/\/api\/assets\/([^/]+)\/signed-url/)
  if (m) { await window.__MEDIA_READY; return new Response(JSON.stringify({ url: window.__URLS[m[1]] }), { headers: { 'content-type': 'application/json' } }) }
  return realFetch(input, init)
}
const asset = (id, type, title) => ({ id, project_id: 'p1', owner_id: 'u1', asset_type: type, storage_path: `u1/p1/${id}`, license_status: 'generated', source_provider: 'test', provenance: { title }, created_at: '2026-09-27T20:00:00Z' })
const clip = (id, vis, voice, dur) => ({ id, sceneId: id, position: 1, narration: `subtitulo ${id}`, visualAssetId: vis, voiceAssetId: voice, durationMs: dur, motion: 'none' })
window.__DB = {
  render_jobs: [{ id: 'job1', project_id: 'p1', status: 'draft', updated_at: '2026-09-27T20:00:00.000Z', composition: { version: 1, storyboardId: 'sb', title: 'Prueba', format: '16:9', clips: [clip('a', 'img', 'v1', 2000), clip('b', 'vid', 'v2', 3000), clip('c', 'img', null, 2000)], musicAssetId: null, musicVolume: 0.25, duckMusic: true, subtitles: true, fadeMs: 200 } }],
  assets: [asset('img', 'image', 'Foto roja'), asset('vid', 'video', 'Clip verde'), asset('v1', 'voice', 'Voz 1'), asset('v2', 'voice', 'Voz 2'), asset('mus', 'music', 'Musica')],
}
history.replaceState(null, '', '/editor/manual?job=job1')
