/**
 * «Igualar imagen»: measures how pictures look (luminance, contrast, saturation, colour temperature) and computes a correction that
 * makes one look like a reference. The correction is solved by measuring the picture *through the same drawing code* the viewer and the
 * exporter use (filters + warmth wash), a few times, so what is promised is what is drawn. Guards keep highlights and shadows from clipping.
 */
import type { Filters, Grade } from './composition'
import { drawWarmth, visualFilterString } from './draw'

export type PictureStats = { mean: number; std: number; sat: number; warm: number; low: number; high: number; clipHigh: number; clipLow: number }
export type MatchOptions = { brightness: boolean; contrast: boolean; warmth: boolean; color: boolean }
export const DEFAULT_MATCH: MatchOptions = { brightness: true, contrast: true, warmth: true, color: false }
type Sample = CanvasImageSource & { width: number; height: number }

const W = 96, H = 54

function canvas() {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H })
  return { c, g: c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D }
}

/** Statistics of a set of samples (several frames of a video, or one photo), as drawn with these filters and this correction. */
export function measure(samples: Sample[], filters: Filters | null, grade: { brightness: number; contrast: number; saturation: number; warmth: number } | null): PictureStats {
  const { g } = canvas()
  let n = 0, sum = 0, sum2 = 0, sat = 0, warm = 0, hi = 0, lo = 0
  const lumas: number[] = []
  for (const s of samples) {
    g.save(); g.clearRect(0, 0, W, H)
    const f = visualFilterString({ filters, grade, blur: 0 }, H)
    if (f !== 'none') g.filter = f
    const k = Math.max(W / s.width, H / s.height), dw = s.width * k, dh = s.height * k
    g.drawImage(s, (W - dw) / 2, (H - dh) / 2, dw, dh)
    if (grade?.warmth) drawWarmth(g, grade.warmth, 0, 0, W, H)
    g.restore()
    const d = g.getImageData(0, 0, W, H).data
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255
      const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b)
      sum += y; sum2 += y * y; sat += mx > 0 ? (mx - mn) / mx : 0; warm += r - b
      if (y > 0.985) hi++
      if (y < 0.015) lo++
      if ((i >> 2) % 7 === 0) lumas.push(y)
      n++
    }
  }
  const mean = sum / Math.max(1, n)
  lumas.sort((a, b) => a - b)
  return {
    mean, std: Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean)), sat: sat / Math.max(1, n), warm: warm / Math.max(1, n),
    low: lumas[Math.floor(lumas.length * 0.05)] ?? 0, high: lumas[Math.floor(lumas.length * 0.95)] ?? 1, clipHigh: hi / Math.max(1, n), clipLow: lo / Math.max(1, n),
  }
}

/** Average of several pictures' statistics (the «average» reference). */
export function averageStats(list: PictureStats[]): PictureStats {
  const keys = ['mean', 'std', 'sat', 'warm', 'low', 'high', 'clipHigh', 'clipLow'] as const
  return Object.fromEntries(keys.map(k => [k, list.reduce((a, s) => a + s[k], 0) / Math.max(1, list.length)])) as PictureStats
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The correction that makes `samples` (with the owner's `filters`) look like `ref`. Iterative: measure, adjust, measure again.
 * Never brightens into clipped whites or darkens into crushed blacks beyond what the picture already had (+2 %).
 */
export function solveMatch(samples: Sample[], filters: Filters | null, ref: PictureStats, opts: MatchOptions = DEFAULT_MATCH): Omit<Grade, 'strength'> & { before: PictureStats; after: PictureStats; limited: boolean } {
  const before = measure(samples, filters, null)
  const g = { brightness: 1, contrast: 1, saturation: 1, warmth: 0 }
  let m = before
  for (let i = 0; i < 8; i++) {
    if (opts.brightness) g.brightness = clampN(g.brightness * clampN(ref.mean / Math.max(0.02, m.mean), 0.8, 1.35), 0.35, 3)
    if (opts.contrast) g.contrast = clampN(g.contrast * clampN(ref.std / Math.max(0.01, m.std), 0.9, 1.1), 0.7, 1.45)
    if (opts.color) g.saturation = clampN(g.saturation * clampN(ref.sat / Math.max(0.01, m.sat), 0.9, 1.1), 0.7, 1.35)
    if (opts.warmth) g.warmth = clampN(g.warmth + (ref.warm - m.warm) * 2.5, -0.85, 0.85)
    m = measure(samples, filters, g)
  }
  // Guards: no new blown highlights or crushed shadows.
  for (let i = 0; i < 30 && m.clipHigh > before.clipHigh + 0.02 && g.brightness > 1; i++) { g.brightness = Math.max(1, g.brightness * 0.96); m = measure(samples, filters, g) }
  for (let i = 0; i < 8 && m.clipLow > before.clipLow + 0.02 && (g.brightness < 1 || g.contrast > 1); i++) { if (g.contrast > 1) g.contrast = Math.max(1, g.contrast - 0.04); else g.brightness = Math.min(1, g.brightness + 0.04); m = measure(samples, filters, g) }
  const r = (v: number) => Math.round(v * 1000) / 1000
  // «limited»: the reference could not be reached without burning highlights or crushing shadows (it went as far as it safely could).
  const limited = opts.brightness && Math.abs(m.mean - ref.mean) > Math.max(0.03, ref.mean * 0.12)
  return { brightness: r(g.brightness), contrast: r(g.contrast), saturation: r(g.saturation), warmth: r(g.warmth), before, after: m, limited }
}

/** Loads pictures for measuring: a photo, or a few frames across the part of a video a clip uses. */
export async function loadSamples(url: string, kind: 'image' | 'video', fromMs = 0, spanMs = 0, frames = 5): Promise<Sample[]> {
  if (kind === 'image') {
    const r = await fetch(url, { cache: 'force-cache' })
    if (!r.ok) throw new Error('No se pudo leer la imagen.')
    return [await createImageBitmap(await r.blob())]
  }
  const v = document.createElement('video')
  v.muted = true; v.preload = 'auto'; v.playsInline = true
  if (/^https?:/.test(url)) v.crossOrigin = 'anonymous'
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('No se pudo leer el vídeo.')); v.src = url })
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : fromMs + spanMs
  const span = spanMs > 0 ? spanMs : Math.max(0, dur - fromMs)
  const out: Sample[] = []
  for (let i = 0; i < frames; i++) {
    const t = Math.min(dur - 50, fromMs + (i + 0.5) / frames * span)
    await new Promise<void>(res => { const done = () => { v.removeEventListener('seeked', done); res() }; v.addEventListener('seeked', done); v.currentTime = Math.max(0, t) / 1000; setTimeout(done, 4000) })
    if (v.readyState >= 2 && v.videoWidth) out.push(await createImageBitmap(v))
  }
  v.removeAttribute('src'); v.load()
  if (!out.length) throw new Error('No se pudieron leer fotogramas del vídeo.')
  return out
}
