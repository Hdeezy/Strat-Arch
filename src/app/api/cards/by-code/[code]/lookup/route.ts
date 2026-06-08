import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signCardPayload } from '@/lib/qr'
import { normalizeCardCode } from '@/lib/utils'

export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const code = normalizeCardCode(params.code)
    const admin = createAdminClient()

    const { data: card, error } = await admin
      .from('cards')
      .select('id, card_code, city_id, charity_id, state, balance_cents, allowed_categories, daily_cap_cents, spent_today_cents, last_spent_reset_at')
      .eq('card_code', code)
      .single()

    if (error || !card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    // Generate fresh signed JWT for live transaction use
    const token = await signCardPayload(card.id, card.card_code, card.city_id, card.charity_id)

    // Update signed_payload on card
    await admin.from('cards').update({ signed_payload: token }).eq('id', card.id)

    return NextResponse.json({ card, token })
  } catch (err) {
    console.error('Card lookup error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
