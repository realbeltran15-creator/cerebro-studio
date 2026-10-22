// The phase-12 verification project inside the real editor page: two videos at once, photos, two music tracks, a voice, an effect,
// a title, subtitles, transitions and volume automation. Media are made here (videos recorded live, with their own tone).
;(() => {
  const wav = (seconds, freq, rate = 48000) => {
    const n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / rate) * 0.4 * 32767, true)
    return new Blob([buf], { type: 'audio/wav' })
  }
  const image = async color => { const oc = new OffscreenCanvas(960, 540); const x = oc.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 960, 540); return oc.convertToBlob({ type: 'image/png' }) }
  const video = async (color, freq) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d')
    const ac = new AudioContext(); const osc = ac.createOscillator(); osc.frequency.value = freq; const gain = ac.createGain(); gain.gain.value = 0.4
    const dest = ac.createMediaStreamDestination(); osc.connect(gain); gain.connect(dest); osc.start()
    const stream = c.captureStream(30); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))
    const r = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' }); const parts = []
    r.ondataavailable = e => parts.push(e.data); r.start()
    const t0 = performance.now()
    await new Promise(res => { const f = () => { g.fillStyle = color; g.fillRect(0, 0, 640, 360); if (performance.now() - t0 < 4300) requestAnimationFrame(f); else res() }; f() })
    r.stop(); await new Promise(res => (r.onstop = res)); osc.stop(); await ac.close()
    return new Blob(parts, { type: 'video/webm' })
  }
  const asset = (id, type, title) => ({ id, project_id: 'p1', owner_id: 'u1', asset_type: type, storage_path: `u1/p1/${id}`, license_status: 'owned', source_provider: 'test', provenance: { title }, created_at: '2026-10-22T10:00:00Z' })
  window.__DB.assets = [asset('red', 'image', 'Foto roja'), asset('blue', 'image', 'Foto azul'), asset('yellow', 'image', 'Foto amarilla'), asset('green', 'video', 'Vídeo verde'), asset('magenta', 'video', 'Vídeo magenta'), asset('m1', 'music', 'Música grave'), asset('m2', 'music', 'Música media'), asset('vo', 'voice', 'Locución'), asset('fx', 'sfx', 'Efecto')]
  const clip = (id, vis, dur, extra = {}) => ({ id, sceneId: id, position: 1, narration: null, visualAssetId: vis, voiceAssetId: null, durationMs: dur, motion: 'none', transition: 'cut', ...extra })
  const a = (id, assetId, kind, startMs, durationMs, volume, extra = {}) => ({ id, assetId, kind, linkedClipId: null, offsetMs: 0, startMs, trimInMs: 0, durationMs, volume, muted: false, ...extra })
  window.__DB.render_jobs = [{ id: 'jv', project_id: 'p1', status: 'draft', updated_at: '2026-10-22T10:00:00.000Z', composition: {
    version: 1, storyboardId: 'sb', title: 'Verificación', format: '16:9', editedManually: true, subtitles: true, duckMusic: true, fadeMs: 400, musicAssetId: null, musicVolume: 0.25,
    clips: [clip('c1', 'red', 3000, { transition: 'dissolve', narration: 'Hola a todos' }), clip('c2', 'green', 4000, { transition: 'wipe' }), clip('c3', 'blue', 3000, { transition: 'slide' }), clip('c4', 'yellow', 3000)],
    tracks: [{ id: 'ov1', type: 'overlay', name: 'Superposición 1' }, { id: 'main', type: 'main', name: 'Vídeo principal' }, { id: 'text', type: 'text', name: 'Texto' }, { id: 'voice', type: 'voice', name: 'Voz' }, { id: 'music', type: 'music', name: 'Música' }, { id: 'sfx', type: 'sfx', name: 'Efectos' }],
    overlays: [{ id: 'o1', trackId: 'ov1', assetId: 'magenta', startMs: 4500, durationMs: 4000, trimInMs: 0, transform: { x: 0.75, y: 0.3, scale: 0.3, rotation: 0, opacity: 1 } }],
    textClips: [{ id: 't1', content: 'TITULO', startMs: 500, durationMs: 2500, position: 'top', sizePct: 8, animation: 'none', color: '#ffffff' }],
    audioClips: [a('a1', 'm1', 'music', 0, 13000, 0.6, { envelope: [{ atMs: 5500, gain: 1 }, { atMs: 6000, gain: 0.1 }] }), a('a2', 'm2', 'music', 6000, 7000, 0.5), a('a3', 'vo', 'voice', 1500, 1500, 1), a('a4', 'fx', 'sfx', 9000, 500, 1)],
  } }]
  window.__MEDIA_READY = (async () => {
    const [red, blue, yellow, green, magenta] = await Promise.all([image('#d02020'), image('#2040e0'), image('#e0d020'), video('#00c800', 440), video('#c800c8', 660)])
    const blobs = { red, blue, yellow, green, magenta, m1: wav(16, 110), m2: wav(16, 165), vo: wav(3, 330), fx: wav(0.5, 880) }
    window.__URLS = Object.fromEntries(Object.entries(blobs).map(([k, b]) => [k, URL.createObjectURL(b)]))
  })()
  window.__putBlob = (path, blob) => { if (/renders/.test(path)) window.__LAST_RENDER = blob }
  try { const kept = sessionStorage.getItem('__KEEP_JOBS'); if (kept) window.__DB.render_jobs = JSON.parse(kept) } catch { /* ignore */ }
  history.replaceState(null, '', '/editor/manual?job=jv')
})()
