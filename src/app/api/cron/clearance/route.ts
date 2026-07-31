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
 *      the card. Without this, a vendor who opens a hold and then closes
 *      their phone leaves a card quietly unusable until someone notices.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearDonation, voidAuthorization } from '@/ledger'
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

  // ── 2. Reap stale authorizations ─────────────────────────────────────────
  // expire_stale_authorizations() flips the rows and hands them back so the
  // matching ledger voids go through the ledger module rather than SQL.
  const { data: stale, error: staleError } = await admin.rpc('expire_stale_authorizations')
  if (staleError) errors.push(`expire: ${staleError.message}`)

  for (const a of (stale ?? []) as { id: string; card_id: string; authorized_cents: number }[]) {
    try {
      await voidAuthorization({
        authorizationId: a.id,
        cardId: a.card_id,
        amountCents: a.authorized_cents,
        reason: 'Authorization expired without capture',
      })
      voided.push(a.id)
    } catch (err) {
      errors.push(`void ${a.id}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

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
