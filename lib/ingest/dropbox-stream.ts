/**
 * Upload to Dropbox WHILE the video is being produced, with Dropbox's upload sessions (upload_session/start → append_v2 … → finish).
 * Same contract as the Drive sink: it receives the exporter's sequential output (a fragmented MP4 is append-only), sends it in
 * 8 MiB blocks (a multiple of 4 MiB, as Dropbox recommends), keeps at most the block being sent and the one being filled in memory,
 * and writes nothing to this computer's disk. A dropped connection continues from the offset Dropbox reports; a seek is refused.
 * An interrupted export leaves no file: the unfinished session is never committed (Dropbox discards it by itself).
 */
import type { SinkChunk } from './drive-stream'

type Fetch = typeof fetch
export const DROPBOX_BLOCK = 8 * 1024 * 1024
export type DropboxResult = { id: string; name: string; size: number; path: string }
export type DropboxSinkStats = { sentBytes: number; receivedBytes: number; peakBufferedBytes: number; blocks: number; retries: number }

/** Dropbox-API-Arg travels in an HTTP header: everything outside ASCII must be sent as \uXXXX. */
export const dropboxArg = (o: unknown) => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

export function dropboxError(status: number, body = ''): string {
  if (status === 401) return 'Dropbox rechazó el permiso (caducó). Vuelve a conectar Dropbox.'
  if (status === 409 && /insufficient_space/.test(body)) return 'Tu Dropbox no tiene espacio suficiente para este vídeo.'
  if (status === 409 && /path\/(conflict|malformed_path|no_write_permission)/.test(body)) return 'Dropbox no permite guardar el archivo en esa ruta.'
  if (status === 429) return 'Dropbox pide ir más despacio (demasiadas peticiones).'
  return `Dropbox respondió con el error ${status}.`
}

export async function openDropboxSink(o: {
  path: string; token: string
  onProgress?: (sentBytes: number) => void; signal?: AbortSignal; fetchImpl?: Fetch; block?: number; maxRetries?: number; retryDelayMs?: number
}): Promise<{ writable: WritableStream<SinkChunk>; result: Promise<DropboxResult>; stats: () => DropboxSinkStats }> {
  const f = o.fetchImpl ?? fetch
  const block = o.block ?? DROPBOX_BLOCK
  const maxRetries = o.maxRetries ?? 5
  const base = { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/octet-stream' }
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  // The session is opened BEFORE rendering: an expired permission fails now, not after hours of work.
  const start = await f('https://content.dropboxapi.com/2/files/upload_session/start', { method: 'POST', signal: o.signal, headers: { ...base, 'Dropbox-API-Arg': dropboxArg({ close: false }) } })
  if (!start.ok) throw new Error(dropboxError(start.status, await start.text().catch(() => '')))
  const sessionId = ((await start.json()) as { session_id?: string }).session_id
  if (!sessionId) throw new Error('Dropbox no devolvió la sesión de subida.')

  const st: DropboxSinkStats = { sentBytes: 0, receivedBytes: 0, peakBufferedBytes: 0, blocks: 0, retries: 0 }
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let inflight: Promise<void> | null = null
  let inflightBytes = 0
  let failure: unknown = null
  let finish!: { resolve: (r: DropboxResult) => void; reject: (e: unknown) => void }
  const result = new Promise<DropboxResult>((resolve, reject) => { finish = { resolve, reject } })
  result.catch(() => undefined)
  const noteBuffered = () => { st.peakBufferedBytes = Math.max(st.peakBufferedBytes, pendingBytes + inflightBytes) }

  /** One call (append or finish) with retries; after a lost answer Dropbox says which offset it holds and sending continues from there. */
  async function call(endpoint: 'append_v2' | 'finish', bytes: Uint8Array, from: number): Promise<Response> {
    let sent = 0, tries = 0
    for (;;) {
      if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
      const cursor = { session_id: sessionId, offset: from + sent }
      const arg = endpoint === 'append_v2' ? { cursor, close: false } : { cursor, commit: { path: o.path, mode: 'add', autorename: true, mute: false } }
      let r: Response
      try {
        r = await f(`https://content.dropboxapi.com/2/files/upload_session/${endpoint}`, { method: 'POST', signal: o.signal, headers: { ...base, 'Dropbox-API-Arg': dropboxArg(arg) }, body: bytes.subarray(sent) as BodyInit })
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        if (++tries > maxRetries) throw new Error('Se perdió la conexión con Dropbox y no se pudo continuar.')
        st.retries++; await sleep((o.retryDelayMs ?? 500) * tries); continue
      }
      if (r.ok) return r
      const text = await r.text().catch(() => '')
      if (r.status === 409 && /incorrect_offset/.test(text)) {
        const held = Number((/"correct_offset"\s*:\s*(\d+)/.exec(text) ?? [])[1])
        if (!Number.isFinite(held) || held < from) throw new Error('Dropbox perdió bytes ya confirmados; hay que volver a exportar.')
        sent = held - from
        if (sent > bytes.byteLength) throw new Error('Dropbox tiene más bytes de los enviados; hay que volver a exportar.')
        if (endpoint === 'append_v2' && sent === bytes.byteLength) return r // the block had arrived; only the answer was lost
        if (++tries > maxRetries) throw new Error(dropboxError(r.status, text))
        continue
      }
      if ((r.status >= 500 || r.status === 429) && ++tries <= maxRetries) { st.retries++; await sleep((o.retryDelayMs ?? 500) * tries); continue }
      throw new Error(dropboxError(r.status, text))
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

  async function flushFullBlocks() {
    while (pendingBytes >= block) {
      if (inflight) await inflight
      if (failure) throw failure
      const bytes = take(block), from = st.sentBytes
      inflightBytes = bytes.byteLength
      st.sentBytes += bytes.byteLength; st.blocks++
      inflight = call('append_v2', bytes, from).then(() => { inflightBytes = 0; o.onProgress?.(from + bytes.byteLength) }, e => { failure = e; inflightBytes = 0 })
    }
  }

  const writable = new WritableStream<SinkChunk>({
    async write(chunk) {
      try {
        if (failure) throw failure
        if (chunk.position !== st.receivedBytes) throw new Error('El vídeo no se genera en orden y no puede enviarse a Dropbox mientras se renderiza.')
        const copy = chunk.data.slice()
        pending.push(copy); pendingBytes += copy.byteLength; st.receivedBytes += copy.byteLength
        noteBuffered()
        await flushFullBlocks()
      } catch (e) { pending = []; pendingBytes = 0; finish.reject(e); throw e }
    },
    async close() {
      try {
        if (inflight) await inflight
        if (failure) throw failure
        const total = st.receivedBytes
        if (!total) throw new Error('No se generó ningún vídeo que subir.')
        const r = await call('finish', take(pendingBytes), st.sentBytes)
        st.sentBytes = total; o.onProgress?.(total)
        const j = await r.json() as { id: string; name: string; size: number; path_display?: string }
        if (j.size !== total) throw new Error(`Dropbox guardó ${j.size} bytes y se enviaron ${total}: el archivo no está completo.`)
        finish.resolve({ id: j.id, name: j.name, size: j.size, path: j.path_display ?? o.path })
      } catch (e) { finish.reject(e); throw e }
    },
    async abort(reason) {
      pending = []; pendingBytes = 0
      finish.reject(reason ?? new DOMException('Cancelado', 'AbortError'))
    },
  })
  return { writable, result, stats: () => ({ ...st }) }
}
