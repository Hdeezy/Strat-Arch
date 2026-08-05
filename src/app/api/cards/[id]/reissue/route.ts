/**
 * REISSUE — put reclaimed value onto a replacement card.
 *
 * The other half of the lost-and-stolen flow. `/wallet/[code]` tells members
 * "call us and we will stop this card and give you a new one with the same
 * money on it." Invalidate does the stopping. This does the giving.
 *
 * `[id]` is the NEW card. The old one is named in the body, because the
 * advocate is holding the replacement and reading its code.
 *
 * LEDGER-SPEC §9.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reissueCard, reclaimedAmountFor, cardBalance } from '@/ledger'
import { normalizeCardCode } from '@/lib/utils'
import { z } from 'zod'

const schema = z.object({
  from_card_code: z.string().min(1),
  reason: z.string().max(500).optional().default('Replacement for a lost or stolen card'),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const admin = createAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (!profile || !['advocate', 'charity_admin', 'super_admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const { data: oldCard } = await admin
      .from('cards')
      .select('id, card_code, state, charity_id')
      .eq('card_code', normalizeCardCode(parsed.data.from_card_code))
      .maybeSingle()

    if (!oldCard) {
      return NextResponse.json({ error: 'Original card not found' }, { status: 404 })
    }

    // Reissue only from a card that has actually been stopped. Otherwise this
    // is a way to duplicate a live card's value onto a second card.
    if (oldCard.state !== 'invalidated') {
      return NextResponse.json(
        { error: 'The original card must be invalidated before its value can be reissued' },
        { status: 409 }
      )
    }

    const { data: newCard } = await admin
      .from('cards')
      .select('id, card_code, state, charity_id, reissued_from_card_id')
      .eq('id', params.id)
      .maybeSingle()

    if (!newCard) return NextResponse.json({ error: 'Replacement card not found' }, { status: 404 })

    if (newCard.charity_id !== oldCard.charity_id) {
      return NextResponse.json({ error: 'Cards belong to different charities' }, { status: 403 })
    }
    if (newCard.state === 'invalidated' || newCard.state === 'expired') {
      return NextResponse.json({ error: `Cannot reissue onto a ${newCard.state} card` }, { status: 400 })
    }
    if (newCard.reissued_from_card_id) {
      return NextResponse.json(
        { error: 'This card has already received a reissue', replayed: true },
        { status: 409 }
      )
    }

    // Advocates are scoped to their own charity.
    if (profile.role === 'advocate') {
      const { data: advocate } = await admin
        .from('advocates')
        .select('charity_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()

      if (!advocate || advocate.charity_id !== oldCard.charity_id) {
        return NextResponse.json({ error: 'Card belongs to a different charity' }, { status: 403 })
      }
    }

    // The amount is derived inside the ledger from the original reclaim, so
    // this route cannot ask for more than the old card actually held.
    const reclaimed = await reclaimedAmountFor(oldCard.id)
    if (reclaimed <= 0) {
      return NextResponse.json(
        { error: 'No reclaimed value found for the original card' },
        { status: 409 }
      )
    }

    const { amountCents } = await reissueCard({
      toCardId: newCard.id,
      fromCardId: oldCard.id,
    })

    await admin.from('card_events').insert([
      {
        card_id: newCard.id,
        event_type: 'issued',
        actor_type: profile.role === 'advocate' ? 'advocate' : 'admin',
        actor_ref: user.id,
        metadata: {
          reissued_from: oldCard.card_code,
          amount_cents: amountCents,
          reason: parsed.data.reason,
        },
      },
    ])

    return NextResponse.json({
      success: true,
      new_card_code: newCard.card_code,
      reissued_cents: amountCents,
      new_balance_cents: await cardBalance(admin, newCard.id),
    })
  } catch (err) {
    console.error('Reissue error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
