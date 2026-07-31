// Lightweight public card-lookup used by the advocate bulk-load page.
// Returns card metadata (no JWT token) — just enough to validate that a card
// code exists and is in a loadable state before adding it to a batch.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeCardCode } from '@/lib/utils'
import { auditLookup } from '@/lib/lookup-audit'

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const code = normalizeCardCode(params.code)
    const admin = createAdminClient()

    const { data: card, error } = await admin
      .from('cards')
      .select('id, card_code, state, balance_cents, allowed_categories, charity_id, city_id')
      .eq('card_code', code)
      .single()

    if (error || !card) {
      await auditLookup({ headers: req.headers, cardId: null, outcome: 'not_found', surface: 'lookup' })
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    await auditLookup({ headers: req.headers, cardId: card.id, outcome: 'found', surface: 'lookup' })

    return NextResponse.json({ card })
  } catch (err) {
    console.error('Card lookup error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
