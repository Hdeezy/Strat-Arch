/**
 * REAPING ABANDONED AUTHORIZATION HOLDS.
 *
 * A hold takes value out of a member's spendable balance. If a vendor opens
 * one and never closes it — the sale fell through, the phone died, the app
 * was backgrounded — that value is stuck until something releases it.
 *
 * This runs in two places, deliberately:
 *
 *   1. LAZILY, at the top of /api/redemption/authorize. Any vendor touching
 *      any card self-heals every stale hold in the system.
 *   2. On the daily clearance cron, as the backstop for a quiet day.
 *
 * The lazy path is the one that matters. Vercel's Hobby plan allows only
 * daily crons, so a cron-only design would leave a member unable to spend
 * their own money for up to 24 hours. Releasing at the point of use bounds
 * that to "until the next time anyone uses a card here", which at pilot
 * volume is minutes.
 *
 * That is a better design than the hourly cron it replaces, independent of
 * the billing constraint that forced it.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { voidAuthorization } from './index'

export interface ReapResult {
  voided: string[]
  errors: string[]
}

/**
 * Expire every authorization past its 15-minute window and return the held
 * value to its card.
 *
 * `expire_stale_authorizations()` flips the rows and hands them back, so the
 * matching ledger voids still go through the ledger module rather than being
 * posted from SQL. Idempotent: the void key is derived from the
 * authorization id, so a concurrent caller cannot double-refund.
 */
export async function reapExpiredAuthorizations(): Promise<ReapResult> {
  const admin = createAdminClient()
  const voided: string[] = []
  const errors: string[] = []

  const { data, error } = await admin.rpc('expire_stale_authorizations')
  if (error) {
    errors.push(`expire: ${error.message}`)
    return { voided, errors }
  }

  const stale = (data ?? []) as { id: string; card_id: string; authorized_cents: number }[]

  for (const a of stale) {
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

  return { voided, errors }
}
