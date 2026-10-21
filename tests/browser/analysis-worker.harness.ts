// A page that runs the REAL analysis worker on a long generated audio file while measuring whether the page stays responsive.
function longWav(seconds: number, periodMs: number, rate = 8000) {
  const n = seconds * rate, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  const pcm = new Int16Array(buf, 44)
  let seed = 9; for (let i = 0; i < n; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; pcm[i] = Math.round((seed / 2 ** 32 - 0.5) * 0.02 * 32767) }
  for (let t = 250; t < seconds * 1000; t += periodMs) { const at = Math.round(t / 1000 * rate); for (let j = 0; j < 100 && at + j < n; j++) pcm[at + j] += Math.round(0.9 * Math.exp(-j / 25) * (j % 2 ? -1 : 1) * 32767) }
  return new Blob([buf], { type: 'audio/wav' })
}
;(window as unknown as { runTest: (seconds: number) => Promise<unknown> }).runTest = async (seconds: number) => {
  const blob = longWav(seconds, 500)
  const worker = new Worker('/worker.js')
  let last = performance.now(), maxGap = 0, ticks = 0
  const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++ }, 10)
  const started = performance.now()
  const progress: number[] = []
  const result = await new Promise<{ durationMs: number; beats: { bpm: number; beatsMs: number[] }; waveform: { peaks: Uint8Array } }>((resolve, reject) => {
    worker.onmessage = e => { if (e.data.type === 'progress') progress.push(e.data.fraction); if (e.data.type === 'done') resolve(e.data.result); if (e.data.type === 'error') reject(new Error(e.data.message)) }
    worker.onerror = e => reject(new Error(e.message))
    worker.postMessage({ type: 'run', source: { kind: 'blob', blob }, wants: { waveform: { bucketsPerSecond: 50 }, beats: true } })
  })
  const elapsed = performance.now() - started
  clearInterval(timer)
  // And a cancelled run really stops.
  const w2 = new Worker('/worker.js')
  const cancelled = await new Promise<boolean>(resolve => { w2.onmessage = e => { if (e.data.type === 'error') resolve(e.data.aborted === true); if (e.data.type === 'done') resolve(false) }; w2.postMessage({ type: 'run', source: { kind: 'blob', blob }, wants: { waveform: {}, beats: true } }); setTimeout(() => w2.postMessage({ type: 'cancel' }), 30) })
  return { durationMs: result.durationMs, bpm: result.beats.bpm, beats: result.beats.beatsMs.length, peaks: result.waveform.peaks.length, maxGap, ticks, elapsed, progressSteps: progress.length, cancelled }
}
