/**
 * CAPTURE — phase two of the two-phase redemption.
 *
 * The vendor rang $4.25 against an authorization that reserved $18. This
 * moves $4.25 to the vendor's payable and returns $13.75 to the card, in one
 * atomic ledger transaction. The member has their remaining balance back
 * before they have walked away from the counter.
 *
 * Capture can never exceed the authorization. That bound is enforced here,
 * in the ledger module, and as a CHECK constraint on the row — three times,
 * because it is the single most consequential limit in the system.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureAuthorization } from '@/ledger'
import { z } from 'zod'

const schema = z.object({
  authorization_id: z.string().uuid(),
  amount_cents: z.number().int().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const admin = createAdminClient()
    const { data: staff } = await admin
      .from('merchant_staff')
      .select('merchant_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!staff) {
      return NextResponse.json({ error: 'Not authorized as merchant staff' }, { status: 403 })
    }

    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const { authorization_id, amount_cents } = parsed.data

    const { data: auth } = await admin
      .from('authorizations')
      .select('id, card_id, merchant_id, authorized_cents, captured_cents, status')
      .eq('id', authorization_id)
      .maybeSingle()

    if (!auth) {
      return NextResponse.json({ captured: false, reason: 'authorization_not_found' }, { status: 404 })
    }

    // An authorization belongs to the terminal that opened it.
    if (auth.merchant_id !== staff.merchant_id) {
      return NextResponse.json({ captured: false, reason: 'wrong_merchant' }, { status: 403 })
    }

    if (auth.status === 'captured') {
      // Idempotent replay — the Charge button was double-tapped, or the
      // response was lost. Return the original outcome, capture nothing more.
      const { data: card } = await admin
        .from('cards')
        .select('balance_cents')
        .eq('id', auth.card_id)
        .single()
      return NextResponse.json({
        captured: true,
        captured_cents: auth.captured_cents,
        new_balance_cents: card?.balance_cents ?? 0,
        replayed: true,
      })
    }

    if (auth.status !== 'open') {
      return NextResponse.json({ captured: false, reason: `authorization_${auth.status}` }, { status: 409 })
    }

    if (amount_cents > auth.authorized_cents) {
      return NextResponse.json(
        {
          captured: false,
          reason: 'exceeds_authorization',
          room_cents: auth.authorized_cents,
        },
        { status: 422 }
      )
    }

    await captureAuthorization({
      authorizationId: auth.id,
      cardId: auth.card_id,
      merchantId: auth.merchant_id,
      authorizedCents: auth.authorized_cents,
      capturedCents: amount_cents,
    })

    await admin
      .from('authorizations')
      .update({
        captured_cents: amount_cents,
        status: 'captured',
        closed_at: new Date().toISOString(),
      })
      .eq('id', auth.id)

    // The daily cap tracks what was actually spent, not what was authorized.
    const { data: card } = await admin
      .from('cards')
      .select('balance_cents, spent_today_cents, last_spent_reset_at')
      .eq('id', auth.card_id)
      .single()

    const { isNewDay } = await import('@/lib/utils')
    const rolledOver = card ? isNewDay(card.last_spent_reset_at) : false
    await admin
      .from('cards')
      .update({
        spent_today_cents: (rolledOver ? 0 : card?.spent_today_cents ?? 0) + amount_cents,
        ...(rolledOver ? { last_spent_reset_at: new Date().toISOString() } : {}),
      })
      .eq('id', auth.card_id)

    const { data: merchant } = await admin
      .from('merchants')
      .select('name, category')
      .eq('id', auth.merchant_id)
      .single()

    await admin.from('card_events').insert({
      card_id: auth.card_id,
      event_type: 'redemption_succeeded',
      actor_type: 'merchant',
      actor_ref: auth.merchant_id,
      metadata: {
        authorization_id: auth.id,
        merchant_name: merchant?.name,
        amount_cents,
        authorized_cents: auth.authorized_cents,
        returned_cents: auth.authorized_cents - amount_cents,
        category: merchant?.category,
      },
    })

    // Legacy redemptions row, kept so the admin table and settlement history
    // stay continuous across the ledger migration.
    await admin.from('redemptions').insert({
      card_id: auth.card_id,
      merchant_id: auth.merchant_id,
      amount_cents,
      status: 'succeeded',
      idempotency_key: `capture:${auth.id}`,
      nonce: auth.id,
    })

    const { data: after } = await admin
      .from('cards')
      .select('balance_cents')
      .eq('id', auth.card_id)
      .single()

    return NextResponse.json({
      captured: true,
      captured_cents: amount_cents,
      returned_cents: auth.authorized_cents - amount_cents,
      new_balance_cents: after?.balance_cents ?? 0,
    })
  } catch (err) {
    console.error('Capture error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
