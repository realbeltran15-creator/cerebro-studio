/**
 * Byte source for mediabunny that survives signed-URL expiry during very long exports.
 *
 * A plain `UrlSource` freezes the URL it was built with. Signed URLs of private files expire (the server caps them at 4 h), so a
 * multi-hour export that reuses an opened file would start failing mid-way. This source reads with HTTP Range requests and, when the
 * server rejects the URL (400/401/403/404 on a signed link) or the network drops, asks `resolveUrl(assetId, true)` for a fresh
 * link and retries, with backoff. Nothing is stored on disk; only the (small) read window kept by mediabunny lives in memory.
 */
export type UrlResolver = (assetId: string, refresh?: boolean) => Promise<string>

export type RefreshStats = { refreshes: number; retries: number; lastError: string | null }

export function refreshingSourceOptions(assetId: string, resolveUrl: UrlResolver, stats?: RefreshStats, fetchFn: typeof fetch = (...a) => fetch(...a), maxAttempts = 6) {
  let size: number | null = null
  let url: Promise<string> | null = null
  const current = () => (url ??= resolveUrl(assetId))
  const fresh = () => (url = resolveUrl(assetId, true))
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  async function request(range: string): Promise<Response> {
    let lastErr: unknown = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const u = await current()
        const res = await fetchFn(u, { headers: { Range: range }, cache: 'no-store' })
        if (res.ok || res.status === 206) return res
        // Expired or revoked signed link: get a new one and try again at once.
        if ([400, 401, 403, 404].includes(res.status)) {
          lastErr = new Error(`HTTP ${res.status}`)
          if (stats) { stats.refreshes++; stats.lastError = `URL rechazada (HTTP ${res.status}); renovada` }
          await fresh()
          continue
        }
        lastErr = new Error(`HTTP ${res.status}`)
      } catch (e) {
        lastErr = e
      }
      if (stats) { stats.retries++; stats.lastError = lastErr instanceof Error ? lastErr.message : String(lastErr) }
      await sleep(Math.min(8000, 400 * 2 ** attempt))
    }
    throw new Error(`No se pudo leer un archivo del montaje tras ${maxAttempts} intentos (${lastErr instanceof Error ? lastErr.message : String(lastErr)}).`)
  }

  return {
    getSize: async () => {
      if (size !== null) return size
      const res = await request('bytes=0-0')
      const cr = res.headers.get('content-range')
      const m = cr && /\/(\d+)\s*$/.exec(cr)
      if (m) size = Number(m[1])
      else if (res.status === 200) size = Number(res.headers.get('content-length') ?? 0)
      else throw new Error('El servidor no indica el tamaño del archivo.')
      void res.body?.cancel().catch(() => {})
      return size
    },
    read: async (start: number, end: number) => {
      const res = await request(`bytes=${start}-${end - 1}`)
      const buf = new Uint8Array(await res.arrayBuffer())
      // A server ignoring Range answers 200 with the whole file: cut the wanted window out.
      return res.status === 200 ? buf.subarray(start, end) : buf
    },
    maxCacheSize: 8 * 1024 * 1024,
    prefetchProfile: 'network' as const,
  }
}
