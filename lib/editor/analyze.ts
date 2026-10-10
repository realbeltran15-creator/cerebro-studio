'use client'
/**
 * Browser-side signal extraction for the automatic edit. Runs locally (no uploads, no AI cost).
 */

/** Loudness per window (RMS of the mixed-down channels). */
export async function loudness(blob: Blob, windowMs = 50) {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const size = Math.max(1, Math.round(buf.sampleRate * windowMs / 1000))
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
    const out: number[] = []
    for (let i = 0; i < buf.length; i += size) {
      let sum = 0, n = 0
      for (let j = i; j < Math.min(buf.length, i + size); j++) { let v = 0; for (const c of chans) v += c[j]; v /= chans.length; sum += v * v; n++ }
      out.push(Math.sqrt(sum / Math.max(1, n)))
    }
    return { rms: out, durationMs: Math.round(buf.duration * 1000) }
  } catch {
    return { rms: [] as number[], durationMs: 0 } // no audio track
  } finally { await ctx.close() }
}

/** Mean absolute difference between consecutive downscaled frames, sampled at `fps`. */
export async function frameDifferences(blob: Blob, fps = 4, onProgress?: (f: number) => void) {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url
  try {
    await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('No se pudo leer el vídeo en este navegador.')) })
    const duration = video.duration
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36
    const g = canvas.getContext('2d', { willReadFrequently: true })!
    const diffs: number[] = []
    let prev: Uint8ClampedArray | null = null
    const steps = Math.floor(duration * fps)
    for (let i = 0; i <= steps; i++) {
      video.currentTime = Math.min(duration - 0.01, i / fps)
      await new Promise<void>(r => { video.onseeked = () => r() })
      g.drawImage(video, 0, 0, 64, 36)
      const px = g.getImageData(0, 0, 64, 36).data
      if (prev) { let d = 0; for (let k = 0; k < px.length; k += 4) d += Math.abs(px[k] - prev[k]) + Math.abs(px[k + 1] - prev[k + 1]) + Math.abs(px[k + 2] - prev[k + 2]); diffs.push(d / (px.length / 4) / 765) }
      prev = px
      onProgress?.(i / Math.max(1, steps))
    }
    return { diffs, durationMs: Math.round(duration * 1000), width: video.videoWidth, height: video.videoHeight }
  } finally { URL.revokeObjectURL(url) }
}
