import { isInstagramReadyMp4, mp4Codecs } from './container'

/**
 * Browser-side conversion of a rendered video to an MP4 that Instagram Reels, TikTok and YouTube take:
 * H.264 (High profile, yuv420p, constant 30 fps) + AAC, with `moov` first. It re-encodes (a VP9/WebM file is never
 * just renamed) using ffmpeg.wasm, loaded lazily and only when the user asks for it.
 *
 * The small MIT wrapper (@ffmpeg/ffmpeg 0.12.15, ~48 KB) is vendored unmodified in public/vendor/ffmpeg and imported at run time
 * from our own origin: the bundler cannot follow its dynamically built worker URL, and a same-origin worker is required anyway.
 *
 * Licensing: the wrapper is MIT, but the ffmpeg core build that contains x264 (@ffmpeg/core) is
 * GPL-2.0-or-later and ~32 MB. It is NOT bundled or committed here: the app loads it from the URL in
 * NEXT_PUBLIC_FFMPEG_CORE_BASE_URL (a folder holding ffmpeg-core.js and ffmpeg-core.wasm, e.g. a pinned jsDelivr path).
 * Leaving the variable unset keeps this feature off. Enabling it is the owner's licensing decision.
 */
export type TranscodeConfig = { baseUrl: string; /** Overrides where the vendored wrapper lives (tests). */ vendorBase?: string }

export function transcodeConfigFromEnv(): TranscodeConfig | null {
  const base = (process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL ?? '').trim().replace(/\/+$/, '')
  return /^https:\/\/[^\s]+$/.test(base) ? { baseUrl: base } : null
}

export const H264_MIME = 'video/mp4;codecs=avc1.640028,mp4a.40.2'
export const MAX_TRANSCODE_BYTES = 200 * 1024 * 1024

/** ffmpeg arguments. Kept separate so they can be tested and reviewed. */
export function transcodeArgs(input: string, output: string) {
  return [
    '-i', input,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-y', output,
  ]
}

export class TranscodeError extends Error {}

type FFmpegInstance = {
  on: (event: 'progress', cb: (e: { progress: number }) => void) => void
  load: (config: { coreURL: string; wasmURL: string; classWorkerURL?: string }) => Promise<boolean>
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>
  readFile: (path: string) => Promise<Uint8Array | string>
  exec: (args: string[], timeout?: number) => Promise<number>
  terminate: () => void
}

/** Where the vendored wrapper is served from (our own origin). */
export const VENDOR_BASE = '/vendor/ffmpeg'

/** Downloads a file and exposes it as a blob: URL, so the worker can load a core hosted on another origin. */
async function toBlobUrl(url: string, type: string) {
  const r = await fetch(url, { cache: 'force-cache' })
  if (!r.ok) throw new Error(`${r.status} al descargar ${new URL(url).pathname.split('/').pop()}`)
  return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }))
}

async function loadWrapper(vendorBase: string): Promise<new () => FFmpegInstance> {
  const url = `${vendorBase}/index.js`
  // Not analysable by the bundler on purpose: the file is served as-is from /public.
  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as { FFmpeg: new () => FFmpegInstance }
  return mod.FFmpeg
}

export async function transcodeToCompatibleMp4(input: Blob, opts: { config: TranscodeConfig; onProgress?: (fraction: number) => void; signal?: AbortSignal; timeoutMs?: number }) {
  if (!input.size) throw new TranscodeError('El vídeo está vacío.')
  if (input.size > MAX_TRANSCODE_BYTES) throw new TranscodeError('El vídeo es demasiado grande para convertirlo en el navegador (máximo 200 MB).')
  const FFmpeg = await loadWrapper(opts.config.vendorBase ?? VENDOR_BASE).catch(() => { throw new TranscodeError('No se pudo cargar el convertidor de vídeo. Recarga la página o renderiza en Chrome, Edge o Safari.') })
  const ffmpeg = new FFmpeg()
  const abort = () => ffmpeg.terminate()
  opts.signal?.addEventListener('abort', abort, { once: true })
  try {
    if (opts.signal?.aborted) throw new TranscodeError('Conversión cancelada.')
    ffmpeg.on('progress', ({ progress }) => { if (Number.isFinite(progress)) opts.onProgress?.(Math.min(Math.max(progress, 0), 1)) })
    const base = opts.config.baseUrl
    try {
      await ffmpeg.load({
        coreURL: await toBlobUrl(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobUrl(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      })
    } catch (e) {
      throw new TranscodeError(`No se pudo cargar el convertidor de vídeo (${e instanceof Error ? e.message : 'error de red'}). Comprueba la conexión o vuelve a renderizar en Chrome, Edge o Safari.`)
    }
    await ffmpeg.writeFile('in.media', new Uint8Array(await input.arrayBuffer()))
    const code = await ffmpeg.exec(transcodeArgs('in.media', 'out.mp4'), opts.timeoutMs ?? 20 * 60_000)
    if (code !== 0) throw new TranscodeError(`La conversión falló (código ${code}).`)
    const data = await ffmpeg.readFile('out.mp4')
    if (typeof data === 'string' || !data.length) throw new TranscodeError('La conversión no produjo ningún archivo.')
    // Verify what came out instead of trusting the command: read the codecs from the container itself.
    if (!isInstagramReadyMp4(data)) throw new TranscodeError(`El resultado no es H.264/AAC (se obtuvo ${JSON.stringify(mp4Codecs(data))}).`)
    return { blob: new Blob([data as BlobPart], { type: 'video/mp4' }), mimeType: H264_MIME, codecs: mp4Codecs(data) }
  } catch (e) {
    if (opts.signal?.aborted) throw new TranscodeError('Conversión cancelada.')
    throw e
  } finally {
    opts.signal?.removeEventListener('abort', abort)
    ffmpeg.terminate()
  }
}
