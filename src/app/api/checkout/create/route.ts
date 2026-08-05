import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schema = z.object({
  card_id: z.string().uuid(),
  amount_cents: z.number().int().min(500).max(50000),
  allowed_categories: z.array(z.enum(['food', 'transit', 'clothing', 'hygiene', 'shelter', 'multi'])).min(1),
  donor_note: z.string().max(140).optional(),
  receipt_requested: z.boolean().default(false),
  donor_email: z.string().email().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const { card_id, amount_cents, allowed_categories, donor_note, receipt_requested, donor_email } = parsed.data

    // Validate card exists and is in valid state for loading
    const admin = createAdminClient()
    const { data: card, error: cardError } = await admin
      .from('cards')
      .select('id, card_code, state, city_id, charity_id')
      .eq('id', card_id)
      .single()

    if (cardError || !card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    if (card.state === 'invalidated' || card.state === 'expired') {
      return NextResponse.json({ error: `Card is ${card.state} and cannot be loaded` }, { status: 400 })
    }

    // Get current user (optional — anonymous is allowed)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const stripe = getStripe()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: `HOPE Card — ${card.card_code}`,
              description: `Closed-loop voucher for essentials in Hamilton, Ontario. Categories: ${allowed_categories.join(', ')}.`,
            },
            unit_amount: amount_cents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${appUrl}/donate/success?session_id={CHECKOUT_SESSION_ID}&card_id=${card_id}`,
      cancel_url: `${appUrl}/donate/${card.card_code}`,
      customer_email: donor_email || user?.email || undefined,
      metadata: {
        card_id,
        donor_user_id: user?.id || '',
        donor_email: donor_email || user?.email || '',
        amount_cents: amount_cents.toString(),
        allowed_categories: allowed_categories.join(','),
        donor_note: donor_note || '',
        receipt_requested: receipt_requested.toString(),
      },
      payment_intent_data: {
        metadata: {
          card_id,
          donor_user_id: user?.id || '',
          donor_email: donor_email || user?.email || '',
          amount_cents: amount_cents.toString(),
          allowed_categories: allowed_categories.join(','),
          donor_note: donor_note || '',
          receipt_requested: receipt_requested.toString(),
        },
      },
    })

    return NextResponse.json({ url: session.url, session_id: session.id })
  } catch (err) {
    console.error('Checkout create error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
