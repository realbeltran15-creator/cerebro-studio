/** Descarga acotada de material para análisis en el navegador: comprueba r.ok, limita el tamaño y admite cancelación. */
export const MAX_ANALYSIS_BYTES = 512 * 1024 * 1024

export class MediaFetchError extends Error {
  constructor(message: string, readonly kind: 'http' | 'too_large' | 'cancelled') { super(message); this.name = 'MediaFetchError' }
}

export async function fetchMediaBlob(
  url: string,
  opts: { maxBytes?: number; signal?: AbortSignal; fetchImpl?: typeof fetch; label?: string } = {},
): Promise<Blob> {
  const max = opts.maxBytes ?? MAX_ANALYSIS_BYTES
  const label = opts.label ?? 'el archivo'
  const doFetch = opts.fetchImpl ?? fetch
  let r: Response
  try { r = await doFetch(url, { signal: opts.signal }) }
  catch (e) {
    if (opts.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw new MediaFetchError('Análisis cancelado.', 'cancelled')
    throw e
  }
  if (!r.ok) throw new MediaFetchError(`No se pudo descargar ${label} (error ${r.status}). Puede que el enlace haya caducado: vuelve a intentarlo.`, 'http')
  const declared = Number(r.headers.get('content-length') ?? 0)
  const tooBig = () => new MediaFetchError(`${label} pesa demasiado para analizarlo en el navegador (máx. ${Math.round(max / 1048576)} MB).`, 'too_large')
  if (declared > max) throw tooBig()
  if (!r.body) { const b = await r.blob(); if (b.size > max) throw tooBig(); return b }
  const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new MediaFetchError('Análisis cancelado.', 'cancelled')
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) { void reader.cancel(); throw tooBig() }
      chunks.push(value)
    }
  } catch (e) {
    if (e instanceof MediaFetchError) throw e
    if (opts.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw new MediaFetchError('Análisis cancelado.', 'cancelled')
    throw e
  }
  return new Blob(chunks as BlobPart[], { type: r.headers.get('content-type') ?? '' })
}
