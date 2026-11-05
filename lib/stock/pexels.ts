/**
 * Pexels (stock photos and videos) — prepared, OFF by default. Nothing here calls the network unless the caller injects a `fetch`
 * AND a key from `PEXELS_API_KEY` exists. Terms checked in the official API documentation: free, default limit 200 requests/hour
 * and 20,000/month, a prominent link to Pexels is required wherever results are shown, credit the photographer when possible,
 * do not copy Pexels' core functionality, and do not work around the limits. This module therefore (1) counts requests locally and
 * refuses before the limit, (2) deduplicates identical in-flight/cached queries, (3) always produces the attribution text.
 */
export const PEXELS_LIMITS = { perHour: 200, perMonth: 20_000 } as const

export type PexelsKind = 'photos' | 'videos'
export type PexelsItem = { id: number; kind: PexelsKind; pageUrl: string; downloadUrl: string; width: number; height: number; creator: string; creatorUrl: string; attribution: string }

export class PexelsNotConfigured extends Error { constructor() { super('Pexels no está configurado (falta PEXELS_API_KEY). La función sigue desactivada.') } }
export class PexelsLimit extends Error { constructor(public scope: 'hour' | 'month') { super(`Límite local de Pexels alcanzado (${scope === 'hour' ? '200 por hora' : '20.000 por mes'}). Se evita llamar para respetar las condiciones.`) } }

export const pexelsKey = (env: Record<string, string | undefined> = process.env) => env.PEXELS_API_KEY?.trim() || null

/** Local counter: refuses BEFORE exceeding the documented limits (keeps a margin of 10 %). */
export class PexelsLedger {
  private hour: number[] = []
  private month: number[] = []
  constructor(private now: () => number = Date.now, private margin = 0.9) {}
  reserve() {
    const t = this.now()
    this.hour = this.hour.filter(x => t - x < 3_600_000); this.month = this.month.filter(x => t - x < 30 * 86_400_000)
    if (this.hour.length >= Math.floor(PEXELS_LIMITS.perHour * this.margin)) throw new PexelsLimit('hour')
    if (this.month.length >= Math.floor(PEXELS_LIMITS.perMonth * this.margin)) throw new PexelsLimit('month')
    this.hour.push(t); this.month.push(t)
  }
  get usedThisHour() { return this.hour.length }
}

export const attributionFor = (creator: string, pageUrl: string) => `${creator ? `Foto/vídeo de ${creator} en` : 'Material de'} Pexels (${pageUrl})`
export const PEXELS_BANNER = { text: 'Fotos y vídeos proporcionados por Pexels', href: 'https://www.pexels.com' } as const

type RawPhoto = { id: number; url: string; width: number; height: number; photographer: string; photographer_url: string; src?: { large2x?: string; original?: string } }
type RawVideo = { id: number; url: string; width: number; height: number; user?: { name: string; url: string }; video_files?: Array<{ link: string; width: number; file_type: string }> }

export function mapPhoto(p: RawPhoto): PexelsItem {
  return { id: p.id, kind: 'photos', pageUrl: p.url, downloadUrl: p.src?.large2x ?? p.src?.original ?? '', width: p.width, height: p.height, creator: p.photographer, creatorUrl: p.photographer_url, attribution: attributionFor(p.photographer, p.url) }
}
export function mapVideo(v: RawVideo): PexelsItem {
  const file = [...(v.video_files ?? [])].filter(f => f.file_type === 'video/mp4').sort((a, b) => b.width - a.width).find(f => f.width <= 1920) ?? v.video_files?.[0]
  return { id: v.id, kind: 'videos', pageUrl: v.url, downloadUrl: file?.link ?? '', width: v.width, height: v.height, creator: v.user?.name ?? '', creatorUrl: v.user?.url ?? '', attribution: attributionFor(v.user?.name ?? '', v.url) }
}

export function createPexelsClient(opts: { key: string | null; fetchImpl?: typeof fetch; ledger?: PexelsLedger }) {
  const ledger = opts.ledger ?? new PexelsLedger()
  const cache = new Map<string, Promise<PexelsItem[]>>()
  return {
    async search(kind: PexelsKind, query: string, perPage = 12): Promise<PexelsItem[]> {
      if (!opts.key) throw new PexelsNotConfigured()
      const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!q) return []
      const n = Math.min(Math.max(perPage, 1), 30)
      const id = `${kind}|${q}|${n}`
      const hit = cache.get(id); if (hit) return hit
      ledger.reserve()
      const url = kind === 'photos' ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n}` : `https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(q)}&per_page=${n}`
      const run = (async () => {
        const res = await (opts.fetchImpl ?? fetch)(url, { headers: { Authorization: opts.key as string } })
        if (res.status === 429) throw new PexelsLimit('hour')
        if (!res.ok) throw new Error(`Pexels respondió ${res.status}.`)
        const j = await res.json() as { photos?: RawPhoto[]; videos?: RawVideo[] }
        return kind === 'photos' ? (j.photos ?? []).map(mapPhoto) : (j.videos ?? []).map(mapVideo)
      })()
      cache.set(id, run); run.catch(() => cache.delete(id))
      return run
    },
  }
}
