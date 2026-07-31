/**
 * STRIPE WEBHOOK — the only way money enters the system.
 *
 * Scrappy Cut §2.4: guest checkout, pooled lane, the Foundation's OWN Stripe
 * account (not Connect), webhook-confirmed, 72h clearance hold on anonymous
 * gifts.
 *
 * A donation does NOT put value on a card. It puts value into clearance.
 * The clearance cron releases it to the pooled float, and cards are
 * activated from that float. The point of the indirection: a chargeback
 * three days later lands on the pool, not on a person standing at a counter
 * with a card that just went dead.
 *
 * This is one of the two paths the Scrappy Cut §7 says to buy senior review
 * for. Signature verification, idempotency, and chargeback reversal are all
 * here.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordDonation, reverseDonation } from '@/ledger'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 })

  const stripe = getStripe()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Webhook error: ${message}` }, { status: 400 })
  }

  const admin = createAdminClient()

  try {
    switch (event.type) {
      // ── Money in ─────────────────────────────────────────────────────────
      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent
        const md = intent.metadata
        const amountCents = parseInt(md.amount_cents ?? '0', 10)
        if (!md.card_id || !amountCents) break

        const isAnonymous = !md.donor_user_id

        // Idempotent on the payment intent: Stripe retries, and a retry must
        // not create a second donation.
        const { data: existing } = await admin
          .from('donations')
          .select('id')
          .eq('stripe_payment_intent_id', intent.id)
          .maybeSingle()

        if (existing) break

        const { data: donation, error: donationError } = await admin
          .from('donations')
          .insert({
            card_id: md.card_id,
            donor_user_id: md.donor_user_id || null,
            donor_email: md.donor_email || null,
            amount_cents: amountCents,
            stripe_payment_intent_id: intent.id,
            stripe_receipt_url: intent.latest_charge
              ? `https://dashboard.stripe.com/payments/${intent.latest_charge}`
              : null,
            donor_note: md.donor_note || null,
            receipt_requested: md.receipt_requested === 'true',
            is_anonymous: isAnonymous,
            // Identified donors clear immediately; anonymous gifts serve the
            // full 72 hours.
            clearance_due_at: isAnonymous
              ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
              : new Date().toISOString(),
          })
          .select('id')
          .single()

        if (donationError || !donation) {
          console.error('Failed to record donation:', donationError)
          break
        }

        await recordDonation({
          paymentIntentId: intent.id,
          amountCents,
          donationId: donation.id,
        })

        // The donor chose which categories this card may be spent in. That is
        // card CONFIGURATION, not money, so it is written here rather than
        // through the ledger — and it must still be written, or the donor's
        // choice is silently discarded.
        //
        // Balance and state are deliberately NOT set here. Value becomes
        // spendable through card_activation against the cleared float, which
        // is the whole point of the clearance hold.
        const categories = md.allowed_categories
          ? md.allowed_categories.split(',').filter(Boolean)
          : null

        if (categories && categories.length > 0) {
          await admin
            .from('cards')
            .update({ allowed_categories: categories })
            .eq('id', md.card_id)
        }

        await admin.from('card_events').insert({
          card_id: md.card_id,
          event_type: 'loaded',
          actor_type: 'donor',
          actor_ref: md.donor_user_id || md.donor_email || 'anonymous',
          metadata: {
            amount_cents: amountCents,
            donation_id: donation.id,
            clearance: isAnonymous ? '72h' : 'immediate',
          },
        })
        break
      }

      // ── Money back out ───────────────────────────────────────────────────
      // The pool absorbs it. The card keeps its value. A person does not lose
      // their groceries because a donor's bank reversed a charge.
      case 'charge.dispute.created':
      case 'charge.refunded': {
        const obj = event.data.object as Stripe.Dispute | Stripe.Charge
        const paymentIntentId =
          typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id
        if (!paymentIntentId) break

        const { data: donation } = await admin
          .from('donations')
          .select('id, amount_cents, cleared_at, reversed_at')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .maybeSingle()

        if (!donation || donation.reversed_at) break

        await reverseDonation({
          donationId: donation.id,
          amountCents: donation.amount_cents,
          reversalRef: event.id,
          wasCleared: donation.cleared_at !== null,
        })

        console.warn(
          `[LEDGER] Donation ${donation.id} reversed via ${event.type}. ` +
          `Absorbed by ${donation.cleared_at ? 'card_float' : 'donor_clearing'}.`
        )
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
  } catch (err) {
    // Return 500 so Stripe retries. Every path above is idempotent, so a
    // retry is safe.
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
