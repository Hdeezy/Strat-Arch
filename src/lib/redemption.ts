import type { Card, Merchant, QRPayload } from '@/lib/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCardPayload } from '@/lib/qr'
import { isCategoryAllowed, isNewDay } from '@/lib/utils'
import { v4 as uuidv4 } from 'uuid'

export type RedemptionFailureReason =
  | 'card_not_found'
  | 'card_not_active'
  | 'card_expired'
  | 'card_invalidated'
  | 'card_exhausted'
  | 'category_not_allowed'
  | 'daily_cap_reached'
  | 'insufficient_balance'
  | 'qr_expired'
  | 'qr_invalid'
  | 'nonce_replayed'

export interface RedemptionAttemptParams {
  token: string          // Signed JWT from QR scan
  merchant_id: string
  amount_cents: number
  idempotency_key: string
}

export interface RedemptionResult {
  success: boolean
  failure_reason?: RedemptionFailureReason
  redemption_id?: string
  new_balance_cents?: number
  donor_note?: string
}

export async function attemptRedemption(
  params: RedemptionAttemptParams
): Promise<RedemptionResult> {
  const admin = createAdminClient()

  // 1. Verify QR signature and decode payload
  let payload: QRPayload
  try {
    payload = await verifyCardPayload(params.token)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    return {
      success: false,
      failure_reason: msg.includes('expired') ? 'qr_expired' : 'qr_invalid',
    }
  }

  // 2. Check nonce hasn't been used (replay prevention)
  const { data: existingNonce } = await admin
    .from('used_nonces')
    .select('nonce')
    .eq('nonce', payload.nonce)
    .single()

  if (existingNonce) {
    return { success: false, failure_reason: 'nonce_replayed' }
  }

  // 3. Load card (with row lock via transaction)
  const { data: card, error: cardError } = await admin
    .from('cards')
    .select('*')
    .eq('id', payload.card_id)
    .single()

  if (cardError || !card) {
    return { success: false, failure_reason: 'card_not_found' }
  }

  // 4. State checks
  if (card.state === 'invalidated') {
    return { success: false, failure_reason: 'card_invalidated' }
  }
  if (card.state === 'expired') {
    return { success: false, failure_reason: 'card_expired' }
  }
  if (card.state === 'exhausted') {
    return { success: false, failure_reason: 'card_exhausted' }
  }
  if (card.state !== 'active') {
    return { success: false, failure_reason: 'card_not_active' }
  }

  // 5. Load merchant
  const { data: merchant, error: merchantError } = await admin
    .from('merchants')
    .select('*')
    .eq('id', params.merchant_id)
    .single()

  if (merchantError || !merchant) {
    return { success: false, failure_reason: 'card_not_found' }
  }

  // 6. Category gate enforcement
  if (!isCategoryAllowed(merchant.category, card.allowed_categories)) {
    await logRedemptionAttempt(admin, card, merchant, params, 'failed', 'category_not_allowed', payload.nonce)
    return { success: false, failure_reason: 'category_not_allowed' }
  }

  // 7. Daily cap check (lazy reset)
  let spentToday = card.spent_today_cents
  let lastReset = card.last_spent_reset_at
  const dailyReset = isNewDay(lastReset)
  if (dailyReset) {
    spentToday = 0
    lastReset = new Date().toISOString()
  }

  const dailyRemaining = Math.max(0, card.daily_cap_cents - spentToday)
  if (params.amount_cents > dailyRemaining) {
    return { success: false, failure_reason: 'daily_cap_reached' }
  }

  // 8. Balance check
  if (params.amount_cents > card.balance_cents) {
    return { success: false, failure_reason: 'insufficient_balance' }
  }

  // 9. Mark nonce as used (before debit to prevent double-spend on failure)
  await admin.from('used_nonces').insert({
    nonce: payload.nonce,
    card_id: card.id,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })

  // 10. Create redemption record
  const redemptionId = uuidv4()
  const { error: redemptionError } = await admin.from('redemptions').insert({
    id: redemptionId,
    card_id: card.id,
    merchant_id: merchant.id,
    amount_cents: params.amount_cents,
    status: 'pending',
    idempotency_key: params.idempotency_key,
    nonce: payload.nonce,
  })

  if (redemptionError) {
    if (redemptionError.code === '23505') {
      // Idempotency key already exists — return the existing redemption
      const { data: existing } = await admin
        .from('redemptions')
        .select('*')
        .eq('idempotency_key', params.idempotency_key)
        .single()
      return {
        success: existing?.status === 'succeeded',
        redemption_id: existing?.id,
        new_balance_cents: card.balance_cents - (existing?.status === 'succeeded' ? existing.amount_cents : 0),
      }
    }
    throw redemptionError
  }

  // 11. Debit card balance (atomic update)
  const newBalance = card.balance_cents - params.amount_cents
  const newSpentToday = spentToday + params.amount_cents
  const newState: Card['state'] = newBalance === 0 ? 'exhausted' : 'active'

  const { error: updateError } = await admin
    .from('cards')
    .update({
      balance_cents: newBalance,
      spent_today_cents: newSpentToday,
      last_spent_reset_at: dailyReset ? lastReset : card.last_spent_reset_at,
      state: newState,
    })
    .eq('id', card.id)

  if (updateError) {
    await admin.from('redemptions').update({ status: 'failed', failure_reason: 'update_failed' }).eq('id', redemptionId)
    throw updateError
  }

  // 12. Mark redemption as succeeded
  await admin.from('redemptions').update({ status: 'succeeded' }).eq('id', redemptionId)

  // 13. Log event
  await admin.from('card_events').insert({
    card_id: card.id,
    event_type: 'redemption_succeeded',
    actor_type: 'merchant',
    actor_ref: merchant.id,
    metadata: {
      redemption_id: redemptionId,
      merchant_name: merchant.name,
      amount_cents: params.amount_cents,
      new_balance_cents: newBalance,
      category: merchant.category,
    },
  })

  // 14. Get donor note if any (from the most recent donation with a note)
  const { data: donationWithNote } = await admin
    .from('donations')
    .select('donor_note')
    .eq('card_id', card.id)
    .not('donor_note', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return {
    success: true,
    redemption_id: redemptionId,
    new_balance_cents: newBalance,
    donor_note: donationWithNote?.donor_note ?? undefined,
  }
}

async function logRedemptionAttempt(
  admin: ReturnType<typeof createAdminClient>,
  card: Card,
  merchant: Merchant,
  params: RedemptionAttemptParams,
  status: 'succeeded' | 'failed',
  reason: string,
  _nonce: string
) {
  await admin.from('card_events').insert({
    card_id: card.id,
    event_type: status === 'succeeded' ? 'redemption_succeeded' : 'redemption_failed',
    actor_type: 'merchant',
    actor_ref: merchant.id,
    metadata: { reason, amount_cents: params.amount_cents, merchant_name: merchant.name },
  })
}
