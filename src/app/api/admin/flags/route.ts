import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface SuspiciousFlag {
  type: 'rapid_redemption' | 'velocity_outlier' | 'quick_load_redeem'
  card_id: string
  card_code: string
  detail: string
  occurred_at: string
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('user_id', user.id).single()

    if (!profile || !['charity_admin', 'super_admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const flags: SuspiciousFlag[] = []
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    // Flag 1: Same card redeemed 3+ times in same hour
    const { data: rapidRedemptions } = await admin
      .from('redemptions')
      .select('card_id, cards(card_code)')
      .eq('status', 'succeeded')
      .gte('occurred_at', oneHourAgo)

    const cardRedemptionCounts: Record<string, { count: number; code: string; latest: string }> = {}
    for (const r of rapidRedemptions || []) {
      const card = r.cards as { card_code: string } | null
      if (!cardRedemptionCounts[r.card_id]) {
        cardRedemptionCounts[r.card_id] = { count: 0, code: card?.card_code || '', latest: '' }
      }
      cardRedemptionCounts[r.card_id].count++
    }

    for (const [card_id, { count, code }] of Object.entries(cardRedemptionCounts)) {
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

    // Flag 2: Card loaded then redeemed within 60 seconds
    const { data: recentLoads } = await admin
      .from('card_events')
      .select('card_id, occurred_at, cards(card_code)')
      .eq('event_type', 'loaded')
      .gte('occurred_at', oneDayAgo)

    for (const load of recentLoads || []) {
      const loadTime = new Date(load.occurred_at)
      const sixtySecondsLater = new Date(loadTime.getTime() + 60000).toISOString()

      const { data: quickRedeem } = await admin
        .from('redemptions')
        .select('id')
        .eq('card_id', load.card_id)
        .eq('status', 'succeeded')
        .gte('occurred_at', load.occurred_at)
        .lte('occurred_at', sixtySecondsLater)
        .limit(1)
        .single()

      if (quickRedeem) {
        const card = load.cards as { card_code: string } | null
        flags.push({
          type: 'quick_load_redeem',
          card_id: load.card_id,
          card_code: card?.card_code || '',
          detail: 'Card redeemed within 60 seconds of being loaded',
          occurred_at: load.occurred_at,
        })
      }
    }

    return NextResponse.json({ flags })
  } catch (err) {
    console.error('Flags error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
