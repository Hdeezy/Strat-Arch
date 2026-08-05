import { NextRequest, NextResponse } from 'next/server'

/**
 * Cron routes move money and read the whole ledger. They are reachable at a
 * public URL, so they authenticate.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every invocation
 * when CRON_SECRET is set in the project. If it is not set, the route refuses
 * rather than running open — an unauthenticated endpoint that releases
 * clearance holds is a way to make donations spendable early.
 */
export function assertCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    console.error('[CRON] CRON_SECRET is not configured; refusing to run.')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
  }

  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
