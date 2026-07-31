/**
 * CRON 2 of 3 — NIGHTLY RECONCILIATION.
 *
 * Runs the five invariants against production and alerts on any failure.
 *
 * The whole claim of the ledger design is that financial history can be
 * re-derived rather than trusted. That claim is worth nothing unless
 * something checks it on a schedule and shouts when it stops being true.
 *
 * Scrappy Cut §3: the exception queue is cut down to "email alert to the
 * founder". This logs at error level, which is what Sentry picks up.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { replayAndCompare } from '@/ledger/replay'
import { assertCron } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = assertCron(req)
  if (denied) return denied

  const admin = createAdminClient()

  // The database's own view of the five invariants.
  const { data: invariants, error } = await admin.rpc('check_ledger_invariants')
  if (error) {
    console.error('[CRON reconcile] invariant check failed to run:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const failed = ((invariants ?? []) as { invariant: string; passed: boolean; offenders: number }[])
    .filter(i => !i.passed)

  // The application's independent replay, so a bug in the SQL views cannot
  // quietly mark itself healthy.
  const report = await replayAndCompare()

  if (failed.length > 0 || !report.ok) {
    console.error(
      '[CRON reconcile] LEDGER INVARIANT FAILURE — this is a stop-everything event.',
      JSON.stringify({ failed, report }, null, 2)
    )
  }

  // Float health. A negative float means a chargeback landed on already-cleared
  // money and the pool is carrying a loss. Correct behaviour, but somebody has
  // to know about it.
  const { data: float } = await admin
    .from('ledger_balances')
    .select('balance_cents')
    .eq('account_type', 'card_float')
    .maybeSingle()

  const floatCents = Number(float?.balance_cents ?? 0)
  if (floatCents < 0) {
    console.error(`[CRON reconcile] card_float is NEGATIVE: ${floatCents} cents.`)
  }

  return NextResponse.json({
    ok: failed.length === 0 && report.ok,
    invariants,
    drift: report.drift,
    float_cents: floatCents,
    checked_cards: report.checkedCards,
  })
}
