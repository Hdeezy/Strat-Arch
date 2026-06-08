// Tests for the Bug-2 fix: allowed_categories from Stripe metadata are
// applied to the card's allowed_categories column on payment_intent.succeeded.

jest.mock('@/lib/stripe', () => ({
  getStripe: jest.fn(),
}))

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}))

import { POST } from '@/app/api/stripe/webhook/route'
import { NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── helpers ────────────────────────────────────────────────────────────────

function buildRequest(sig = 'test-sig'): NextRequest {
  return new NextRequest('http://localhost:3000/api/stripe/webhook', {
    method: 'POST',
    body: 'raw-body',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': sig,
    },
  })
}

function buildMockAdmin(capturedCardUpdate?: jest.Mock) {
  const updateFn =
    capturedCardUpdate ??
    jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })

  return {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'donations') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) }
      }
      if (table === 'cards') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { balance_cents: 0, state: 'unloaded', allowed_categories: ['food'] },
                error: null,
              }),
            }),
          }),
          update: updateFn,
        }
      }
      if (table === 'card_events') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) }
      }
      return {}
    }),
  }
}

function mockStripeEvent(metadata: Record<string, string>) {
  ;(getStripe as jest.Mock).mockReturnValue({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
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

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Stripe webhook — allowed_categories propagation (Bug 2 fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
  })

  it('writes allowed_categories to card when present in metadata', async () => {
    const capturedUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(capturedUpdate))
    mockStripeEvent({
      card_id: 'card-uuid-001',
      amount_cents: '1000',
      allowed_categories: 'food,transit,clothing',
      donor_note: '',
      receipt_requested: 'false',
      donor_user_id: '',
      donor_email: '',
    })

    const res = await POST(buildRequest())

    expect(res.status).toBe(200)
    expect(capturedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed_categories: ['food', 'transit', 'clothing'],
      })
    )
  })

  it('does NOT include allowed_categories in update when absent from metadata', async () => {
    const capturedUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(capturedUpdate))
    mockStripeEvent({
      card_id: 'card-uuid-002',
      amount_cents: '500',
      // no allowed_categories field
      donor_note: '',
      receipt_requested: 'false',
      donor_user_id: '',
      donor_email: '',
    })

    await POST(buildRequest())

    const updateArg = capturedUpdate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updateArg?.allowed_categories).toBeUndefined()
  })

  it('parses a single-category metadata value', async () => {
    const capturedUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(capturedUpdate))
    mockStripeEvent({
      card_id: 'card-uuid-003',
      amount_cents: '1500',
      allowed_categories: 'food',
      donor_note: '',
      receipt_requested: 'false',
      donor_user_id: '',
      donor_email: '',
    })

    await POST(buildRequest())

    expect(capturedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_categories: ['food'] })
    )
  })

  it('parses all four default categories from metadata', async () => {
    const capturedUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(capturedUpdate))
    mockStripeEvent({
      card_id: 'card-uuid-004',
      amount_cents: '2000',
      allowed_categories: 'food,transit,clothing,hygiene',
      donor_note: '',
      receipt_requested: 'false',
      donor_user_id: '',
      donor_email: '',
    })

    await POST(buildRequest())

    expect(capturedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed_categories: ['food', 'transit', 'clothing', 'hygiene'],
      })
    )
  })

  it('always includes balance_cents and state in the update payload', async () => {
    const capturedUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin(capturedUpdate))
    mockStripeEvent({
      card_id: 'card-uuid-005',
      amount_cents: '1000',
      allowed_categories: 'food',
      donor_note: '',
      receipt_requested: 'false',
      donor_user_id: '',
      donor_email: '',
    })

    await POST(buildRequest())

    expect(capturedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        balance_cents: 1000,    // 0 (existing) + 1000
        state: 'active',
      })
    )
  })

  it('returns 400 when stripe-signature header is missing', async () => {
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin())
    ;(getStripe as jest.Mock).mockReturnValue({
      webhooks: { constructEvent: jest.fn() },
    })

    const req = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      body: 'test',
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 and is a no-op for payment_intent.payment_failed', async () => {
    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin())
    ;(getStripe as jest.Mock).mockReturnValue({
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          type: 'payment_intent.payment_failed',
          data: { object: { id: 'pi_failed' } },
        }),
      },
    })

    const res = await POST(buildRequest())
    expect(res.status).toBe(200)
  })
})
