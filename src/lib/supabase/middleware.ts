import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Session refresh + the auth gate on protected paths.
 *
 * ┌─ WHY THIS FUNCTION REFUSES TO THROW ───────────────────────────────────┐
 * │ Middleware runs on EVERY request. An exception here is not a broken    │
 * │ page — it is MIDDLEWARE_INVOCATION_FAILED and a 500 on every route in  │
 * │ the application, including the ones that would have told you what was  │
 * │ wrong.                                                                  │
 * │                                                                         │
 * │ This previously read process.env.NEXT_PUBLIC_SUPABASE_URL! with a       │
 * │ non-null assertion. That assertion is a compile-time claim with no      │
 * │ runtime force: deployed without the environment variables set, the      │
 * │ client received undefined, threw, and took the whole site down. The     │
 * │ symptom gave no hint that the cause was a missing env var.              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

export type SessionResult =
  | { kind: 'ok'; response: NextResponse }
  | { kind: 'unconfigured'; missing: string[] }

export async function updateSession(request: NextRequest): Promise<SessionResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const missing: string[] = []
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (missing.length > 0) {
    return { kind: 'unconfigured', missing }
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(url!, anonKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(
            name,
            value,
            options as Parameters<typeof supabaseResponse.cookies.set>[2]
          )
        )
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()

  const protectedPaths = ['/advocate', '/merchant', '/admin']
  const isProtected = protectedPaths.some(p => request.nextUrl.pathname.startsWith(p))

  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectTo', request.nextUrl.pathname)
    return { kind: 'ok', response: NextResponse.redirect(redirectUrl) }
  }

  return { kind: 'ok', response: supabaseResponse }
}
