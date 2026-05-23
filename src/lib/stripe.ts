import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
    _stripe = new Stripe(key, { apiVersion: '2024-06-20' })
  }
  return _stripe
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(cents / 100)
}

// Build idempotency key for a redemption attempt
export function buildIdempotencyKey(card_id: string, merchant_id: string, amount_cents: number, nonce: string): string {
  return `redeem:${card_id}:${merchant_id}:${amount_cents}:${nonce}`
}
