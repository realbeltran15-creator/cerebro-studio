'use client'
import { visualTypes, type EditorAsset } from './client'
import type { KindOf, MediaKind } from './scene'

/**
 * Playable URLs for the editor's player and exporter: short-lived signed URLs of the owner's private files, asked once per asset and
 * renewed before they expire (or when a request fails). Nothing is downloaded up front; the browser streams what it plays.
 */
export function assetUrlResolver(ttlSeconds = 3 * 3600) {
  const cache = new Map<string, { url: string; until: number } | Promise<string>>()
  return async function resolve(assetId: string, refresh = false): Promise<string> {
    const hit = cache.get(assetId)
    if (!refresh && hit) {
      if (hit instanceof Promise) return hit
      if (hit.until > Date.now()) return hit.url
    }
    const p = (async () => {
      const r = await fetch(`/api/assets/${encodeURIComponent(assetId)}/signed-url?ttl=${ttlSeconds}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({})) as { url?: string; expiresIn?: number; error?: string }
      if (!r.ok || !j.url) { cache.delete(assetId); throw new Error(r.status === 404 ? 'El archivo ya no existe en la Biblioteca.' : j.error ?? 'No se pudo acceder a un archivo.') }
      // Renewed 10 minutes before it really expires.
      cache.set(assetId, { url: j.url, until: Date.now() + Math.max(60, (j.expiresIn ?? 300) - 600) * 1000 })
      return j.url
    })()
    cache.set(assetId, p)
    return p
  }
}

/** Whether an asset is drawn as a video, an image, or only heard. */
export function kindFromAssets(assets: Array<Pick<EditorAsset, 'id' | 'asset_type'>>): KindOf {
  const map = new Map<string, MediaKind>(assets.map(a => [a.id, a.asset_type === 'video' ? 'video' : visualTypes.includes(a.asset_type) ? 'image' : 'audio']))
  return id => map.get(id) ?? null
}
