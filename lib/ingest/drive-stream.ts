/**
 * Upload to Google Drive WHILE the video is being produced: a WritableStream that receives the exporter's sequential output and sends
 * it to Drive's resumable-upload session in 8 MiB blocks (Drive's documented protocol for a file whose total size is not known yet:
 * `Content-Range: bytes a-b/*` for every block and the real total on the last one).
 *
 * Nothing is written to this computer's disk: at most three blocks live in memory (the one being sent, the one being filled and the
 * exporter's own chunk). It needs an append-only file, which is what `fastStart: 'fragmented'` produces; a seek (a write before the
 * end of what was already sent) is refused instead of corrupting the file.
 *
 * A dropped connection continues from the byte Drive already holds (the block in flight is kept until Drive confirms it). If the
 * whole export is interrupted (tab closed, crash) the encoder cannot resume, so the unfinished upload is cancelled; nothing is left
 * on Drive as a finished file.
 */
import { DRIVE_CHUNK, driveError, parseRange, type DriveUploadResult } from './drive-upload'

type Fetch = typeof fetch
export type SinkChunk = { type: 'write'; data: Uint8Array; position: number }
export type DriveSinkStats = { sentBytes: number; receivedBytes: number; peakBufferedBytes: number; blocks: number; retries: number }

export async function openDriveSink(o: {
  name: string; mimeType: string; token: string; folderId?: string
  onProgress?: (sentBytes: number) => void; signal?: AbortSignal; fetchImpl?: Fetch; block?: number; maxRetries?: number; retryDelayMs?: number
}): Promise<{ writable: WritableStream<SinkChunk>; result: Promise<DriveUploadResult>; stats: () => DriveSinkStats }> {
  const f = o.fetchImpl ?? fetch
  const block = o.block ?? DRIVE_CHUNK
  if (block % (256 * 1024) !== 0) throw new Error('El tamaño de bloque debe ser múltiplo de 256 KiB.')
  const maxRetries = o.maxRetries ?? 5
  const auth = { Authorization: `Bearer ${o.token}` }
  // The session is opened BEFORE rendering, so a bad folder or an expired permission fails now and not after an hour of work.
  const start = await f('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink', {
    method: 'POST', signal: o.signal,
    headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': o.mimeType },
    body: JSON.stringify({ name: o.name, mimeType: o.mimeType, ...(o.folderId ? { parents: [o.folderId] } : {}) }),
  })
  if (!start.ok) throw new Error(driveError(start.status))
  const session = start.headers.get('Location')
  if (!session) throw new Error('Drive no devolvió la sesión de subida.')

  const st: DriveSinkStats = { sentBytes: 0, receivedBytes: 0, peakBufferedBytes: 0, blocks: 0, retries: 0 }
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let inflight: Promise<void> | null = null
  let inflightBytes = 0
  let failure: unknown = null
  let finish!: { resolve: (r: DriveUploadResult) => void; reject: (e: unknown) => void }
  const result = new Promise<DriveUploadResult>((resolve, reject) => { finish = { resolve, reject } })
  result.catch(() => undefined) // reported through the stream; never an unhandled rejection
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const noteBuffered = () => { st.peakBufferedBytes = Math.max(st.peakBufferedBytes, pendingBytes + inflightBytes) }

  async function resumePoint(): Promise<number> {
    const r = await f(session!, { method: 'PUT', signal: o.signal, headers: { 'Content-Range': 'bytes */*' } })
    if (r.status === 308) return parseRange(r.headers.get('Range')) ?? 0
    if (r.status === 200 || r.status === 201) throw new Error('Drive ya dio el archivo por terminado antes de tiempo.')
    throw new Error(driveError(r.status))
  }

  /** Sends bytes [from, from+len) and returns Drive's answer when it was the final block. */
  async function put(bytes: Uint8Array, from: number, total: number | null): Promise<DriveUploadResult | null> {
    let offset = 0 // bytes of this block Drive already holds
    let tries = 0, spin = 0
    for (;;) {
      if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
      const a = from + offset, len = bytes.byteLength - offset
      const range = len > 0 ? `bytes ${a}-${a + len - 1}/${total ?? '*'}` : `bytes */${total}`
      let r: Response
      try {
        r = await f(session!, { method: 'PUT', signal: o.signal, headers: { 'Content-Range': range }, body: len > 0 ? (bytes.subarray(offset) as BodyInit) : undefined })
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        if (++tries > maxRetries) throw new Error('Se perdió la conexión con Drive y no se pudo continuar.')
        st.retries++
        await sleep((o.retryDelayMs ?? 500) * tries)
        offset = Math.max(0, await resumePoint() - from)
        continue
      }
      if (r.status === 200 || r.status === 201) {
        if (total === null) throw new Error('Drive dio el archivo por terminado antes de tiempo.')
        const j = await r.json() as { id: string; name: string; size?: string; webViewLink?: string }
        return { id: j.id, name: j.name, size: Number(j.size ?? total), webViewLink: j.webViewLink }
      }
      if (r.status === 308) {
        const held = parseRange(r.headers.get('Range')) ?? 0
        if (held < from) throw new Error('Drive perdió bytes ya confirmados; hay que volver a exportar.')
        offset = held - from
        if (offset >= bytes.byteLength) { if (total === null) return null; if (++spin > 3) throw new Error('Drive no confirmó el final del archivo.'); continue }
        tries = 0
        continue
      }
      if ((r.status >= 500 || r.status === 429) && ++tries <= maxRetries) { st.retries++; await sleep((o.retryDelayMs ?? 500) * tries); offset = Math.max(0, await resumePoint() - from); continue }
      throw new Error(driveError(r.status))
    }
  }

  const take = (n: number) => {
    const out = new Uint8Array(n); let at = 0
    while (at < n) {
      const head = pending[0]!
      const use = Math.min(head.byteLength, n - at)
      out.set(head.subarray(0, use), at); at += use
      if (use === head.byteLength) pending.shift(); else pending[0] = head.subarray(use)
    }
    pendingBytes -= n
    return out
  }

  /** Sends one full block in the background; the next one waits for it (so memory stays bounded). */
  async function flushFullBlocks() {
    while (pendingBytes >= block) {
      if (inflight) await inflight
      if (failure) throw failure
      const bytes = take(block)
      const from = st.sentBytes
      inflightBytes = bytes.byteLength
      st.sentBytes += bytes.byteLength; st.blocks++
      inflight = put(bytes, from, null).then(() => { inflightBytes = 0; o.onProgress?.(from + bytes.byteLength) }, e => { failure = e; inflightBytes = 0 })
    }
  }

  const cancelSession = () => { void f(session!, { method: 'DELETE', headers: { ...auth } }).catch(() => undefined) }

  const writable = new WritableStream<SinkChunk>({
    async write(chunk) {
      try {
        if (failure) throw failure
        if (chunk.position !== st.receivedBytes) throw new Error('El vídeo no se genera en orden y no puede enviarse a Drive mientras se renderiza. Usa «con temporal local».')
        const copy = chunk.data.slice() // the exporter may reuse its buffer
        pending.push(copy); pendingBytes += copy.byteLength; st.receivedBytes += copy.byteLength
        noteBuffered()
        await flushFullBlocks()
      } catch (e) { pending = []; pendingBytes = 0; cancelSession(); finish.reject(e); throw e }
    },
    async close() {
      try {
        if (inflight) await inflight
        if (failure) throw failure
        const total = st.receivedBytes
        if (!total) throw new Error('No se generó ningún vídeo que subir.')
        const rest = take(pendingBytes)
        const done = await put(rest, st.sentBytes, total)
        st.sentBytes = total
        o.onProgress?.(total)
        if (!done) throw new Error('Drive no confirmó el archivo completo.')
        finish.resolve(done)
      } catch (e) { cancelSession(); finish.reject(e); throw e }
    },
    async abort(reason) {
      pending = []; pendingBytes = 0
      cancelSession()
      finish.reject(reason ?? new DOMException('Cancelado', 'AbortError'))
    },
  })
  return { writable, result, stats: () => ({ ...st }) }
}
