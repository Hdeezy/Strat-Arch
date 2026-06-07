import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  const stripe = getStripe()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Webhook error: ${message}` }, { status: 400 })
  }

  const admin = createAdminClient()

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent
      const { card_id, donor_user_id, donor_email, amount_cents, allowed_categories, donor_note, receipt_requested } = intent.metadata

      if (!card_id || !amount_cents) break

      const amountCents = parseInt(amount_cents, 10)
      const parsedCategories = allowed_categories ? allowed_categories.split(',') : null

      // Create donation record
      const { error: donationError } = await admin.from('donations').insert({
        card_id,
        donor_user_id: donor_user_id || null,
        donor_email: donor_email || null,
        amount_cents: amountCents,
        stripe_payment_intent_id: intent.id,
        stripe_receipt_url: intent.latest_charge
          ? `https://dashboard.stripe.com/payments/${intent.latest_charge}`
          : null,
        donor_note: donor_note || null,
        receipt_requested: receipt_requested === 'true',
      })

      if (donationError) {
        console.error('Failed to create donation record:', donationError)
        break
      }

      // Load card: add balance and set state to active
      const { data: card } = await admin
        .from('cards')
        .select('balance_cents, state, allowed_categories')
        .eq('id', card_id)
        .single()

      if (!card) break

      const { error: updateError } = await admin
        .from('cards')
        .update({
          balance_cents: card.balance_cents + amountCents,
          state: 'active',
          ...(parsedCategories ? { allowed_categories: parsedCategories } : {}),
        })
        .eq('id', card_id)

      if (updateError) {
        console.error('Failed to update card balance:', updateError)
        break
      }

      // Log event
      await admin.from('card_events').insert({
        card_id,
        event_type: 'loaded',
        actor_type: 'donor',
        actor_ref: donor_user_id || donor_email || 'anonymous',
        metadata: {
          amount_cents: amountCents,
          stripe_payment_intent_id: intent.id,
          donor_note: donor_note || null,
        },
      })

      break
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent
      console.error('Payment failed for intent:', intent.id)
      break
    }

    default:
      break
  }

  return NextResponse.json({ received: true })
}
