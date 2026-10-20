import { isInstagramReadyMp4, mp4Codecs } from './container'
import { H264_MIME, MAX_TRANSCODE_BYTES, TranscodeError } from './transcode'

/**
 * Converts a rendered video (WebM VP8/VP9 + Opus from Firefox, for example) to MP4 H.264 + AAC WITHOUT any GPL component.
 *
 * - Video: the browser's own H.264 encoder through WebCodecs. Browser vendors hold the H.264 licence for it; nothing is shipped.
 * - Audio: the browser's AAC encoder when it has one. Firefox (every platform) and browsers on desktop Linux have none, so only then
 *   the @mediabunny/aac-encoder extension is loaded: FFmpeg's native AAC encoder (LGPL-2.1-or-later part of libavcodec, no x264,
 *   no GPL code) compiled to WASM. It is a separate chunk downloaded on demand, unmodified; see docs/licencias-terceros.md.
 * - Container: Mediabunny (MPL-2.0, unmodified), with `moov` first (fast start).
 *
 * Used before the ffmpeg.wasm path, which stays as an optional fallback only when the owner configures a core URL.
 */
export type NativeSupport = { video: boolean; audio: 'native' | 'extension' | 'none' }

type MB = typeof import('mediabunny')
let mbPromise: Promise<MB> | null = null
const loadMb = () => (mbPromise ??= import('mediabunny'))
let aacRegistered = false

/** Whether this browser can produce H.264 (and AAC, natively or with the extension). Never throws. */
export async function nativeSupport(): Promise<NativeSupport> {
  try {
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return { video: false, audio: 'none' }
    const mb = await loadMb()
    const video = await mb.canEncodeVideo('avc', { width: 1280, height: 720 })
    const native = typeof AudioEncoder !== 'undefined' && await mb.canEncodeAudio('aac')
    return { video, audio: native ? 'native' : typeof WebAssembly === 'object' ? 'extension' : 'none' }
  } catch { return { video: false, audio: 'none' } }
}

export async function transcodeWithWebCodecs(input: Blob, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal; /** Tests: use the AAC extension even when the browser has a native encoder (the path Firefox takes). */ forceAacExtension?: boolean } = {}) {
  if (!input.size) throw new TranscodeError('El vídeo está vacío.')
  if (input.size > MAX_TRANSCODE_BYTES) throw new TranscodeError('El vídeo es demasiado grande para convertirlo en el navegador (máximo 200 MB).')
  const detected = await nativeSupport()
  const support: NativeSupport = opts.forceAacExtension ? { ...detected, audio: 'extension' } : detected
  if (!support.video) throw new TranscodeError('Este navegador no puede codificar H.264. Renderiza con Chrome, Edge o Safari para obtener un MP4 compatible.')
  const mb = await loadMb()
  if (support.audio === 'extension' && !aacRegistered) {
    try { const { registerAacEncoder } = await import('@mediabunny/aac-encoder'); registerAacEncoder(); aacRegistered = true }
    catch { throw new TranscodeError('No se pudo cargar el codificador de audio AAC. Recarga la página e inténtalo de nuevo.') }
  }
  if (opts.signal?.aborted) throw new TranscodeError('Conversión cancelada.')

  const source = new mb.Input({ source: new mb.BlobSource(input), formats: mb.ALL_FORMATS })
  const target = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  let conversion: Awaited<ReturnType<MB['Conversion']['init']>>
  try {
    conversion = await mb.Conversion.init({
      input: source, output, tracks: 'primary',
      // Even dimensions and constant 30 fps, as the platforms expect (same choices as the ffmpeg path).
      video: track => ({ codec: 'avc', forceTranscode: true, frameRate: 30, bitrate: mb.QUALITY_HIGH, width: track.displayWidth - (track.displayWidth % 2), height: track.displayHeight - (track.displayHeight % 2), fit: 'fill' }),
      audio: { codec: 'aac', forceTranscode: true, bitrate: 128_000, sampleRate: 48_000, numberOfChannels: 2 },
    })
  } catch (e) {
    throw new TranscodeError(`No se pudo leer el vídeo (${e instanceof Error ? e.message : 'formato no reconocido'}).`)
  }
  if (!conversion.isValid || !conversion.utilizedTracks.some(t => t.type === 'video')) {
    const why = conversion.discardedTracks.map(d => `${d.track.type}: ${d.reason}`).join(', ') || 'sin pista de vídeo'
    throw new TranscodeError(`Este navegador no puede convertir este vídeo (${why}).`)
  }
  conversion.onProgress = p => { if (Number.isFinite(p)) opts.onProgress?.(Math.min(Math.max(p, 0), 1)) }
  const abort = () => { void conversion.cancel() }
  opts.signal?.addEventListener('abort', abort, { once: true })
  try {
    await conversion.execute()
  } catch (e) {
    if (opts.signal?.aborted) throw new TranscodeError('Conversión cancelada.')
    throw new TranscodeError(`La conversión falló (${e instanceof Error ? e.message : 'error desconocido'}).`)
  } finally {
    opts.signal?.removeEventListener('abort', abort)
  }
  if (opts.signal?.aborted || conversion.state === 'canceled') throw new TranscodeError('Conversión cancelada.')
  const data = target.buffer ? new Uint8Array(target.buffer) : new Uint8Array()
  if (!data.length) throw new TranscodeError('La conversión no produjo ningún archivo.')
  // Verify what came out instead of trusting the settings: read the codecs from the container itself.
  if (!isInstagramReadyMp4(data)) throw new TranscodeError(`El resultado no es H.264/AAC (se obtuvo ${JSON.stringify(mp4Codecs(data))}).`)
  return { blob: new Blob([data as BlobPart], { type: 'video/mp4' }), mimeType: H264_MIME, codecs: mp4Codecs(data), tool: support.audio === 'extension' ? 'webcodecs+aac-wasm' : 'webcodecs' }
}
