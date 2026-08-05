/**
 * VOID — release an authorization unspent.
 *
 * The sale fell through, the member changed their mind, the vendor hit
 * cancel. The held value goes straight back to the card.
 *
 * The expiry cron calls the same ledger path for authorizations nobody
 * closed, so a vendor who opens a hold and then closes their phone cannot
 * leave a card quietly unusable.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { voidAuthorization } from '@/ledger'
import { z } from 'zod'

const schema = z.object({
  authorization_id: z.string().uuid(),
  reason: z.string().max(200).default('Cancelled at the counter'),
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

    const { data: auth } = await admin
      .from('authorizations')
      .select('id, card_id, merchant_id, authorized_cents, status')
      .eq('id', parsed.data.authorization_id)
      .maybeSingle()

    if (!auth) return NextResponse.json({ voided: false, reason: 'not_found' }, { status: 404 })
    if (auth.merchant_id !== staff.merchant_id) {
      return NextResponse.json({ voided: false, reason: 'wrong_merchant' }, { status: 403 })
    }
    if (auth.status !== 'open') {
      return NextResponse.json({ voided: true, replayed: true, status: auth.status })
    }

    await voidAuthorization({
      authorizationId: auth.id,
      cardId: auth.card_id,
      amountCents: auth.authorized_cents,
      reason: parsed.data.reason,
    })

    await admin
      .from('authorizations')
      .update({ status: 'voided', closed_at: new Date().toISOString() })
      .eq('id', auth.id)

    const { data: card } = await admin
      .from('cards')
      .select('balance_cents')
      .eq('id', auth.card_id)
      .single()

    return NextResponse.json({ voided: true, new_balance_cents: card?.balance_cents ?? 0 })
  } catch (err) {
    console.error('Void error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
