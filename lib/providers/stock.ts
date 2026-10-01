/**
 * Free media banks (server-only). Search returns normalised results; import re-reads the item by id
 * from the provider (never trusting a URL sent by the browser) and keeps author, license and source.
 * Freesound: token auth, CC licenses per sound; originals need OAuth2, so the HQ preview MP3 is imported.
 * Pexels / Pixabay: free API keys; files are copied (Pixabay forbids permanent hotlinking).
 */

export type StockSource = 'freesound' | 'pexels' | 'pixabay'
export type StockKind = 'image' | 'video' | 'audio'

export type StockItem = {
  source: StockSource
  id: string
  kind: StockKind
  title: string
  author: string
  authorUrl: string | null
  pageUrl: string
  license: string
  licenseUrl: string | null
  /** Asset license_status stored in public.assets. */
  licenseStatus: 'public_domain' | 'licensed' | 'restricted'
  /** Attribution line to credit the author when the license asks for it. */
  attribution: string
  thumbUrl: string | null
  previewUrl: string | null
  downloadUrl: string
  mimeType: string
  durationSeconds: number | null
  width: number | null
  height: number | null
}

const keys = {
  freesound: () => process.env.FREESOUND_API_KEY?.trim() ?? '',
  pexels: () => process.env.PEXELS_API_KEY?.trim() ?? '',
  pixabay: () => process.env.PIXABAY_API_KEY?.trim() ?? '',
}
export const stockConfigured = (s: StockSource) => Boolean(keys[s]())
export const stockKinds: Record<StockSource, StockKind[]> = { freesound: ['audio'], pexels: ['image', 'video'], pixabay: ['image', 'video'] }

/** Hosts files may be downloaded from, per source. */
const downloadHosts: Record<StockSource, RegExp> = {
  freesound: /(^|\.)freesound\.org$/,
  pexels: /(^|\.)pexels\.com$/,
  pixabay: /(^|\.)pixabay\.com$/,
}
export function allowedDownload(source: StockSource, url: string) {
  try { const u = new URL(url); return u.protocol === 'https:' && downloadHosts[source].test(u.hostname) } catch { return false }
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`Banco de medios respondió ${r.status}.`)
  return r.json() as Promise<Record<string, unknown>>
}

// ---------- Freesound ----------
type FsSound = { id: number; name: string; username: string; license: string; url: string; duration: number; previews?: Record<string, string>; images?: Record<string, string> }
const FS_FIELDS = 'id,name,username,license,url,duration,previews,images'

export function freesoundLicense(license: string): Pick<StockItem, 'license' | 'licenseUrl' | 'licenseStatus'> {
  const l = license.toLowerCase()
  if (l.includes('zero') || l.includes('cc0') || l === 'creative commons 0') return { license: 'Creative Commons 0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', licenseStatus: 'public_domain' }
  if (l.includes('noncommercial') || l.includes('by-nc')) return { license: 'CC Attribution NonCommercial', licenseUrl: license.startsWith('http') ? license : 'https://creativecommons.org/licenses/by-nc/4.0/', licenseStatus: 'restricted' }
  return { license: 'CC Attribution', licenseUrl: license.startsWith('http') ? license : 'https://creativecommons.org/licenses/by/4.0/', licenseStatus: 'licensed' }
}

function fsItem(s: FsSound): StockItem {
  const lic = freesoundLicense(s.license)
  const preview = s.previews?.['preview-hq-mp3'] ?? s.previews?.['preview-lq-mp3'] ?? ''
  return {
    source: 'freesound', id: String(s.id), kind: 'audio', title: s.name, author: s.username, authorUrl: `https://freesound.org/people/${encodeURIComponent(s.username)}/`,
    pageUrl: s.url, ...lic, attribution: `"${s.name}" por ${s.username} (freesound.org) — ${lic.license}`,
    thumbUrl: s.images?.waveform_m ?? null, previewUrl: preview || null, downloadUrl: preview, mimeType: 'audio/mpeg',
    durationSeconds: s.duration ?? null, width: null, height: null,
  }
}

