/**
 * URLs returned by a provider are downloaded by the server, so they must be public HTTPS addresses.
 * This blocks localhost, private ranges and link-local metadata endpoints (SSRF).
 */
export function isPublicHttpsUrl(raw: unknown, allowedSuffixes?: string[]): raw is string {
  if (typeof raw !== 'string') return false
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const host = u.hostname.toLowerCase()
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.includes(':')) return false
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false
  }
  return !allowedSuffixes || allowedSuffixes.some(s => host === s || host.endsWith(`.${s}`))
}
