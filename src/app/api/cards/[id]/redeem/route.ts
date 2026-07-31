/**
 * RETIRED — single-phase redemption.
 *
 * This endpoint debited cards.balance_cents directly. That path predates the
 * ledger and does NOT post double-entry transactions, so leaving it callable
 * would mean two ways to move money, one of which is invisible to the
 * ledger. Invariant 3 (balances equal replay) would start failing the first
 * time anyone hit it.
 *
 * Replaced by the two-phase model — Scrappy Cut shape decision 3:
 *
 *   POST /api/redemption/authorize   { credential }
 *   POST /api/redemption/capture     { authorization_id, amount_cents }
 *   POST /api/redemption/void        { authorization_id }
 *
 * Kept as a 410 rather than deleted so that a stale PWA cached on a vendor's
 * phone gets a clear answer instead of a 404 it might treat as a network
 * blip and retry.
 */

import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: 'This endpoint has been retired.',
      reason: 'Single-phase redemption bypassed the ledger. Use the two-phase flow.',
      use_instead: {
        authorize: 'POST /api/redemption/authorize',
        capture: 'POST /api/redemption/capture',
        void: 'POST /api/redemption/void',
      },
    },
    { status: 410 }
  )
}
