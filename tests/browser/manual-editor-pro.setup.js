// Appended AFTER manual-editor.setup.js (same script): extra media for the music/effects/subtitles/reference/compare tests.
function clicksWav(seconds, periodMs, firstMs = 250, rate = 22050) {
  const n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5 }
  const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = rnd() * 0.02
  for (let t = firstMs; t < seconds * 1000; t += periodMs) { const at = Math.round(t / 1000 * rate); for (let j = 0; j < 160 && at + j < n; j++) s[at + j] += 0.9 * Math.exp(-j / 30) * (j % 2 ? -1 : 1) }
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s[i])) * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}
const __baseReady = window.__MEDIA_READY
window.__MEDIA_READY = __baseReady.then(async () => {
  window.__URLS.beat = URL.createObjectURL(clicksWav(12, 500))
  window.__URLS.sfx1 = URL.createObjectURL(wav(0.4, 880))
  // Reference video: 7 s of flat colour that changes at exactly 2.0, 3.5 and 5.0 s (three hard cuts), recorded for real.
  const c = document.createElement('canvas'); c.width = 320; c.height = 180
  const cx = c.getContext('2d'), rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8' }), parts = []
  rec.ondataavailable = e => parts.push(e.data); rec.start()
  const t0 = performance.now(), colours = ['#c0392b', '#27ae60', '#2980b9', '#f1c40f']
  await new Promise(res => { const f = () => { const t = (performance.now() - t0) / 1000; cx.fillStyle = colours[t < 2 ? 0 : t < 3.5 ? 1 : t < 5 ? 2 : 3]; cx.fillRect(0, 0, 320, 180); if (t < 7) requestAnimationFrame(f); else res() }; f() })
  rec.stop(); await new Promise(res => (rec.onstop = res))
  window.__REF = new File(parts, 'mi-referencia-privada.webm', { type: 'video/webm' })
})
window.__DB.assets.push(asset('beat', 'music', 'Música con pulso'), asset('sfx1', 'sfx', 'Whoosh'))
// A long montage (400 clips) already opened by hand, to check that only the visible part is drawn.
window.__DB.render_jobs.push({ id: 'long', project_id: 'p1', status: 'draft', updated_at: '2026-09-27T20:00:00.000Z', composition: { version: 1, storyboardId: 'sb', title: 'Largo', format: '16:9', editedManually: true, musicAssetId: null, musicVolume: 0.25, duckMusic: true, subtitles: false, fadeMs: 300,
  clips: Array.from({ length: 400 }, (_, i) => ({ id: `L${i + 1}`, sceneId: 'long', position: i + 1, narration: null, visualAssetId: 'img', voiceAssetId: null, durationMs: 1500, motion: 'none', transition: 'cut' })), audioClips: [] } })
// The base setup always opens job1; a test can ask for another job by setting window.__WANT_JOB before the page loads.
if (window.__WANT_JOB) history.replaceState(null, '', `/editor/manual?job=${window.__WANT_JOB}`)
