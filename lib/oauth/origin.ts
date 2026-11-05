/**
 * The origin that OAuth redirect URIs are built from. When CEREBRO_OAUTH_ORIGIN is set (the one public address registered with Google/Meta),
 * it is used instead of the origin of the incoming request, so a forged Host header cannot change the redirect URI. Without it the request's
 * own origin is used (local development).
 */
export function oauthOrigin(requestOrigin: string, env: Record<string, string | undefined> = process.env): string {
  const pinned = env.CEREBRO_OAUTH_ORIGIN?.trim()
  if (!pinned) return requestOrigin
  try {
    const u = new URL(pinned)
    if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return requestOrigin
    return u.origin
  } catch { return requestOrigin }
}
