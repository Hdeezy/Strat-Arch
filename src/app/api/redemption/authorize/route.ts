/**
 * AUTHORIZE — phase one of the two-phase redemption.
 *
 * The vendor scans, and this reserves the room available on the card. The
 * value leaves the card's spendable balance immediately, so a second
 * terminal cannot authorize the same money. Nothing is owed to the vendor
 * yet.
 *
 * The response carries room_cents. That is the only spend figure the vendor
 * UI shows, and there is no "insufficient funds" path — see roomToday().
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredential } from '@/credentials'
import { holdAuthorization } from '@/ledger'
import { roomToday, isCategoryAllowed } from '@/lib/utils'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

const schema = z.object({
  credential: z.string().min(1),
  idempotency_key: z.string().uuid().optional(),
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

    const resolution = await resolveCredential(parsed.data.credential)
    if (!resolution.ok) {
      return NextResponse.json({ authorized: false, reason: resolution.failure }, { status: 200 })
    }

    const { card_id, card_code, credential_kind } = resolution.credential

    const { data: card } = await admin
      .from('cards')
      .select('id, state, balance_cents, allowed_categories, daily_cap_cents, spent_today_cents, last_spent_reset_at')
      .eq('id', card_id)
      .single()

    if (!card) return NextResponse.json({ authorized: false, reason: 'not_found' }, { status: 200 })

    if (card.state !== 'active') {
      return NextResponse.json({ authorized: false, reason: `card_${card.state}` }, { status: 200 })
    }

    const { data: merchant } = await admin
      .from('merchants')
      .select('id, name, category')
      .eq('id', staff.merchant_id)
      .single()

    if (!merchant) {
      return NextResponse.json({ authorized: false, reason: 'merchant_not_found' }, { status: 200 })
    }

    // The category gate is a genuine decline: this card is not valid here at
    // all, and no amount would work. That is different from having no room,
    // which is a number, not a refusal.
    if (!isCategoryAllowed(merchant.category, card.allowed_categories)) {
      return NextResponse.json({ authorized: false, reason: 'category_not_allowed' }, { status: 200 })
    }

    const room = roomToday(card)
    if (room <= 0) {
      // Still not a decline of the person. The card has no room *today*, and
      // the UI says exactly that, along with when it resets.
      return NextResponse.json({ authorized: false, reason: 'no_room_today', room_cents: 0 }, { status: 200 })
    }

    // Reserve the whole room. The vendor captures what they actually ring,
    // and the remainder returns to the card in the same transaction.
    const authorizationId = uuidv4()
    const idempotencyKey = parsed.data.idempotency_key ?? authorizationId

    const { error: authError } = await admin.from('authorizations').insert({
      id: authorizationId,
      card_id,
      merchant_id: merchant.id,
      authorized_cents: room,
      credential_kind,
      nonce: resolution.credential.nonce ?? authorizationId,
      idempotency_key: idempotencyKey,
    })

    if (authError) {
      if (authError.code === '23505') {
        const { data: existing } = await admin
          .from('authorizations')
          .select('id, authorized_cents')
          .eq('idempotency_key', idempotencyKey)
          .single()
        return NextResponse.json({
          authorized: true,
          authorization_id: existing?.id,
          card_code,
          room_cents: existing?.authorized_cents ?? room,
          replayed: true,
        })
      }
      throw authError
    }

    await holdAuthorization({ authorizationId, cardId: card_id, amountCents: room })

    await admin.from('card_events').insert({
      card_id,
      event_type: 'redemption_attempted',
      actor_type: 'merchant',
      actor_ref: merchant.id,
      metadata: { authorization_id: authorizationId, authorized_cents: room },
    })

    return NextResponse.json({
      authorized: true,
      authorization_id: authorizationId,
      card_code,
      room_cents: room,
      allowed_categories: card.allowed_categories,
      expires_in_seconds: 15 * 60,
    })
  } catch (err) {
    console.error('Authorize error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
