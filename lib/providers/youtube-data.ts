/**
 * Read-only YouTube Data API v3 search for research. Server-only: uses YOUTUBE_API_KEY.
 * Observed values come straight from the API; derived values are computed here and
 * returned separately so the UI never mixes them with observations.
 * Quota: search = search.list (100 units) + videos.list (1) + channels.list (1);
 * trending = videos.list chart=mostPopular (1) + channels.list (1).
 */

const API = 'https://www.googleapis.com/youtube/v3'

export type YouTubeSearchOrder = 'relevance' | 'viewCount' | 'date' | 'rating'

export type YouTubeSearchInput = {
  query: string
  order?: YouTubeSearchOrder
  regionCode?: string
  language?: string
  publishedWithinDays?: number
  maxResults?: number
}

export type YouTubeVideoResult = {
  videoId: string
  url: string
  title: string
  channelId: string
  channelTitle: string
  publishedAt: string
  thumbnailUrl: string | null
  observed: {
    views: number | null
    likes: number | null
    comments: number | null
    durationSeconds: number | null
    channelSubscribers: number | null
    fetchedAt: string
  }
  calculated: {
    viewsPerDay: number | null
    viewsToSubscribers: number | null
    engagementRate: number | null
  }
}

export class YouTubeApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export function youtubeConfigured() {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim())
}

const toNumber = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Parses ISO-8601 durations such as PT1H2M3S. */
export function parseIsoDuration(value: string | undefined) {
  const m = value?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return null
  const [, d, h, min, s] = m.map(x => (x ? Number(x) : 0))
  return d * 86400 + h * 3600 + min * 60 + s
}

