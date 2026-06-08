// Shared fraud-flag detection logic — callable from both the API route and
// server components (admin dashboard), avoiding the broken internal-fetch pattern.

import { createAdminClient } from '@/lib/supabase/admin'

export interface SuspiciousFlag {
  type: 'rapid_redemption' | 'velocity_outlier' | 'quick_load_redeem'
  card_id: string
  card_code: string
  detail: string
  occurred_at: string
}

export async function computeFlags(charityId?: string): Promise<SuspiciousFlag[]> {
  const admin = createAdminClient()
  const flags: SuspiciousFlag[] = []

  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  // ─── Flag 1: Same card redeemed 3+ times in one hour ───────────────────────
  let rapidQuery = admin
    .from('redemptions')
    .select('card_id, cards(card_code, charity_id)')
    .eq('status', 'succeeded')
    .gte('occurred_at', oneHourAgo)

  const { data: rapidRedemptions } = await rapidQuery

  const counts: Record<string, { count: number; code: string; charityId: string }> = {}
  for (const r of rapidRedemptions ?? []) {
    const card = r.cards as { card_code: string; charity_id: string } | null
    if (!card) continue
    if (charityId && card.charity_id !== charityId) continue
    if (!counts[r.card_id]) {
      counts[r.card_id] = { count: 0, code: card.card_code, charityId: card.charity_id }
    }
    counts[r.card_id].count++
  }
  for (const [card_id, { count, code }] of Object.entries(counts)) {
    if (count >= 3) {
      flags.push({
        type: 'rapid_redemption',
        card_id,
        card_code: code,
        detail: `Card redeemed ${count} times in the last hour`,
        occurred_at: now.toISOString(),
      })
    }
  }

  // ─── Flag 2: Card redeemed within 60 s of being loaded ─────────────────────
  // Fetch all load events and succeeded redemptions in the past 24 h, then join
  // in memory — avoids an N+1 DB query per load event.
  const [loadsResult, redeemsResult] = await Promise.all([
    admin
      .from('card_events')
      .select('card_id, occurred_at, cards(card_code, charity_id)')
      .eq('event_type', 'loaded')
      .gte('occurred_at', oneDayAgo),
    admin
      .from('redemptions')
      .select('card_id, occurred_at')
      .eq('status', 'succeeded')
      .gte('occurred_at', oneDayAgo),
  ])

  // Build a lookup: card_id → sorted list of redemption timestamps
  const redeemsByCard: Record<string, Date[]> = {}
  for (const r of redeemsResult.data ?? []) {
    if (!redeemsByCard[r.card_id]) redeemsByCard[r.card_id] = []
    redeemsByCard[r.card_id].push(new Date(r.occurred_at))
  }

  const alreadyFlagged = new Set<string>()
  for (const load of loadsResult.data ?? []) {
    const card = load.cards as { card_code: string; charity_id: string } | null
    if (!card) continue
    if (charityId && card.charity_id !== charityId) continue
    if (alreadyFlagged.has(load.card_id)) continue

    const loadTime = new Date(load.occurred_at)
    const window = loadTime.getTime() + 60_000

    const quickRedeem = redeemsByCard[load.card_id]?.find(
      t => t >= loadTime && t.getTime() <= window
    )

    if (quickRedeem) {
      flags.push({
        type: 'quick_load_redeem',
        card_id: load.card_id,
        card_code: card.card_code,
        detail: 'Card redeemed within 60 seconds of being loaded',
        occurred_at: load.occurred_at,
      })
      alreadyFlagged.add(load.card_id)
    }
  }

  return flags
}
