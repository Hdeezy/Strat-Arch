/**
 * CRON 1 of 3 — CLEARANCE RELEASE + AUTHORIZATION EXPIRY.
 *
 * Scrappy Cut §3: "Three Vercel crons: clearance release, nightly
 * reconciliation, weekly settlement."
 *
 * Two jobs share this schedule because both are about releasing value that
 * is stuck:
 *
 *   1. Donations whose clearance window has elapsed join the spendable float.
 *   2. Authorizations nobody closed are voided and the held value returns to
 *      the card.
 *
 * DAILY, not hourly. Vercel's Hobby plan allows at most one run per day.
 *
 * That constraint is survivable because neither job depends on this cron
 * alone. Clearance is a 72-hour window, so a few hours of granularity is
 * noise. Stale holds are reaped on every /api/redemption/authorize call, so
 * the moment any vendor touches any card the whole system self-heals — this
 * run is the backstop for a quiet day, not the primary path.
 *
 * If the cron were the only reaper, a member could be unable to spend their
 * own money for 24 hours. That would not be acceptable, and the lazy path in
 * src/ledger/expiry.ts is what makes the daily schedule safe.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearDonation } from '@/ledger'
import { reapExpiredAuthorizations } from '@/ledger/expiry'
import { assertCron } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = assertCron(req)
  if (denied) return denied

  const admin = createAdminClient()
  const cleared: string[] = []
  const voided: string[] = []
  const errors: string[] = []

  // ── 1. Release cleared donations into the float ──────────────────────────
  const { data: due } = await admin
    .from('donations')
    .select('id, amount_cents')
    .is('cleared_at', null)
    .is('reversed_at', null)
    .lte('clearance_due_at', new Date().toISOString())
    .limit(500)

  for (const d of due ?? []) {
    try {
      await clearDonation({ donationId: d.id, amountCents: d.amount_cents })
      cleared.push(d.id)
    } catch (err) {
      errors.push(`clear ${d.id}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // ── 2. Reap stale authorizations (backstop; the authorize path is primary)
  const reaped = await reapExpiredAuthorizations()
  voided.push(...reaped.voided)
  errors.push(...reaped.errors)

  // ── 3. Housekeeping ──────────────────────────────────────────────────────
  await admin.rpc('cleanup_expired_nonces')
  await admin.rpc('cleanup_credential_lookups')

  if (errors.length) console.error('[CRON clearance] errors:', errors)

  return NextResponse.json({
    cleared: cleared.length,
    authorizations_voided: voided.length,
    errors,
  })
}