async function call<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const url = new URL(`${API}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  // The key travels in a header, never in the URL, so it cannot leak into logs, referrers or error traces.
  const response = await fetch(url, { headers: { 'x-goog-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null
    const reason = body?.error?.errors?.[0]?.reason
    const message = reason === 'quotaExceeded' || reason === 'dailyLimitExceeded'
      ? 'Se ha agotado la cuota diaria de YouTube Data API.'
      : response.status === 400 && reason === 'keyInvalid' ? 'YouTube rechazó la clave API.'
      : response.status === 403 ? 'YouTube denegó el acceso: revisa que YouTube Data API v3 esté habilitada para la clave.'
      : `YouTube Data API respondió ${response.status}.`
    throw new YouTubeApiError(message, response.status)
  }
  return response.json() as Promise<T>
}

type SearchResponse = { items?: Array<{ id?: { videoId?: string } }> }
type VideosResponse = { items?: Array<{
  id: string
  snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> }
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
  contentDetails?: { duration?: string }
}> }
type ChannelsResponse = { items?: Array<{ id: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }> }

export async function searchYouTubeVideos(input: YouTubeSearchInput): Promise<YouTubeVideoResult[]> {
  const key = requireKey()
  const params: Record<string, string> = {
    part: 'id', type: 'video', q: input.query, order: input.order ?? 'relevance',
    maxResults: String(Math.min(Math.max(input.maxResults ?? 12, 1), 25)),
  }
  if (input.regionCode) params.regionCode = input.regionCode
  if (input.language) params.relevanceLanguage = input.language
  if (input.publishedWithinDays) params.publishedAfter = new Date(Date.now() - input.publishedWithinDays * 86400000).toISOString()

  const search = await call<SearchResponse>('search', params, key)
  const ids = (search.items ?? []).map(i => i.id?.videoId).filter((id): id is string => Boolean(id))
  if (ids.length === 0) return []
  const videos = await call<VideosResponse>('videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') }, key)
  const byId = new Map((videos.items ?? []).map(v => [v.id, v]))
  // Keep the order returned by search.list.
  return enrich(ids.flatMap(id => byId.get(id) ?? []), key)
}

export type TrendingInput = { regionCode: string; categoryId?: string; maxResults?: number }

/** Most popular videos for a region (videos.list chart=mostPopular): 1 quota unit + 1 for channels. */
export async function trendingYouTubeVideos(input: TrendingInput): Promise<YouTubeVideoResult[]> {
  const key = requireKey()
  const params: Record<string, string> = {
    part: 'snippet,statistics,contentDetails', chart: 'mostPopular', regionCode: input.regionCode,
    maxResults: String(Math.min(Math.max(input.maxResults ?? 25, 1), 50)),
  }
  if (input.categoryId) params.videoCategoryId = input.categoryId
  const videos = await call<VideosResponse>('videos', params, key)
  return enrich(videos.items ?? [], key)
}

export type YouTubeCategory = { id: string; title: string }

/** Assignable video categories for a region (1 quota unit). */
export async function youtubeCategories(regionCode: string, language = 'es'): Promise<YouTubeCategory[]> {
  const key = requireKey()
  const data = await call<{ items?: Array<{ id: string; snippet?: { title?: string; assignable?: boolean } }> }>(
    'videoCategories', { part: 'snippet', regionCode, hl: language }, key)
  return (data.items ?? []).filter(c => c.snippet?.assignable).map(c => ({ id: c.id, title: c.snippet?.title ?? c.id }))
}

function requireKey() {
  const key = process.env.YOUTUBE_API_KEY?.trim()
  if (!key) throw new YouTubeApiError('YouTube Data API no está configurada (YOUTUBE_API_KEY).', 503)
  return key
}

type VideoItem = NonNullable<VideosResponse['items']>[number]

/** Adds channel subscriber counts and derived metrics, keeping observed and calculated values apart. */
async function enrich(items: VideoItem[], key: string): Promise<YouTubeVideoResult[]> {
  if (items.length === 0) return []
  const channelIds = [...new Set(items.map(v => v.snippet?.channelId).filter((id): id is string => Boolean(id)))]
  const channels = channelIds.length
    ? await call<ChannelsResponse>('channels', { part: 'statistics', id: channelIds.join(',') }, key)
    : { items: [] }
  const subscribers = new Map((channels.items ?? []).map(c => [c.id, c.statistics?.hiddenSubscriberCount ? null : toNumber(c.statistics?.subscriberCount)]))
  const fetchedAt = new Date().toISOString()
  return items.map(v => {
    const views = toNumber(v.statistics?.viewCount)
    const likes = toNumber(v.statistics?.likeCount)
    const comments = toNumber(v.statistics?.commentCount)
    const subs = subscribers.get(v.snippet?.channelId ?? '') ?? null
    const publishedAt = v.snippet?.publishedAt ?? ''
    const ageDays = publishedAt ? Math.max((Date.now() - Date.parse(publishedAt)) / 86400000, 1) : null
    const thumbs = v.snippet?.thumbnails ?? {}
    return {
      videoId: v.id,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      title: v.snippet?.title ?? '',
      channelId: v.snippet?.channelId ?? '',
      channelTitle: v.snippet?.channelTitle ?? '',
      publishedAt,
      thumbnailUrl: thumbs.medium?.url ?? thumbs.default?.url ?? null,
      observed: { views, likes, comments, durationSeconds: parseIsoDuration(v.contentDetails?.duration), channelSubscribers: subs, fetchedAt },
      calculated: {
        viewsPerDay: views !== null && ageDays ? Math.round(views / ageDays) : null,
        viewsToSubscribers: views !== null && subs ? Math.round((views / subs) * 100) / 100 : null,
        engagementRate: views ? Math.round((((likes ?? 0) + (comments ?? 0)) / views) * 10000) / 100 : null,
      },
    }
  })
}

/** Current metrics for known videos: videos.list by id, 1 quota unit per 50 ids (+1 for channels). */
export async function youtubeVideosByIds(ids: string[]): Promise<YouTubeVideoResult[]> {
  const key = requireKey()
  const unique = [...new Set(ids.filter(id => /^[\w-]{6,20}$/.test(id)))]
  const results: YouTubeVideoResult[] = []
  for (let i = 0; i < unique.length; i += 50) {
    const videos = await call<VideosResponse>('videos', { part: 'snippet,statistics,contentDetails', id: unique.slice(i, i + 50).join(',') }, key)
    results.push(...await enrich(videos.items ?? [], key))
  }
  return results
}

/** Extracts the video id from watch, youtu.be, shorts and embed URLs. */
export function youtubeVideoId(url: string | null | undefined) {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m)\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (host !== 'youtube.com') return null
    if (u.pathname === '/watch') return u.searchParams.get('v')
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/)
    return m ? m[2] : null
  } catch { return null }
}

export type ChannelAnalysis = {
  channel: { id: string; title: string; handle: string | null; url: string; thumbnailUrl: string | null; country: string | null }
  observed: { subscribers: number | null; totalViews: number | null; videoCount: number | null; fetchedAt: string }
  calculated: {
    sampleSize: number
    avgViews: number | null
    medianViews: number | null
    uploadsPerWeek: number | null
    /** Videos with at least 2× the median views of the sample. */
    outlierIds: string[]
  }
  videos: YouTubeVideoResult[]
}

/** Parses a channel URL, @handle or UC… id into a channels.list selector. */
export function channelSelector(input: string): Record<string, string> | null {
  const raw = input.trim()
  if (/^UC[\w-]{22}$/.test(raw)) return { id: raw }
  if (/^@[\w.-]{3,100}$/.test(raw)) return { forHandle: raw }
  try {
    const u = new URL(raw)
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null
    const m = u.pathname.match(/^\/(channel\/(UC[\w-]{22})|(@[\w.-]{3,100}))/)
    if (m?.[2]) return { id: m[2] }
    if (m?.[3]) return { forHandle: decodeURIComponent(m[3]) }
  } catch { /* not a URL */ }
  return null
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Channel stats plus its latest uploads (~4 quota units). */
export async function analyzeChannel(input: string, sample = 25): Promise<ChannelAnalysis> {
  const key = requireKey()
  const selector = channelSelector(input)
  if (!selector) throw new YouTubeApiError('Indica la URL del canal, su @handle o su id (UC…).', 400)
  type ChannelFull = { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string; country?: string; thumbnails?: Record<string, { url?: string }> }; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; viewCount?: string; videoCount?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }
  const ch = (await call<ChannelFull>('channels', { part: 'snippet,statistics,contentDetails', ...selector }, key)).items?.[0]
  if (!ch) throw new YouTubeApiError('No se encontró ese canal.', 404)
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads
  const playlist = uploads
    ? await call<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: String(Math.min(Math.max(sample, 1), 50)) }, key)
    : { items: [] }
  const ids = (playlist.items ?? []).map(i => i.contentDetails?.videoId).filter((x): x is string => Boolean(x))
  const videos = ids.length ? await youtubeVideosByIds(ids) : []
  const order = new Map(ids.map((id, i) => [id, i]))
  videos.sort((a, b) => (order.get(a.videoId) ?? 0) - (order.get(b.videoId) ?? 0))

  const views = videos.map(v => v.observed.views).filter((v): v is number => v !== null)
  const med = median(views)
  const dates = videos.map(v => Date.parse(v.publishedAt)).filter(Number.isFinite).sort((a, b) => a - b)
  const spanWeeks = dates.length > 1 ? (dates[dates.length - 1] - dates[0]) / (7 * 86400000) : null
  const thumbs = ch.snippet?.thumbnails ?? {}
  return {
    channel: {
      id: ch.id, title: ch.snippet?.title ?? '', handle: ch.snippet?.customUrl ?? null,
      url: `https://www.youtube.com/channel/${ch.id}`, thumbnailUrl: thumbs.medium?.url ?? thumbs.default?.url ?? null, country: ch.snippet?.country ?? null,
    },
    observed: {
      subscribers: ch.statistics?.hiddenSubscriberCount ? null : toNumber(ch.statistics?.subscriberCount),
      totalViews: toNumber(ch.statistics?.viewCount), videoCount: toNumber(ch.statistics?.videoCount), fetchedAt: new Date().toISOString(),
    },
    calculated: {
      sampleSize: videos.length,
      avgViews: views.length ? Math.round(views.reduce((t, v) => t + v, 0) / views.length) : null,
      medianViews: med,
      uploadsPerWeek: spanWeeks && spanWeeks > 0 ? Math.round(((dates.length - 1) / spanWeeks) * 10) / 10 : null,
      outlierIds: med ? videos.filter(v => (v.observed.views ?? 0) >= 2 * med).map(v => v.videoId) : [],
    },
    videos,
  }
}
