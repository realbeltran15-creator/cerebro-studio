/**
 * Real measurements taken in the browser for the automated quality checks:
 * dimensions, video/audio duration and mean frame luminance (flicker). Nothing is estimated.
 */

export async function measureImage(url: string) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  return { width: img.naturalWidth, height: img.naturalHeight }
}

async function audioDurationMs(url: string): Promise<number | null> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())
    return Math.round(buf.duration * 1000)
  } catch { return null } finally { await ctx.close() }
}

const seek = (v: HTMLVideoElement, t: number) => new Promise<void>((resolve, reject) => {
  const done = () => { v.removeEventListener('seeked', done); resolve() }
  v.addEventListener('seeked', done)
  v.onerror = () => reject(new Error('No se pudo leer el vídeo.'))
  v.currentTime = t
})

/** Samples up to `samples` frames evenly and returns their mean luminance (0-255). */
export async function measureVideo(url: string, samples = 24) {
  const v = document.createElement('video')
  v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.src = url
  await new Promise<void>((resolve, reject) => { v.onloadedmetadata = () => resolve(); v.onerror = () => reject(new Error('No se pudo leer el vídeo.')) })
  if (!Number.isFinite(v.duration)) { v.currentTime = 1e9; await new Promise(r => (v.ondurationchange = r)) }
  const durationMs = Math.round(v.duration * 1000)
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const lumas: number[] = []
  const n = Math.max(3, Math.min(samples, Math.floor(v.duration * 8)))
  for (let i = 0; i < n; i++) {
    await seek(v, (v.duration * (i + 0.5)) / n)
    ctx.drawImage(v, 0, 0, 64, 36)
    const d = ctx.getImageData(0, 0, 64, 36).data
    let s = 0
    for (let k = 0; k < d.length; k += 4) s += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]
    lumas.push(s / (d.length / 4))
  }
  return { width: v.videoWidth, height: v.videoHeight, durationMs, audioDurationMs: await audioDurationMs(url), lumas }
}
