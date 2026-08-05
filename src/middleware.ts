import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// ─── Rate limiting ──────────────────────────────────────────────────────────
// Sliding-window counter per (IP, path-prefix). Single-process only — works
// for development and low-traffic preview deploys.
// Production: replace with Upstash Redis + @upstash/ratelimit for multi-instance.

const _rl = new Map<string, { count: number; resetAt: number }>()

// [path prefix, max requests, window ms]
const RATE_LIMITS: [string, number, number][] = [
  ['/api/checkout/create',      10,  60_000],  // 10 donation attempts / min per IP
  ['/api/cards/validate-token', 30,  60_000],  // 30 QR validates / min per IP
  ['/api/cards',                60,  60_000],  // 60 card ops / min per IP
  ['/api/stripe/webhook',      120,  60_000],  // high — Stripe retries aggressively
]

function rateLimitAllowed(ip: string, pathname: string): boolean {
  const limit = RATE_LIMITS.find(([prefix]) => pathname.startsWith(prefix))
  if (!limit) return true

  const [prefix, max, windowMs] = limit
  const key = `${ip}\0${prefix}`
  const now = Date.now()
  const entry = _rl.get(key)

  if (!entry || entry.resetAt < now) {
    _rl.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

// ─── Security headers ───────────────────────────────────────────────────────

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Camera for QR scanning; geolocation for nearby-merchant map
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
}

// CSP tuned for Next.js + Supabase + Stripe Checkout.
// unsafe-inline / unsafe-eval are required by Next.js runtime scripts.
// Tighten to nonces if stricter CSP is needed in future.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "font-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
].join('; ')

function applySecurityHeaders(res: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(name, value)
  }
  res.headers.set('Content-Security-Policy', CSP)
  if (process.env.NODE_ENV === 'production') {
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    )
  }
  return res
}

// ─── Main middleware ─────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'

  // Rate limiting — checked before the (heavier) Supabase session refresh
  if (pathname.startsWith('/api/') && !rateLimitAllowed(ip, pathname)) {
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      }
    )
  }

  // Supabase session refresh + auth-guard redirect for /advocate, /merchant, /admin.
  //
  // Wrapped because middleware failure is total: an exception here returns
  // MIDDLEWARE_INVOCATION_FAILED for every route, including whichever page
  // would have explained the problem. Whatever goes wrong, the request still
  // gets served.
  let res: NextResponse
  try {
    const session = await updateSession(request)

    if (session.kind === 'unconfigured') {
      return applySecurityHeaders(unconfiguredResponse(request, session.missing))
    }
    res = session.response
  } catch (err) {
    console.error('[middleware] session refresh failed; serving request unauthenticated:', err)
    // Pass through rather than 500. Every protected layout independently
    // checks auth server-side, so a failure here degrades the session
    // refresh — it does not open a door.
    res = NextResponse.next({ request })
  }

  return applySecurityHeaders(res)
}

/**
 * The app is deployed but its environment variables are not set.
 *
 * A raw 500 for this is unkind: the cause is a dashboard setting, and the
 * only person who sees the error is the one who can fix it. So say which
 * variables are missing and where they go.
 */
function unconfiguredResponse(request: NextRequest, missing: string[]): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return new NextResponse(
      JSON.stringify({ error: 'Server is not configured', missing }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const list = missing.map(m => `<li><code>${m}</code></li>`).join('')
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Not configured</title>
     <style>
       body{font:16px/1.6 ui-sans-serif,system-ui,sans-serif;background:#020617;color:#e2e8f0;
            display:grid;place-items:center;min-height:100vh;margin:0;padding:2rem}
       main{max-width:34rem}
       h1{font-size:1.5rem;margin:0 0 .75rem;color:#fff}
       code{background:#1e293b;padding:.15em .4em;border-radius:4px;font-size:.9em;color:#6ee7b7}
       ul{padding-left:1.2rem} li{margin:.25rem 0}
       p{color:#94a3b8} a{color:#6ee7b7}
     </style>
     <main>
       <h1>This deployment isn't configured yet</h1>
       <p>The app is running, but these environment variables are missing:</p>
       <ul>${list}</ul>
       <p>Add them in Vercel under <strong>Settings → Environment Variables</strong>,
          then redeploy. Values in a local <code>.env.local</code> are not used by
          a deployment — Vercel has its own copy.</p>
       <p>See <code>docs/DEPLOY.md</code> §5 for the full list.</p>
     </main>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export const config = {
  matcher: [
    // Skip static assets, Next.js internals, service worker, and PWA icons
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|workbox-|icons/).*)',
  ],
}
