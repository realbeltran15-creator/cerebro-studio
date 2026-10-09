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

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }

/**
 * Plays the video muted and reads the mean luminance (0-255) of consecutive presented frames,
 * up to `maxFrames`. Seeking is avoided on purpose: WebM files recorded in the browser often lack
 * cues, so seeks land on the same frame and would hide flicker.
 */
export async function measureVideo(url: string, maxFrames = 90) {
  const v = document.createElement('video') as FrameVideo
  v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url
  await new Promise<void>((resolve, reject) => { v.onloadedmetadata = () => resolve(); v.onerror = () => reject(new Error('No se pudo leer el vídeo.')) })
  if (!Number.isFinite(v.duration)) { v.currentTime = 1e9; await new Promise(r => (v.ondurationchange = r)); v.currentTime = 0 }
  const durationMs = Math.round(v.duration * 1000)
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const lumas: number[] = []
  const sample = () => {
    ctx.drawImage(v, 0, 0, 64, 36)
    const d = ctx.getImageData(0, 0, 64, 36).data
    let s = 0
    for (let k = 0; k < d.length; k += 4) s += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]
    lumas.push(s / (d.length / 4))
  }
  if (v.requestVideoFrameCallback) {
    await new Promise<void>(resolve => {
      const onFrame = () => { sample(); if (lumas.length >= maxFrames || v.ended) { v.pause(); resolve() } else v.requestVideoFrameCallback!(onFrame) }
      v.requestVideoFrameCallback!(onFrame)
      v.onended = () => resolve()
      void v.play().catch(() => resolve())
    })
  }
  return { width: v.videoWidth, height: v.videoHeight, durationMs, audioDurationMs: await audioDurationMs(url), lumas }
}
