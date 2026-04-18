import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

interface CookieToSet {
  name: string
  value: string
  options?: CookieOptions
}

export async function middleware(request: NextRequest) {
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isPublicAsset =
    request.nextUrl.pathname.startsWith('/_next/') ||
    request.nextUrl.pathname.startsWith('/favicon')

  if (isApiRoute || isPublicAsset) {
    return NextResponse.next()
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key || url.includes('placeholder')) {
    if (process.env.NODE_ENV === 'production') {
      const isLoginPage = request.nextUrl.pathname === '/login'
      if (!isLoginPage) {
        return NextResponse.redirect(new URL('/login', request.url))
      }
    }
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    })

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const isLoginPage = request.nextUrl.pathname === '/login'

    if (!user && !isLoginPage) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    if (user && isLoginPage) {
      return NextResponse.redirect(new URL('/inbox', request.url))
    }
  } catch (err) {
    // Supabase unreachable / cookie parse error / network blip. Two
    // failure modes:
    //   - the user is genuinely already on /login → let them through so
    //     they can sign in once Supabase recovers
    //   - any other path → redirect to /login. This is critical: pages
    //     in the (dashboard) tree DO have their own server-side
    //     `redirect('/login')` checks, but if their data fetches throw
    //     before that check runs, an unauthenticated request can briefly
    //     render a partial dashboard frame. The middleware redirect
    //     closes that hole.
    console.warn('[middleware] auth client error:', err instanceof Error ? err.message : err)
    const isLoginPage = request.nextUrl.pathname === '/login'
    if (!isLoginPage) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
