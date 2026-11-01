import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { betaVerdict } from '@/lib/beta-scope'

const protectedPrefixes = ['/projects', '/market-intelligence', '/opportunities', '/scripts', '/create', '/library', '/youtube', '/analytics', '/images', '/videos', '/voices', '/thumbnails', '/radar', '/audio', '/editor', '/repurpose', '/automations', '/studio', '/usage', '/social', '/connectors', '/campaigns', '/shorts', '/influencer', '/calendar', '/workflows', '/add']

/** Paths that ran this proxy before the beta scope existed (the old matcher). */
const AUTH_AWARE = ['/studio', '/usage', '/projects', '/market-intelligence', '/opportunities', '/scripts', '/create', '/library', '/youtube', '/analytics', '/images', '/videos', '/voices', '/thumbnails', '/radar', '/audio', '/editor', '/repurpose', '/automations', '/social', '/connectors', '/campaigns', '/shorts', '/influencer', '/calendar', '/workflows', '/add']
const isAuthAware = (p: string) => AUTH_AWARE.some(x => p === x || p.startsWith(`${x}/`))

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const verdict = betaVerdict(path)
  if (verdict === 'api-closed') return NextResponse.json({ error: 'Esta función está desactivada en la beta privada.', blocked: 'beta' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  if (verdict === 'redirect-home') { const home = request.nextUrl.clone(); home.pathname = '/'; home.search = '?beta=fuera-de-alcance'; return NextResponse.redirect(home) }
  if (!isAuthAware(path)) return NextResponse.next()
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const needsAuth = protectedPrefixes.some(prefix => request.nextUrl.pathname.startsWith(prefix))

  if (needsAuth && !user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
    loginUrl.search = `?next=${encodeURIComponent(nextPath)}`
    return NextResponse.redirect(loginUrl)
  }

  return response
}

// Runs on every path so the beta scope (lib/beta-scope.ts) can close what is out of scope; static files and Next internals are excluded.
// Paths that were not in the previous, narrower matcher get a plain pass-through below, so nothing else changes.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|images/).*)'],
}