async function freesoundSearch(q: string, opts: { maxSeconds?: number; cc0Only?: boolean }) {
  const filter = [`duration:[0 TO ${Math.min(Math.max(opts.maxSeconds ?? 300, 1), 3600)}]`, opts.cc0Only ? 'license:"Creative Commons 0"' : null].filter(Boolean).join(' ')
  const u = `https://freesound.org/apiv2/search/?query=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&fields=${FS_FIELDS}&page_size=24&sort=score`
  const j = await getJson(u, { Authorization: `Token ${keys.freesound()}` })
  return ((j.results ?? []) as FsSound[]).map(fsItem).filter(i => i.downloadUrl)
}
async function freesoundGet(id: string) {
  if (!/^\d{1,12}$/.test(id)) throw new Error('Id no válido.')
  return fsItem(await getJson(`https://freesound.org/apiv2/sounds/${id}/?fields=${FS_FIELDS}`, { Authorization: `Token ${keys.freesound()}` }) as unknown as FsSound)
}

// ---------- Pexels ----------
type PxPhoto = { id: number; url: string; alt?: string; photographer: string; photographer_url: string; width: number; height: number; src: Record<string, string> }
type PxVideo = { id: number; url: string; image: string; duration: number; user: { name: string; url: string }; video_files: Array<{ link: string; quality: string | null; width: number | null; height: number | null; file_type: string }> }
const pexelsLicense = { license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', licenseStatus: 'licensed' as const }

function pxPhoto(p: PxPhoto): StockItem {
  return {
    source: 'pexels', id: String(p.id), kind: 'image', title: p.alt || `Foto ${p.id}`, author: p.photographer, authorUrl: p.photographer_url, pageUrl: p.url,
    ...pexelsLicense, attribution: `Foto de ${p.photographer} en Pexels`, thumbUrl: p.src.medium ?? p.src.small ?? null, previewUrl: p.src.large ?? p.src.medium ?? null,
    downloadUrl: p.src.large2x ?? p.src.original, mimeType: 'image/jpeg', durationSeconds: null, width: p.width, height: p.height,
  }
}
function pxVideo(v: PxVideo): StockItem | null {
  // Best file up to 1920 px wide: enough for YouTube 1080p without importing 4K masters.
  const files = v.video_files.filter(f => f.file_type === 'video/mp4' && (f.width ?? 0) <= 1920).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  const best = files[0]
  if (!best) return null
  return {
    source: 'pexels', id: String(v.id), kind: 'video', title: `Vídeo ${v.id}`, author: v.user.name, authorUrl: v.user.url, pageUrl: v.url,
    ...pexelsLicense, attribution: `Vídeo de ${v.user.name} en Pexels`, thumbUrl: v.image, previewUrl: files[files.length - 1]?.link ?? best.link,
    downloadUrl: best.link, mimeType: 'video/mp4', durationSeconds: v.duration, width: best.width, height: best.height,
  }
}

async function pexelsSearch(q: string, kind: StockKind, orientation?: string) {
  const o = orientation === 'portrait' || orientation === 'landscape' ? `&orientation=${orientation}` : ''
  const h = { Authorization: keys.pexels() }
  if (kind === 'video') return ((await getJson(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=20${o}`, h)).videos as PxVideo[] ?? []).map(pxVideo).filter((x): x is StockItem => Boolean(x))
  return ((await getJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=24${o}`, h)).photos as PxPhoto[] ?? []).map(pxPhoto)
}
async function pexelsGet(id: string, kind: StockKind) {
  if (!/^\d{1,12}$/.test(id)) throw new Error('Id no válido.')
  const h = { Authorization: keys.pexels() }
  if (kind === 'video') { const v = pxVideo(await getJson(`https://api.pexels.com/videos/videos/${id}`, h) as unknown as PxVideo); if (!v) throw new Error('Sin archivo MP4 utilizable.'); return v }
  return pxPhoto(await getJson(`https://api.pexels.com/v1/photos/${id}`, h) as unknown as PxPhoto)
}

// ---------- Pixabay ----------
type PbImage = { id: number; pageURL: string; tags: string; user: string; user_id: number; previewURL: string; webformatURL: string; largeImageURL: string; imageWidth: number; imageHeight: number }
type PbVideo = { id: number; pageURL: string; tags: string; user: string; user_id: number; duration: number; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> }
const pixabayLicense = { license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', licenseStatus: 'licensed' as const }
const pbUser = (name: string, id: number) => `https://pixabay.com/users/${encodeURIComponent(name)}-${id}/`

function pbImage(p: PbImage): StockItem {
  return {
    source: 'pixabay', id: String(p.id), kind: 'image', title: p.tags || `Imagen ${p.id}`, author: p.user, authorUrl: pbUser(p.user, p.user_id), pageUrl: p.pageURL,
    ...pixabayLicense, attribution: `Imagen de ${p.user} en Pixabay`, thumbUrl: p.previewURL, previewUrl: p.webformatURL, downloadUrl: p.largeImageURL,
    mimeType: 'image/jpeg', durationSeconds: null, width: p.imageWidth, height: p.imageHeight,
  }
}
function pbVideo(v: PbVideo): StockItem | null {
  const best = v.videos.large?.url ? v.videos.large : v.videos.medium?.url ? v.videos.medium : v.videos.small
  if (!best?.url) return null
  return {
    source: 'pixabay', id: String(v.id), kind: 'video', title: v.tags || `Vídeo ${v.id}`, author: v.user, authorUrl: pbUser(v.user, v.user_id), pageUrl: v.pageURL,
    ...pixabayLicense, attribution: `Vídeo de ${v.user} en Pixabay`, thumbUrl: best.thumbnail ?? v.videos.tiny?.thumbnail ?? null, previewUrl: v.videos.tiny?.url ?? best.url,
    downloadUrl: best.url, mimeType: 'video/mp4', durationSeconds: v.duration, width: best.width, height: best.height,
  }
}

async function pixabaySearch(q: string, kind: StockKind, orientation?: string) {
  const o = orientation === 'portrait' ? '&orientation=vertical' : orientation === 'landscape' ? '&orientation=horizontal' : ''
  const base = `key=${encodeURIComponent(keys.pixabay())}&q=${encodeURIComponent(q.slice(0, 100))}&safesearch=true&per_page=24`
  if (kind === 'video') return ((await getJson(`https://pixabay.com/api/videos/?${base}`)).hits as PbVideo[] ?? []).map(pbVideo).filter((x): x is StockItem => Boolean(x))
  return ((await getJson(`https://pixabay.com/api/?${base}&image_type=photo${o}`)).hits as PbImage[] ?? []).map(pbImage)
}
async function pixabayGet(id: string, kind: StockKind) {
  if (!/^\d{1,12}$/.test(id)) throw new Error('Id no válido.')
  const base = `key=${encodeURIComponent(keys.pixabay())}&id=${id}`
  if (kind === 'video') { const v = pbVideo(((await getJson(`https://pixabay.com/api/videos/?${base}`)).hits as PbVideo[])[0]); if (!v) throw new Error('No encontrado.'); return v }
  const hit = ((await getJson(`https://pixabay.com/api/?${base}`)).hits as PbImage[])[0]
  if (!hit) throw new Error('No encontrado.')
  return pbImage(hit)
}

// ---------- Public API ----------
export async function searchStock(source: StockSource, kind: StockKind, q: string, opts: { orientation?: string; maxSeconds?: number; cc0Only?: boolean } = {}) {
  if (!stockConfigured(source)) throw new Error('Banco de medios no configurado.')
  if (!stockKinds[source].includes(kind)) throw new Error('Ese banco no ofrece ese tipo de archivo.')
  const query = q.trim().slice(0, 200)
  if (!query) return []
  if (source === 'freesound') return freesoundSearch(query, opts)
  if (source === 'pexels') return pexelsSearch(query, kind, opts.orientation)
  return pixabaySearch(query, kind, opts.orientation)
}

export async function getStockItem(source: StockSource, kind: StockKind, id: string) {
  if (!stockConfigured(source)) throw new Error('Banco de medios no configurado.')
  if (source === 'freesound') return freesoundGet(id)
  if (source === 'pexels') return pexelsGet(id, kind)
  return pixabayGet(id, kind)
}
