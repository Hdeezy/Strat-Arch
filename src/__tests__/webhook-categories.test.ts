/**
 * Stripe webhook contract, after the ledger migration.
 *
 * Two things changed and both are asserted here:
 *
 *   1. The donor's allowed_categories are still written to the card. That is
 *      card configuration, not money, and dropping it would silently discard
 *      the donor's choice.
 *
 *   2. The webhook NO LONGER writes balance_cents or state. Value enters
 *      through the ledger and becomes spendable via card_activation against
 *      the cleared float. A webhook that credited the card directly would
 *      bypass the clearance hold, which is the control that keeps a
 *      chargeback off a card in someone's pocket.
 */

jest.mock('@/lib/stripe', () => ({ getStripe: jest.fn() }))
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }))
jest.mock('@/ledger', () => ({
  recordDonation: jest.fn().mockResolvedValue('txn-uuid'),
  reverseDonation: jest.fn().mockResolvedValue('txn-uuid'),
}))

import { POST } from '@/app/api/stripe/webhook/route'
import { NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordDonation } from '@/ledger'

function buildRequest(sig = 'test-sig'): NextRequest {
  return new NextRequest('http://localhost:3000/api/stripe/webhook', {
    method: 'POST',
    body: 'raw-body',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
  })
}

/**
 * @param existingDonation simulate a Stripe retry for a payment intent we
 *        have already recorded, which must be a no-op.
 */
function buildMockAdmin(cardUpdate: jest.Mock, existingDonation: { id: string } | null = null) {
  return {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'donations') {
        return {
          // idempotency lookup
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: existingDonation, error: null }),
            }),
          }),
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'donation-uuid' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'cards') return { update: cardUpdate }
      if (table === 'card_events') return { insert: jest.fn().mockResolvedValue({ error: null }) }
      return {}
    }),
  }
}

function mockStripeEvent(metadata: Record<string, string>) {
  ;(getStripe as jest.Mock).mockReturnValue({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        id: `evt_${Math.random().toString(36).slice(2)}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: `pi_test_${Math.random().toString(36).slice(2)}`,
            latest_charge: null,
            metadata,
          },
        },
      }),
    },
  })
}

function freshUpdate() {
  return jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })
}

const BASE_METADATA = {
  donor_note: '',
  receipt_requested: 'false',
  donor_user_id: '',
  donor_email: '',
}

describe('Stripe webhook — card configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
  })

  it('writes allowed_categories to the card when present in metadata', async () => {
    const update = freshUpdate()
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(update))
    mockStripeEvent({ ...BASE_METADATA, card_id: 'card-1', amount_cents: '1000', allowed_categories: 'food,transit,clothing' })

    const res = await POST(buildRequest())

    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_categories: ['food', 'transit', 'clothing'] })
    )
  })

  it('parses a single-category metadata value', async () => {
    const update = freshUpdate()
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(update))
    mockStripeEvent({ ...BASE_METADATA, card_id: 'card-2', amount_cents: '1500', allowed_categories: 'food' })

    await POST(buildRequest())

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ allowed_categories: ['food'] }))
  })

  it('parses all four default categories', async () => {
    const update = freshUpdate()
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(update))
    mockStripeEvent({ ...BASE_METADATA, card_id: 'card-3', amount_cents: '2000', allowed_categories: 'food,transit,clothing,hygiene' })

    await POST(buildRequest())

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_categories: ['food', 'transit', 'clothing', 'hygiene'] })
    )
  })

  it('does not touch the card at all when metadata carries no categories', async () => {
    const update = freshUpdate()
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(update))
    mockStripeEvent({ ...BASE_METADATA, card_id: 'card-4', amount_cents: '500' })

    await POST(buildRequest())

    expect(update).not.toHaveBeenCalled()
  })
})

describe('Stripe webhook — the clearance hold', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
  })

  it('NEVER writes balance_cents or state — value enters through the ledger', async () => {
    const update = freshUpdate()
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(update))
    mockStripeEvent({ ...BASE_METADATA, card_id: 'card-5', amount_cents: '1000', allowed_categories: 'food' })

    await POST(buildRequest())

    const payload = (update.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.balance_cents).toBeUndefined()
    expect(payload.state).toBeUndefined()
  })

  it('posts the donation to the ledger', async () => {
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(freshUpdate()))
    mockStripeEvent({ ...BASE_METADATA, card_id: 'card-6', amount_cents: '2500', allowed_categories: 'food' })

    await POST(buildRequest())

    expect(recordDonation).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 2500, donationId: 'donation-uuid' })
    )
  })

  it('is a no-op when the payment intent was already recorded (Stripe retry)', async () => {
    const update = freshUpdate()
    ;(createAdminClient as jest.Mock).mockReturnValue(
      buildMockAdmin(update, { id: 'already-here' })
    )
    mockStripeEvent({ ...BASE_METADATA, card_id: 'card-7', amount_cents: '1000', allowed_categories: 'food' })

    const res = await POST(buildRequest())

    expect(res.status).toBe(200)
    expect(recordDonation).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('Stripe webhook — signature and unhandled events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
  })

  it('returns 400 when the stripe-signature header is missing', async () => {
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(freshUpdate()))
    ;(getStripe as jest.Mock).mockReturnValue({ webhooks: { constructEvent: jest.fn() } })

    const req = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      body: 'test',
    })

    expect((await POST(req)).status).toBe(400)
  })

  it('returns 200 and is a no-op for payment_intent.payment_failed', async () => {
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(freshUpdate()))
    ;(getStripe as jest.Mock).mockReturnValue({
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          id: 'evt_failed',
          type: 'payment_intent.payment_failed',
          data: { object: { id: 'pi_failed' } },
        }),
      },
    })

    const res = await POST(buildRequest())
    expect(res.status).toBe(200)
    expect(recordDonation).not.toHaveBeenCalled()
  })
})
