/**
 * Frozen scope of the private beta. It is OFF unless NEXT_PUBLIC_CEREBRO_BETA=private (so Production keeps its current behaviour until a
 * reviewed deploy decides otherwise); when ON, everything not listed here is closed on the server (proxy.ts), whatever the UI shows.
 *
 * In scope: sign-in, projects (create + recover), scripts, storyboards/scenes, importing media, video editor, music and audio library,
 * MP4 export (fast path only, see export-policy.ts), library, storage usage.
 * Out of scope (closed): everything that spends money (image/video/voice generation, AI script assistance, transcription, recreate, studio),
 * publishes (YouTube, Instagram/TikTok, campaigns, calendar), runs automations/cron/queue, connects accounts (OAuth, iOS shortcuts, connectors),
 * or depends on integrations not verified end to end (research/radar/opportunities, analytics, Drive/Dropbox pickers beyond the import centre).
 */
type Env = Record<string, string | undefined>

// The LITERAL `process.env.NEXT_PUBLIC_CEREBRO_BETA` is what Next inlines at build time in server, proxy AND browser bundles
// (passing `process.env` as a whole would be empty in the browser). Tests pass their own env object instead.
export const betaScopeOn = (env?: Env): boolean => (env ? env.NEXT_PUBLIC_CEREBRO_BETA : process.env.NEXT_PUBLIC_CEREBRO_BETA) === 'private'

/** Page paths that stay open (exact match, or the path followed by "/…" for the prefixes). */
export const BETA_PAGE_EXACT = ['/', '/login', '/editor'] as const
export const BETA_PAGE_PREFIXES = ['/projects', '/scripts', '/create', '/library', '/audio', '/storage', '/editor/manual', '/legal'] as const

/** API routes that stay open. Everything else under /api answers 404 {blocked:'beta'} before reaching its handler. */
export const BETA_API_ALLOWED: RegExp[] = [
  /^\/api\/assets\/[^/]+\/signed-url$/,   // playable/downloadable signed link of the user's own file
  /^\/api\/storage\/usage$/,              // quota read
  /^\/api\/storage\/upload-url$/,         // signed upload for the user's own folder
  /^\/api\/providers\/status$/,           // configuration presence only, calls no provider
]

const under = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`)
export const isBetaPage = (pathname: string): boolean =>
  (BETA_PAGE_EXACT as readonly string[]).includes(pathname) || BETA_PAGE_PREFIXES.some(x => under(pathname, x))
export const isBetaApi = (pathname: string): boolean => BETA_API_ALLOWED.some(r => r.test(pathname))

export type BetaVerdict = 'open' | 'redirect-home' | 'api-closed'
/** What the server does with a path when the beta scope is on. Static files and Next internals are not passed here. */
export function betaVerdict(pathname: string, env?: Env): BetaVerdict {
  if (!betaScopeOn(env)) return 'open'
  if (pathname.startsWith('/api/')) return isBetaApi(pathname) ? 'open' : 'api-closed'
  return isBetaPage(pathname) ? 'open' : 'redirect-home'
}

/** Navigation entries and tiles to show: all of them when the scope is off, only the in-scope ones when it is on. */
export function inBetaScope<T extends { href: string }>(items: T[], env?: Env): T[] {
  return betaScopeOn(env) ? items.filter(m => isBetaPage(m.href)) : items
}
