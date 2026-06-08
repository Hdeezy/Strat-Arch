// Mock the supabase admin client
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}))

jest.mock('@/lib/qr', () => ({
  verifyCardPayload: jest.fn(),
}))

import { attemptRedemption } from '@/lib/redemption'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCardPayload } from '@/lib/qr'

const mockVerify = verifyCardPayload as jest.MockedFunction<typeof verifyCardPayload>

const MOCK_PAYLOAD = {
  card_id: 'card-uuid-1234',
  card_code: 'HMLT-0001',
  city_id: 'city-uuid',
  charity_id: 'charity-uuid',
  nonce: 'nonce-abc-123',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 300,
}

// Use a union type for state so spread overrides (state: 'invalidated', etc.) are valid
const MOCK_CARD = {
  id: 'card-uuid-1234',
  card_code: 'HMLT-0001',
  city_id: 'city-uuid',
  charity_id: 'charity-uuid',
  state: 'active' as 'active' | 'unloaded' | 'invalidated' | 'exhausted' | 'expired',
  balance_cents: 2000,
  allowed_categories: ['food', 'transit', 'clothing', 'hygiene'],
  daily_cap_cents: 2000,
  spent_today_cents: 0,
  last_spent_reset_at: new Date().toISOString(),
  signed_payload: null,
  created_at: new Date().toISOString(),
}

const MOCK_MERCHANT = {
  id: 'merchant-uuid',
  name: '541 Eatery',
  category: 'food',
  city_id: 'city-uuid',
  charity_id: 'charity-uuid',
  address: '541 Barton St E',
  lat: 43.2557,
  lng: -79.8415,
  stripe_connect_account_id: null,
  payout_schedule_days: 7,
  is_active: true,
  trust_score: 0.5,
  created_at: new Date().toISOString(),
}

function buildMockAdmin(overrides: {
  nonce?: { data: null | { nonce: string }; error: null }
  card?: { data: typeof MOCK_CARD | null; error: null | { message: string } }
  merchant?: { data: typeof MOCK_MERCHANT | null; error: null | { message: string } }
  redemptionInsert?: { error: null | { code: string; message: string } }
  redemptionSelect?: { data: { id: string; status: string; amount_cents: number } | null }
  cardUpdate?: { error: null | { message: string } }
  redemptionUpdate?: { error: null }
  cardEventsInsert?: { error: null }
  donationSelect?: { data: null }
} = {}) {
  const selectFn = jest.fn().mockImplementation(() => ({
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(overrides.nonce ?? { data: null, error: null }),
  }))

  const fromFn = jest.fn().mockImplementation(function(table: string) {
    if (table === 'used_nonces') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue(overrides.nonce ?? { data: null, error: null }),
          }),
        }),
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
    }
    if (table === 'cards') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue(overrides.card ?? { data: MOCK_CARD, error: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue(overrides.cardUpdate ?? { error: null }),
        }),
      }
    }
    if (table === 'merchants') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue(overrides.merchant ?? { data: MOCK_MERCHANT, error: null }),
          }),
        }),
      }
    }
    if (table === 'redemptions') {
      const insertMock = jest.fn().mockResolvedValue(overrides.redemptionInsert ?? { error: null })
      return {
        insert: insertMock,
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue(overrides.redemptionUpdate ?? { error: null }),
        }),
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue(overrides.redemptionSelect ?? { data: null }),
          }),
        }),
      }
    }
    if (table === 'card_events') {
      return { insert: jest.fn().mockResolvedValue({ error: null }) }
    }
    if (table === 'donations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue(overrides.donationSelect ?? { data: null }),
                }),
              }),
            }),
          }),
        }),
      }
    }
    return { select: selectFn, insert: jest.fn(), update: jest.fn() }
  })

  return { from: fromFn }
}

