import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const protectedPrefixes = ['/projects', '/market-intelligence', '/opportunities', '/scripts', '/create', '/library', '/youtube', '/analytics', '/images', '/videos', '/voices', '/thumbnails', '/radar', '/audio']

export async function proxy(request: NextRequest) {
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

export const config = {
  matcher: [
    '/projects/:path*', '/market-intelligence/:path*', '/opportunities/:path*', '/scripts/:path*', '/create/:path*',
    '/library/:path*', '/youtube/:path*', '/analytics/:path*', '/images/:path*', '/videos/:path*', '/voices/:path*', '/thumbnails/:path*', '/radar/:path*', '/audio/:path*',
  ],
}
