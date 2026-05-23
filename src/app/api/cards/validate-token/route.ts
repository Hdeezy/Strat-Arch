import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCardPayload } from '@/lib/qr'
import { getDailyCapRemaining, isCategoryAllowed } from '@/lib/utils'
import { z } from 'zod'

const schema = z.object({ token: z.string().min(1) })

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const admin = createAdminClient()
    const { data: staffRecord } = await admin
      .from('merchant_staff')
      .select('merchant_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!staffRecord) return NextResponse.json({ error: 'Not authorized as merchant staff' }, { status: 403 })

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const { token } = parsed.data

    // Verify signature
    let payload
    try {
      payload = await verifyCardPayload(token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      return NextResponse.json({
        valid: false,
        failure_reason: msg.includes('expired') ? 'qr_expired' : 'qr_invalid',
      })
    }

    // Load card
    const { data: card } = await admin
      .from('cards')
      .select('*')
      .eq('id', payload.card_id)
      .single()

    if (!card) return NextResponse.json({ valid: false, failure_reason: 'card_not_found' })

    if (card.state !== 'active') {
      return NextResponse.json({ valid: false, failure_reason: `card_${card.state}` })
    }

    // Load merchant to check category
    const { data: merchant } = await admin
      .from('merchants')
      .select('category')
      .eq('id', staffRecord.merchant_id)
      .single()

    if (!merchant) return NextResponse.json({ valid: false, failure_reason: 'merchant_not_found' })

    if (!isCategoryAllowed(merchant.category, card.allowed_categories)) {
      return NextResponse.json({ valid: false, failure_reason: 'category_not_allowed' })
    }

    const dailyRemaining = getDailyCapRemaining(card)

    return NextResponse.json({
      valid: true,
      card: {
        id: card.id,
        card_code: card.card_code,
        balance_cents: card.balance_cents,
        allowed_categories: card.allowed_categories,
        state: card.state,
      },
      daily_remaining: dailyRemaining,
    })
  } catch (err) {
    console.error('Validate token error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
