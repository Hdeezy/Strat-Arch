/**
 * CRON 3 of 3 — WEEKLY SETTLEMENT INSTRUCTIONS.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  THIS FILE PRODUCES A LIST. IT DOES NOT MOVE MONEY.                  │
 * │                                                                      │
 * │  Shape decision 7 and the RPAA boundary. No file in the settlement   │
 * │  path may call a banking or payout API. A human reads the list,      │
 * │  makes the transfers, and then records that they did.                │
 * │                                                                      │
 * │  Stack Decision Record §4 rule 4. Do not "improve" this by adding    │
 * │  a Stripe payout call.                                               │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertCron } from '@/lib/cron-auth'
import { formatCAD } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = assertCron(req)
  if (denied) return denied

  const admin = createAdminClient()

  const { data: instructions, error } = await admin
    .from('settlement_instructions')
    .select('*')

  if (error) {
    console.error('[CRON settlement] failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (instructions ?? []) as {
    merchant_id: string
    merchant_name: string
    outstanding_cents: number
  }[]

  const total = rows.reduce((s, r) => s + Number(r.outstanding_cents), 0)

  // The founder reads this in the logs, makes the transfers, then calls
  // recordSettlement() for each one through the admin console.
  console.info(
    `[SETTLEMENT ${new Date().toISOString().slice(0, 10)}] ` +
    `${rows.length} vendor(s), ${formatCAD(total)} outstanding:\n` +
    rows.map(r => `  ${r.merchant_name}: ${formatCAD(Number(r.outstanding_cents))}`).join('\n')
  )

  return NextResponse.json({
    period_end: new Date().toISOString().slice(0, 10),
    vendor_count: rows.length,
    total_outstanding_cents: total,
    instructions: rows,
    note: 'Instructions only. Payments are executed by a human, then recorded via recordSettlement().',
  })
}