describe('Redemption idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.HOPE_QR_SIGNING_SECRET = 'test-secret-long-enough-for-hmac-sha256-algo'
  })

  it('succeeds on a valid first redemption', async () => {
    mockVerify.mockResolvedValue(MOCK_PAYLOAD);
    (createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin())

    const result = await attemptRedemption({
      token: 'valid.jwt.token',
      merchant_id: 'merchant-uuid',
      amount_cents: 850,
      idempotency_key: 'unique-key-001',
    })

    expect(result.success).toBe(true)
    expect(result.new_balance_cents).toBe(1150) // 2000 - 850
  })

  it('returns existing redemption data on duplicate idempotency key', async () => {
    mockVerify.mockResolvedValue(MOCK_PAYLOAD)
    const existingRedemption = { id: 'existing-redemption-id', status: 'succeeded', amount_cents: 850 }

    ;(createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin({
      redemptionInsert: { error: { code: '23505', message: 'duplicate key' } },
      redemptionSelect: { data: existingRedemption },
    }))

    const result = await attemptRedemption({
      token: 'valid.jwt.token',
      merchant_id: 'merchant-uuid',
      amount_cents: 850,
      idempotency_key: 'duplicate-key-001',
    })

    expect(result.success).toBe(true)
    expect(result.redemption_id).toBe('existing-redemption-id')
  })

  it('rejects a replayed nonce', async () => {
    mockVerify.mockResolvedValue(MOCK_PAYLOAD);
    (createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin({
      nonce: { data: { nonce: 'nonce-abc-123' }, error: null },
    }))

    const result = await attemptRedemption({
      token: 'valid.jwt.token',
      merchant_id: 'merchant-uuid',
      amount_cents: 850,
      idempotency_key: 'unique-key-002',
    })

    expect(result.success).toBe(false)
    expect(result.failure_reason).toBe('nonce_replayed')
  })

  it('rejects an invalidated card', async () => {
    mockVerify.mockResolvedValue(MOCK_PAYLOAD);
    (createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin({
      card: { data: { ...MOCK_CARD, state: 'invalidated' }, error: null },
    }))

    const result = await attemptRedemption({
      token: 'valid.jwt.token',
      merchant_id: 'merchant-uuid',
      amount_cents: 850,
      idempotency_key: 'unique-key-003',
    })

    expect(result.success).toBe(false)
    expect(result.failure_reason).toBe('card_invalidated')
  })

  it('rejects when amount exceeds balance', async () => {
    mockVerify.mockResolvedValue(MOCK_PAYLOAD);
    (createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin({
      card: { data: { ...MOCK_CARD, balance_cents: 500 }, error: null },
    }))

    const result = await attemptRedemption({
      token: 'valid.jwt.token',
      merchant_id: 'merchant-uuid',
      amount_cents: 850,
      idempotency_key: 'unique-key-004',
    })

    expect(result.success).toBe(false)
    expect(result.failure_reason).toBe('insufficient_balance')
  })

  it('rejects category mismatch', async () => {
    mockVerify.mockResolvedValue(MOCK_PAYLOAD);
    (createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin({
      card: { data: { ...MOCK_CARD, allowed_categories: ['transit'] }, error: null },
      merchant: { data: { ...MOCK_MERCHANT, category: 'food' }, error: null },
    }))

    const result = await attemptRedemption({
      token: 'valid.jwt.token',
      merchant_id: 'merchant-uuid',
      amount_cents: 850,
      idempotency_key: 'unique-key-005',
    })

    expect(result.success).toBe(false)
    expect(result.failure_reason).toBe('category_not_allowed')
  })

  it('rejects when daily cap is exceeded', async () => {
    mockVerify.mockResolvedValue(MOCK_PAYLOAD);
    (createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin({
      card: { data: { ...MOCK_CARD, daily_cap_cents: 2000, spent_today_cents: 1800, balance_cents: 5000 }, error: null },
    }))

    const result = await attemptRedemption({
      token: 'valid.jwt.token',
      merchant_id: 'merchant-uuid',
      amount_cents: 500, // 1800 + 500 = 2300 > 2000 daily cap
      idempotency_key: 'unique-key-006',
    })

    expect(result.success).toBe(false)
    expect(result.failure_reason).toBe('daily_cap_reached')
  })

  it('rejects an unloaded card', async () => {
    mockVerify.mockResolvedValue(MOCK_PAYLOAD);
    (createAdminClient as jest.Mock).mockReturnValue(buildMockAdmin({
      card: { data: { ...MOCK_CARD, state: 'unloaded' }, error: null },
    }))

    const result = await attemptRedemption({
      token: 'valid.jwt.token',
      merchant_id: 'merchant-uuid',
      amount_cents: 100,
      idempotency_key: 'unique-key-007',
    })

    expect(result.success).toBe(false)
    expect(result.failure_reason).toBe('card_not_active')
  })
})
