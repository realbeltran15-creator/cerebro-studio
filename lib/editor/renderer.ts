/**
 * Browser exporter: plays the montage once with the same player the editor previews with (scene.ts + draw.ts + player.ts), and records
 * the canvas and the mix with MediaRecorder into MP4 (WebM where the browser cannot record MP4). What the preview shows is what is exported.
 * Runs in real time: the tab must stay visible. When a clip is still loading the recording pauses instead of skipping.
 */
import { exportPlan, projectDurationMs, type Composition } from './composition'
import { EditorPlayer, blobResolver } from './player'
import type { KindOf } from './scene'
import { ensureWebmDuration } from './webm-duration'

export { activeWordIndex } from './draw'

export type MediaSource = { kind: 'image' | 'video' | 'audio'; blob: Blob }

export type RenderOptions = {
  composition: Composition
  canvas: HTMLCanvasElement
  /** Media already in memory, by asset id. */
  media?: Map<string, MediaSource>
  /** Or: streamed media (signed URLs), so long montages never have to fit in memory. */
  resolveUrl?: (assetId: string, refresh?: boolean) => Promise<string>
  kindOf?: KindOf
  record: boolean
  onProgress?: (elapsedMs: number, totalMs: number) => void
  signal?: AbortSignal
}

export type RenderResult = { blob: Blob | null; mimeType: string | null; durationMs: number }

export function recordingSupported() {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

/**
 * MP4 (H.264 + AAC) first: it is what Instagram Reels requires and what every platform and player
 * accepts. Chrome/Edge 126+ and Safari record MP4 natively; Firefox falls back to WebM.
 */
export const MP4_CANDIDATES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2']
export const WEBM_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

export function pickMimeType(supports: (t: string) => boolean = t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
  // Explicit H.264 MP4 first; plain "video/mp4" (codec chosen by the browser, may not be H.264) only as a last resort.
  return [...MP4_CANDIDATES, ...WEBM_CANDIDATES, 'video/mp4'].find(supports) ?? null
}

export async function renderComposition(opts: RenderOptions): Promise<RenderResult> {
  const { composition, canvas, record, onProgress, signal } = opts
  // Same plan as the export controls: the size and bitrate shown before rendering are the ones used.
  const plan = exportPlan(composition)
  canvas.width = plan.width; canvas.height = plan.height
  const total = projectDurationMs(composition)
  const blobs = opts.media ? blobResolver(opts.media) : null
  const resolveUrl = opts.resolveUrl ?? blobs?.resolve
  if (!resolveUrl) throw new Error('No hay recursos para renderizar.')
  const kindOf: KindOf = opts.kindOf ?? (id => opts.media?.get(id)?.kind ?? null)
  let failure: string | null = null
  const player = new EditorPlayer({ canvas, resolveUrl, kindOf, output: record ? 'stream' : 'speakers', onError: m => { failure ??= m } })
  player.setComposition(composition)

  let recorder: MediaRecorder | null = null
  let videoTrack: CanvasCaptureMediaStreamTrack | null = null
  const chunks: Blob[] = []
  const mimeType = record ? pickMimeType() : null
  try {
    if (record) {
      if (!mimeType || !player.stream) throw new Error('Este navegador no puede grabar vídeo. Usa Chrome, Edge, Safari o Firefox de escritorio.')
      // Frames are pushed explicitly after each draw: with automatic capture, static images can leave
      // the encoder holding an earlier frame (e.g. mid-fade) for a long stretch.
      const stream = canvas.captureStream(0)
      videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      player.stream.getAudioTracks().forEach(t => stream.addTrack(t))
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: plan.videoBps, audioBitsPerSecond: plan.audioBps })
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    }
    await player.preload(0)
    if (signal?.aborted) return { blob: null, mimeType: null, durationMs: 0 }
    recorder?.start(1000)
    await player.playForExport({
      signal,
      onFrame: t => { videoTrack?.requestFrame(); onProgress?.(t, total) },
      onStall: stalled => { if (!recorder) return; if (stalled && recorder.state === 'recording') recorder.pause(); else if (!stalled && recorder.state === 'paused') recorder.resume() },
    })
    if (failure && !signal?.aborted) throw new Error(failure)
    let blob: Blob | null = null
    if (recorder) {
      const stopped = new Promise<void>(r => { recorder!.onstop = () => r() })
      if (recorder.state !== 'inactive') recorder.stop()
      await stopped
      blob = signal?.aborted ? null : await ensureWebmDuration(new Blob(chunks, { type: (recorder.mimeType || mimeType || 'video/webm').split(';')[0] }), total)
    }
    onProgress?.(total, total)
    return { blob, mimeType: recorder?.mimeType || mimeType, durationMs: total }
  } finally {
    if (recorder && recorder.state !== 'inactive') try { recorder.stop() } catch { /* already stopped */ }
    player.destroy()
    blobs?.revoke()
  }
}
