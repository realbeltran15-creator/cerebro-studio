/**
 * Small pictures of real video frames for the timeline (a filmstrip per clip).
 *
 * - One hidden <video> per file, seeking only to the instants asked for: the browser fetches just the parts it needs (range requests),
 *   never the whole file, and nothing is stored on the device.
 * - Frames are cached in memory per file and instant (quantised to 1/4 s), so zooming or scrolling back does not decode again.
 * - Requests are served one after another per file (and two files at a time), newest first, so a long timeline fills in progressively.
 */
export const FRAME_STEP_MS = 250
export const quantise = (ms: number) => Math.max(0, Math.round(ms / FRAME_STEP_MS) * FRAME_STEP_MS)

type Job = { assetId: string; atMs: number }
type Source = { video: HTMLVideoElement; ready: Promise<boolean>; failed: boolean }

const cache = new Map<string, string>() // `${assetId}@${ms}` → data URL
const timesOf = new Map<string, number[]>() // assetId → instants already in the cache (sorted)
const listeners = new Set<() => void>()
const sources = new Map<string, Source>()
const queue: Job[] = []
const queued = new Set<string>()
let running = 0
const MAX_PARALLEL = 2
const W = 112, H = 64

const keyOf = (assetId: string, ms: number) => `${assetId}@${ms}`
export const frameAt = (assetId: string, ms: number) => cache.get(keyOf(assetId, quantise(ms)))
/**
 * The cached frame closest to `ms` within `maxDistMs`: shown while the exact one is decoded (after zooming the tiles move to new
 * instants), so a tile never goes blank when a frame of that part of the video is already known.
 */
export function nearestFrame(assetId: string, ms: number, maxDistMs: number) {
  const ts = timesOf.get(assetId)
  if (!ts?.length) return undefined
  let best = -1, bd = Infinity
  for (const t of ts) { const d = Math.abs(t - ms); if (d < bd) { bd = d; best = t } else if (t > ms) break }
  return best >= 0 && bd <= maxDistMs ? cache.get(keyOf(assetId, best)) : undefined
}
export function onFrames(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
const notify = () => { for (const fn of listeners) fn() }

function sourceFor(assetId: string, resolveUrl: (id: string) => Promise<string>): Source {
  const s0 = sources.get(assetId)
  if (s0) return s0
  const video = document.createElement('video')
  video.muted = true; video.preload = 'metadata'; video.playsInline = true
  const src: Source = { video, failed: false, ready: Promise.resolve(false) }
  src.ready = resolveUrl(assetId).then(url => new Promise<boolean>(res => {
    if (/^https?:/.test(url)) video.crossOrigin = 'anonymous'
    video.onloadedmetadata = () => res(true)
    video.onerror = () => { src.failed = true; res(false) }
    video.src = url
  }), () => { src.failed = true; return false })
  sources.set(assetId, src)
  return src
}

async function grab(src: Source, ms: number): Promise<string | null> {
  const v = src.video
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null
  const t = Math.min(ms / 1000, dur !== null ? Math.max(0, dur - 0.05) : ms / 1000)
  await new Promise<void>(res => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(timer); res() }
    const timer = setTimeout(done, 4000)
    v.addEventListener('seeked', done)
    v.currentTime = t
  })
  if (v.readyState < 2 || !v.videoWidth) return null
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  if (!g) return null
  // Cover: fill the tile, cropping the longer side.
  const k = Math.max(W / v.videoWidth, H / v.videoHeight)
  const dw = v.videoWidth * k, dh = v.videoHeight * k
  g.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh)
  try { return c.toDataURL('image/jpeg', 0.7) } catch { return null }
}

const runningFor = new Set<string>()
async function pump(resolveUrl: (id: string) => Promise<string>) {
  while (running < MAX_PARALLEL) {
    // Newest request first (what is on screen now), one seek at a time per file.
    let i = queue.length - 1
    while (i >= 0 && runningFor.has(queue[i].assetId)) i--
    if (i < 0) return
    const job = queue.splice(i, 1)[0]
    running++; runningFor.add(job.assetId)
    void (async () => {
      try {
        const src = sourceFor(job.assetId, resolveUrl)
        if (await src.ready && !src.failed) {
          const url = await grab(src, job.atMs)
          if (url) { cache.set(keyOf(job.assetId, job.atMs), url); const ts = timesOf.get(job.assetId) ?? []; ts.push(job.atMs); ts.sort((a, b) => a - b); timesOf.set(job.assetId, ts); notify() }
        }
      } catch { /* a frame that cannot be read leaves the tile with its colour */ }
      finally { queued.delete(keyOf(job.assetId, job.atMs)); running--; runningFor.delete(job.assetId); void pump(resolveUrl) }
    })()
  }
}


/** Asks for the frames of a file at these instants (already cached ones are ignored). */
export function requestFrames(assetId: string, times: number[], resolveUrl: (id: string) => Promise<string>) {
  let added = false
  for (const ms of times.map(quantise)) {
    const k = keyOf(assetId, ms)
    if (cache.has(k) || queued.has(k)) continue
    queued.add(k); queue.push({ assetId, atMs: ms }); added = true
  }
  // Keep the queue short: very old requests (scrolled away) are dropped first.
  while (queue.length > 400) { const j = queue.shift()!; queued.delete(keyOf(j.assetId, j.atMs)) }
  if (added) void pump(resolveUrl)
}

/** Source instants for `tiles` tiles across a clip (centre of each tile). */
export function tileTimes(trimInMs: number, durationMs: number, speed: number, tiles: number) {
  const span = durationMs * (speed || 1)
  return Array.from({ length: tiles }, (_, i) => quantise(trimInMs + (i + 0.5) / tiles * span))
}

/** For tests: forget everything cached. */
export function resetFrames() { cache.clear(); timesOf.clear(); queued.clear(); queue.length = 0; for (const s of sources.values()) s.video.removeAttribute('src'); sources.clear() }
