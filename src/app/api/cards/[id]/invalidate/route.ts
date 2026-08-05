/**
 * INVALIDATE A CARD — lost, stolen, or reported.
 *
 * Two things have to happen and only one of them used to:
 *
 *   1. The card stops working. (This already did that.)
 *   2. The value on it is RECLAIMED so it can be put on a replacement.
 *
 * Without step 2 the balance is stranded: unspendable because the state gate
 * refuses it, and unreissuable because the ledger still shows it sitting on
 * a dead card. The member who phoned the number on their card loses their
 * money in exchange for reporting the theft, which is the opposite of what
 * the phone number is for.
 *
 * LEDGER-SPEC §8.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reclaimCard } from '@/ledger'
import { z } from 'zod'

const schema = z.object({
  reason: z.string().max(500).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const admin = createAdminClient()

    // Check role
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    const allowedRoles = ['advocate', 'charity_admin', 'super_admin']
    if (!profile || !allowedRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // For advocates, check charity scoping
    if (profile.role === 'advocate') {
      const { data: advocate } = await admin
        .from('advocates')
        .select('charity_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single()

      const { data: card } = await admin
        .from('cards')
        .select('charity_id, state')
        .eq('id', params.id)
        .single()

      if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
      if (advocate?.charity_id !== card.charity_id) {
        return NextResponse.json({ error: 'Card belongs to a different charity' }, { status: 403 })
      }
      if (card.state === 'invalidated') {
        return NextResponse.json({ error: 'Card is already invalidated' }, { status: 400 })
      }
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    const reason = parsed.success ? (parsed.data.reason || 'No reason provided') : 'No reason provided'

    // Reclaim FIRST, while the card is still 'active'. The reclaim posts a
    // ledger transaction that drives the balance to zero; doing it after the
    // state flip would work, but this order means a failure part-way through
    // leaves a live card with its money rather than a dead card holding
    // value nobody can reach.
    const reclaimTxn = await reclaimCard({ cardId: params.id })

    const { error: updateError } = await admin
      .from('cards')
      .update({ state: 'invalidated', invalidated_at: new Date().toISOString() })
      .eq('id', params.id)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to invalidate card' }, { status: 500 })
    }

    const actorType: 'admin' | 'advocate' =
      profile.role === 'advocate' ? 'advocate' : 'admin'

    await admin.from('card_events').insert({
      card_id: params.id,
      event_type: 'invalidated',
      actor_type: actorType,
      actor_ref: user.id,
      metadata: { reason, reclaim_transaction_id: reclaimTxn },
    })

    // reclaimCard returns null when there was nothing left to reclaim.
    const { data: reclaimed } = await admin
      .from('ledger_balances')
      .select('balance_cents')
      .eq('account_type', 'reclaimed')
      .maybeSingle()

    return NextResponse.json({
      success: true,
      reclaimed: reclaimTxn !== null,
      reclaimed_pool_cents: Number(reclaimed?.balance_cents ?? 0),
    })
  } catch (err) {
    console.error('Invalidate card error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
