/**
 * Upload of a finished video to Google Drive from the browser, as a resumable session in chunks (Drive's documented protocol).
 * The file is read slice by slice (a File/Blob slice does not load the file into memory), the token travels in a header only,
 * and an interrupted upload is continued from the byte Drive already holds. Scope: `drive.file` (files created by this app).
 */
export const DRIVE_CHUNK = 8 * 1024 * 1024 // multiple of 256 KiB, as the protocol requires
export type DriveUploadResult = { id: string; name: string; size: number; webViewLink?: string }
type Fetch = typeof fetch

export async function uploadToDrive(file: Blob, o: {
  name: string; mimeType: string; token: string; folderId?: string
  onProgress?: (sent: number, total: number) => void; signal?: AbortSignal; fetchImpl?: Fetch; chunk?: number; maxRetries?: number
}): Promise<DriveUploadResult> {
  const f = o.fetchImpl ?? fetch
  const chunk = o.chunk ?? DRIVE_CHUNK
  if (chunk % (256 * 1024) !== 0) throw new Error('El tamaño de bloque debe ser múltiplo de 256 KiB.')
  const total = file.size
  if (!total) throw new Error('El archivo está vacío.')
  const auth = { Authorization: `Bearer ${o.token}` }
  const start = await f('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink', {
    method: 'POST', signal: o.signal,
    headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': o.mimeType, 'X-Upload-Content-Length': String(total) },
    body: JSON.stringify({ name: o.name, mimeType: o.mimeType, ...(o.folderId ? { parents: [o.folderId] } : {}) }),
  })
  if (!start.ok) throw new Error(driveError(start.status))
  const session = start.headers.get('Location')
  if (!session) throw new Error('Drive no devolvió la sesión de subida.')
  let sent = 0
  let retries = 0
  for (;;) {
    if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    const end = Math.min(total, sent + chunk)
    let r: Response
    try {
      r = await f(session, { method: 'PUT', signal: o.signal, headers: { 'Content-Range': `bytes ${sent}-${end - 1}/${total}` }, body: file.slice(sent, end) })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      if (++retries > (o.maxRetries ?? 5)) throw new Error('Se perdió la conexión con Drive y no se pudo continuar.')
      sent = await resumePoint(f, session, total, o.signal)
      continue
    }
    if (r.status === 200 || r.status === 201) {
      o.onProgress?.(total, total)
      const j = await r.json() as { id: string; name: string; size?: string; webViewLink?: string }
      return { id: j.id, name: j.name, size: Number(j.size ?? total), webViewLink: j.webViewLink }
    }
    if (r.status === 308) { sent = parseRange(r.headers.get('Range')) ?? sent; retries = 0; o.onProgress?.(sent, total); continue }
    if ((r.status >= 500 || r.status === 429) && ++retries <= (o.maxRetries ?? 5)) { sent = await resumePoint(f, session, total, o.signal); continue }
    throw new Error(driveError(r.status))
  }
}

/** Asks Drive how many bytes it holds for this session. */
async function resumePoint(f: Fetch, session: string, total: number, signal?: AbortSignal) {
  const r = await f(session, { method: 'PUT', signal, headers: { 'Content-Range': `bytes */${total}` } })
  if (r.status === 308) return parseRange(r.headers.get('Range')) ?? 0
  if (r.status === 200 || r.status === 201) return total
  throw new Error(driveError(r.status))
}

/** «bytes=0-8388607» → 8388608 (the next byte to send). */
export function parseRange(h: string | null) {
  const m = /bytes=0-(\d+)/.exec(h ?? '')
  return m ? Number(m[1]) + 1 : null
}

export function driveError(status: number) {
  if (status === 401) return 'Google cerró la sesión: vuelve a conectar Drive y reintenta.'
  if (status === 403) return 'Drive no permite guardar aquí (permisos, cuota de tu Drive o carpeta no autorizada).'
  if (status === 404) return 'La carpeta de Drive ya no existe o no está autorizada.'
  if (status === 429 || status >= 500) return 'Drive está saturado ahora mismo; reintenta en unos minutos.'
  return `Drive respondió ${status}.`
}
