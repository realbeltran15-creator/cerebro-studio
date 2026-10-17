/**
 * Only public YouTube videos are analysed, and only through the official Gemini API (which fetches the
 * video itself). Cerebro never downloads or re-hosts the reference video. The URL is rebuilt from the
 * 11-character id so nothing else from the user's text reaches the API.
 */
const ID = /^[A-Za-z0-9_-]{11}$/

export function youtubeVideoId(raw: string): string | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else { const m = u.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/); id = m?.[2] ?? null }
  }
  return id && ID.test(id) ? id : null
}

export const canonicalYouTubeUrl = (raw: string) => { const id = youtubeVideoId(raw); return id ? `https://www.youtube.com/watch?v=${id}` : null }
