/**
 * Magic-link landing.
 *
 * Resolves the portal here rather than bouncing through '/', so someone
 * clicking a link in their email arrives at their workspace in one hop
 * instead of watching two redirects.
 *
 * An explicit `next` always wins — that is the "you were trying to reach
 * this page, sign in first" case, and second-guessing it would drop people
 * somewhere they did not ask for.
 */

import { createClient } from '@/lib/supabase/server'
import { resolvePortalAccess } from '@/lib/portal-routing'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_error`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_error`)
  }

  if (next && next !== '/') {
    return NextResponse.redirect(`${origin}${next}`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const access = await resolvePortalAccess(user.id)
    if (access.portal !== 'none') {
      return NextResponse.redirect(`${origin}${access.href}`)
    }
    // Signed in, but linked to nothing yet. The front door explains that
    // better than dropping them into a portal that will refuse them.
    return NextResponse.redirect(`${origin}/auth/no-access`)
  }

  return NextResponse.redirect(`${origin}/`)
}
