/**
 * Background music without any API key: Wikimedia Commons (open API, files on upload.wikimedia.org).
 * Only tracks whose license is read live from Commons and is CC0 / public domain / CC BY (credit required, kept in the plan and the description)
 * are accepted; NonCommercial, NoDerivatives and ShareAlike are rejected. Popular commercial songs are never offered: their licenses do not allow this use.
 */
const API = 'https://commons.wikimedia.org/w/api.php'

/** Royalty-free tracks that are widely used in short videos, searched in this order. */
export const COMMONS_MUSIC_QUERIES = ['Kevin MacLeod Sneaky Snitch', 'Kevin MacLeod Investigations', 'Kevin MacLeod Cipher', 'Kevin MacLeod Fluffing a Duck', 'Kevin MacLeod']

export type CommonsTrack = {
  id: string; title: string; author: string; pageUrl: string; license: string; licenseUrl: string | null
  licenseStatus: 'public_domain' | 'licensed'; downloadUrl: string; mimeType: string; durationSeconds: number | null; attribution: string
}

export function allowedCommonsDownload(url: string) {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && u.hostname === 'upload.wikimedia.org' } catch { return false }
}

const plain = (html: unknown) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim()

/** Accepts only licenses that allow commercial, adapted use; null otherwise. */
export function commonsLicense(short: string): { status: 'public_domain' | 'licensed'; license: string } | null {
  const l = short.trim()
  if (/^(CC0|CC-0|Public domain|PD)\b/i.test(l)) return { status: 'public_domain', license: l }
  if (/\b(NC|ND|SA)\b/i.test(l)) return null
  if (/^CC[ -]BY\b/i.test(l)) return { status: 'licensed', license: l }
  return null
}

type ExtValue = { value?: unknown }
type Page = { title?: string; pageid?: number; imageinfo?: Array<{ url?: string; descriptionurl?: string; mime?: string; size?: number; duration?: number; extmetadata?: Record<string, ExtValue> }> }

export function parseCommonsPages(pages: Page[]): CommonsTrack[] {
  const out: CommonsTrack[] = []
  for (const p of pages) {
    const info = p.imageinfo?.[0]
    if (!info?.url || !p.title || !allowedCommonsDownload(info.url)) continue
    const mime = (info.mime ?? '').toLowerCase()
    if (!/^(audio\/(mpeg|ogg|wav|x-wav|flac)|application\/ogg)$/.test(mime)) continue
    const meta = info.extmetadata ?? {}
    const lic = commonsLicense(plain(meta.LicenseShortName?.value))
    if (!lic) continue
    const duration = typeof info.duration === 'number' && info.duration > 0 ? info.duration : null
    if (duration !== null ? duration < 25 || duration > 300 : (info.size ?? 0) < 400_000 || (info.size ?? 0) > 15_000_000) continue
    const author = plain(meta.Artist?.value) || 'Autor desconocido'
    const title = p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ')
    const licenseUrl = plain(meta.LicenseUrl?.value) || null
    out.push({
      id: String(p.pageid ?? p.title), title, author, pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
      license: lic.license, licenseUrl, licenseStatus: lic.status, downloadUrl: info.url, mimeType: mime === 'application/ogg' ? 'audio/ogg' : mime === 'audio/x-wav' ? 'audio/wav' : mime, durationSeconds: duration,
      attribution: `"${title}" — ${author} (Wikimedia Commons), ${lic.license}${licenseUrl ? ` ${licenseUrl}` : ''}`,
    })
  }
  // Prefer MP3 (plays everywhere), then OGG.
  const rank = (t: CommonsTrack) => (t.mimeType === 'audio/mpeg' ? 0 : t.mimeType === 'audio/ogg' ? 1 : 2)
  return out.sort((a, b) => rank(a) - rank(b))
}

export async function searchCommonsMusic(query: string, fetchImpl: typeof fetch = fetch): Promise<CommonsTrack[]> {
  const url = `${API}?${new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '15', gsrsearch: `${query} filetype:audio`,
    prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', origin: '*',
  })}`
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'CerebroStudio/1.0 (music lookup; contact via project owner)' }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`Wikimedia Commons respondió ${r.status}.`)
  const json = await r.json() as { query?: { pages?: Record<string, Page> } }
  return parseCommonsPages(Object.values(json.query?.pages ?? {}))
}

/** First acceptable track over the preferred searches. */
export async function findCommonsMusic(fetchImpl: typeof fetch = fetch): Promise<CommonsTrack | null> {
  for (const q of COMMONS_MUSIC_QUERIES) {
    const found = await searchCommonsMusic(q, fetchImpl).catch(() => [])
    if (found[0]) return found[0]
  }
  return null
}
