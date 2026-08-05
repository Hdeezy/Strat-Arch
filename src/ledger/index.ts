/**
 * THE LEDGER.
 *
 * This module is the only code in the system permitted to move value.
 * Nothing outside src/ledger/ may write to ledger_entries, ledger_accounts,
 * ledger_transactions, or cards.balance_cents. That rule is enforced three
 * ways: a lint rule (.eslintrc.json no-restricted-imports), database grants
 * (migration 006), and pgTAP invariant 3, which catches any projection that
 * has drifted from a replay of the entries.
 *
 * Sign convention, stated once: amount_cents is signed. Positive is a DEBIT,
 * negative is a CREDIT, and the entries of a transaction always sum to zero.
 * Read balances through ledger_balances or the helpers in ./accounts, which
 * flip the sign for credit-normal accounts so a balance is positive in its
 * own terms.
 *
 * Every worked example, including the failure cases, is in docs/LEDGER-SPEC.md.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { pooledAccount, cardAccount, vendorAccount, cardBalance } from './accounts'
import { idem } from './idempotency'

type Admin = ReturnType<typeof createAdminClient>

type LedgerTxnKind =
  | 'donation_received'
  | 'donation_cleared'
  | 'chargeback_reversal'
  | 'card_activation'
  | 'authorization_hold'
  | 'capture'
  | 'authorization_void'
  | 'invalidation_reclaim'
  | 'reissue'
  | 'settlement'
  | 'adjustment'

interface Entry {
  account_id: string
  amount_cents: number
}

/**
 * Post a balanced transaction. The single choke point — every function below
 * routes through here, and nothing else calls post_ledger_transaction.
 *
 * Returns the transaction id. If the idempotency key has been used before,
 * returns the ORIGINAL transaction id and posts nothing.
 */
async function post(
  admin: Admin,
  kind: LedgerTxnKind,
  idempotencyKey: string,
  entries: Entry[],
  opts: { externalRef?: string; memo?: string } = {}
): Promise<string> {
  const sum = entries.reduce((s, e) => s + e.amount_cents, 0)
  if (sum !== 0) {
    // Caught here as well as in the database so the stack trace names the
    // caller rather than surfacing at commit as a deferred constraint.
    throw new Error(
      `Ledger transaction ${kind} does not balance: entries sum to ${sum} (must be 0)`
    )
  }

  const { data, error } = await admin.rpc('post_ledger_transaction', {
    p_kind: kind,
    p_idempotency_key: idempotencyKey,
    p_entries: entries,
    p_external_ref: opts.externalRef ?? null,
    p_memo: opts.memo ?? null,
  })

  if (error) throw new Error(`Ledger post failed (${kind}): ${error.message}`)
  return data as string
}

// ═══════════════════════════════════════════════════════════════════════════
// DONATION LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cash arrived at Stripe and is held inside the clearance window.
 *
 *   DEBIT  cash_stripe     +amount   (an asset increased)
 *   CREDIT donor_clearing  -amount   (we owe this into the programme)
 *
 * The value is NOT yet spendable. Cards are activated from the cleared float,
 * never from an individual uncleared gift, so a chargeback lands on the pool
 * rather than on a person standing at a counter with a card that just died.
 */
export async function recordDonation(params: {
  paymentIntentId: string
  amountCents: number
  donationId: string
}): Promise<string> {
  const admin = createAdminClient()
  const [cash, clearing] = await Promise.all([
    pooledAccount(admin, 'cash_stripe'),
    pooledAccount(admin, 'donor_clearing'),
  ])

  return post(
    admin,
    'donation_received',
    idem.donationReceived(params.paymentIntentId),
    [
      { account_id: cash, amount_cents: params.amountCents },
      { account_id: clearing, amount_cents: -params.amountCents },
    ],
    { externalRef: params.paymentIntentId, memo: `Donation ${params.donationId}` }
  )
}

/**
 * The clearance window elapsed. Value joins the spendable float.
 *
 *   DEBIT  donor_clearing  +amount
 *   CREDIT card_float      -amount
 *
 * Driven by the clearance cron, not by a request.
 */
export async function clearDonation(params: {
  donationId: string
  amountCents: number
}): Promise<string> {
  const admin = createAdminClient()
  const [clearing, float] = await Promise.all([
    pooledAccount(admin, 'donor_clearing'),
    pooledAccount(admin, 'card_float'),
  ])

  const txnId = await post(
    admin,
    'donation_cleared',
    idem.donationCleared(params.donationId),
    [
      { account_id: clearing, amount_cents: params.amountCents },
      { account_id: float, amount_cents: -params.amountCents },
    ],
    { externalRef: params.donationId }
  )

  await admin
    .from('donations')
    .update({ cleared_at: new Date().toISOString() })
    .eq('id', params.donationId)

  return txnId
}

/**
 * The network reversed a donation.
 *
 * Which account absorbs the loss depends on where the value had reached:
 *
 *   still in clearance  →  DEBIT donor_clearing, CREDIT cash_stripe
 *   already cleared     →  DEBIT card_float,     CREDIT cash_stripe
 *
 * In the cleared case card_float may go negative, and that is correct: the
 * pool is carrying a loss and someone needs to know. Cards keep their value.
 * A person does not lose their groceries because a donor's bank reversed a
 * charge three days later.
 */
export async function reverseDonation(params: {
  donationId: string
  amountCents: number
  reversalRef: string
  wasCleared: boolean
}): Promise<string> {
  const admin = createAdminClient()
  const [cash, source] = await Promise.all([
    pooledAccount(admin, 'cash_stripe'),
    pooledAccount(admin, params.wasCleared ? 'card_float' : 'donor_clearing'),
  ])

  const txnId = await post(
    admin,
    'chargeback_reversal',
    idem.donationReversed(params.reversalRef),
    [
      { account_id: source, amount_cents: params.amountCents },
      { account_id: cash, amount_cents: -params.amountCents },
    ],
    {
      externalRef: params.reversalRef,
      memo: params.wasCleared
        ? 'Reversal absorbed by the float; card value untouched'
        : 'Reversal inside clearance; no programme value affected',
    }
  )

  await admin
    .from('donations')
    .update({ reversed_at: new Date().toISOString() })
    .eq('id', params.donationId)

  return txnId
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assign cleared float to a specific card. This is the moment a card becomes
 * spendable.
 *
 *   DEBIT  card_float  +amount
 *   CREDIT card        -amount
 *
 * post_ledger_transaction refreshes cards.balance_cents and moves the card to
 * 'active' in the same database transaction.
 */
export async function activateCard(params: {
  cardId: string
  amountCents: number
  fundingRef: string
}): Promise<string> {
  const admin = createAdminClient()
  const [float, card] = await Promise.all([
    pooledAccount(admin, 'card_float'),
    cardAccount(admin, params.cardId),
  ])

  return post(
    admin,
    'card_activation',
    idem.cardActivation(params.cardId, params.fundingRef),
    [
      { account_id: float, amount_cents: params.amountCents },
      { account_id: card, amount_cents: -params.amountCents },
    ],
    { externalRef: params.cardId }
  )
}

/**
 * A card was invalidated (lost, stolen, reported). Its remaining value is
 * reclaimed to a holding account so it can be reissued onto a replacement.
 *
 *   DEBIT  card       +remaining
 *   CREDIT reclaimed  -remaining
 */
export async function reclaimCard(params: { cardId: string }): Promise<string | null> {
  const admin = createAdminClient()
  const remaining = await cardBalance(admin, params.cardId)
  if (remaining <= 0) return null

  const [card, reclaimed] = await Promise.all([
    cardAccount(admin, params.cardId),
    pooledAccount(admin, 'reclaimed'),
  ])

  return post(
    admin,
    'invalidation_reclaim',
    idem.invalidationReclaim(params.cardId),
    [
      { account_id: card, amount_cents: remaining },
      { account_id: reclaimed, amount_cents: -remaining },
    ],
    { externalRef: params.cardId, memo: 'Card invalidated; value held for reissue' }
  )
}

/**
 * How much was reclaimed from a card when it was invalidated.
 *
 * Lives here rather than in the caller because it reads ledger_entries, and
 * nothing outside this module may. Returns 0 if the card was never
 * reclaimed, or was reclaimed with a zero balance.
 */
export async function reclaimedAmountFor(cardId: string): Promise<number> {
  const admin = createAdminClient()

  const { data: txn } = await admin
    .from('ledger_transactions')
    .select('id')
    .eq('idempotency_key', idem.invalidationReclaim(cardId))
    .maybeSingle()

  if (!txn) return 0

  const { data: entries } = await admin
    .from('ledger_entries')
    .select('amount_cents')
    .eq('transaction_id', txn.id)

  // The positive (debit) leg is what came off the card.
  const debit = (entries ?? []).map(e => Number(e.amount_cents)).find(a => a > 0)
  return debit ?? 0
}

/**
 * Put reclaimed value onto a replacement card.
 *
 *   DEBIT  reclaimed  +amount
 *   CREDIT card       -amount
 *
 * The amount is derived from the original reclaim rather than passed in, so
 * a caller cannot reissue more than the old card actually held.
 */
export async function reissueCard(params: {
  toCardId: string
  fromCardId: string
}): Promise<{ transactionId: string; amountCents: number }> {
  const amountCents = await reclaimedAmountFor(params.fromCardId)
  if (amountCents <= 0) {
    throw new Error(`No reclaimed value found for card ${params.fromCardId}`)
  }

  const admin = createAdminClient()
  const [reclaimed, card] = await Promise.all([
    pooledAccount(admin, 'reclaimed'),
    cardAccount(admin, params.toCardId),
  ])

  const transactionId = await post(
    admin,
    'reissue',
    idem.reissue(params.toCardId),
    [
      { account_id: reclaimed, amount_cents: amountCents },
      { account_id: card, amount_cents: -amountCents },
    ],
    { externalRef: params.toCardId, memo: `Reissued from ${params.fromCardId}` }
  )

  await admin
    .from('cards')
    .update({ reissued_from_card_id: params.fromCardId })
    .eq('id', params.toCardId)

  return { transactionId, amountCents }
}

// ═══════════════════════════════════════════════════════════════════════════
// REDEMPTION — AUTHORIZE, THEN CAPTURE PARTIAL
//
// Shape decision 3. The vendor opens an authorization for the room available,
// rings the sale, then captures what was actually spent. The remainder
// returns to the card in the same transaction as the capture.
//
// This is what makes "room today" possible instead of "insufficient funds",
// and it is what lets a sale made with no signal be captured later against an
// authorization that was already recorded.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Move value from the card into a hold.
 *
 *   DEBIT  card               +amount
 *   CREDIT authorization_hold -amount
 *
 * The card's spendable balance drops immediately, so a second terminal
 * cannot authorize the same value. The hold is released by capture or void,
 * or by the expiry cron after 15 minutes.
 */
export async function holdAuthorization(params: {
  authorizationId: string
  cardId: string
  amountCents: number
}): Promise<string> {
  const admin = createAdminClient()
  const [card, hold] = await Promise.all([
    cardAccount(admin, params.cardId),
    pooledAccount(admin, 'authorization_hold'),
  ])

  return post(
    admin,
    'authorization_hold',
    idem.authorizationHold(params.authorizationId),
    [
      { account_id: card, amount_cents: params.amountCents },
      { account_id: hold, amount_cents: -params.amountCents },
    ],
    { externalRef: params.authorizationId }
  )
}

/**
 * Capture all or part of an authorization. One atomic transaction with three
 * entries when the capture is partial:
 *
 *   DEBIT  authorization_hold  +authorized
 *   CREDIT vendor_payable      -captured
 *   CREDIT card                -(authorized - captured)
 *
 * The vendor is owed what they actually rang. The member gets the difference
 * back on the card before they have walked away from the counter.
 */
export async function captureAuthorization(params: {
  authorizationId: string
  cardId: string
  merchantId: string
  authorizedCents: number
  capturedCents: number
}): Promise<string> {
  if (params.capturedCents > params.authorizedCents) {
    // Also a CHECK constraint on the authorizations row. Both exist because
    // this is the single most consequential bound in the redemption path.
    throw new Error(
      `Capture ${params.capturedCents} exceeds authorization ${params.authorizedCents}`
    )
  }

  const admin = createAdminClient()
  const [hold, vendor, card] = await Promise.all([
    pooledAccount(admin, 'authorization_hold'),
    vendorAccount(admin, params.merchantId),
    cardAccount(admin, params.cardId),
  ])

  const remainder = params.authorizedCents - params.capturedCents

  const entries: Entry[] = [
    { account_id: hold, amount_cents: params.authorizedCents },
    { account_id: vendor, amount_cents: -params.capturedCents },
  ]
  if (remainder > 0) {
    entries.push({ account_id: card, amount_cents: -remainder })
  }

  return post(admin, 'capture', idem.capture(params.authorizationId), entries, {
    externalRef: params.authorizationId,
    memo: remainder > 0 ? `Partial capture; ${remainder} returned to card` : undefined,
  })
}

/**
 * Release an authorization unspent. The vendor cancelled, the member changed
 * their mind, or the expiry cron reaped it.
 *
 *   DEBIT  authorization_hold  +amount
 *   CREDIT card                -amount
 */
export async function voidAuthorization(params: {
  authorizationId: string
  cardId: string
  amountCents: number
  reason: string
}): Promise<string> {
  const admin = createAdminClient()
  const [hold, card] = await Promise.all([
    pooledAccount(admin, 'authorization_hold'),
    cardAccount(admin, params.cardId),
  ])

  return post(
    admin,
    'authorization_void',
    idem.authorizationVoid(params.authorizationId),
    [
      { account_id: hold, amount_cents: params.amountCents },
      { account_id: card, amount_cents: -params.amountCents },
    ],
    { externalRef: params.authorizationId, memo: params.reason }
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTLEMENT
//
// Shape decision 7, and the RPAA boundary: this produces an instruction.
// A human executes the payment. No file in this path may call a banking or
// payout API — see Stack Decision Record §4 rule 4.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discharge a vendor payable against cash. Called AFTER a human has actually
 * sent the money, to record that they did.
 *
 *   DEBIT  vendor_payable  +amount
 *   CREDIT cash_stripe     -amount
 */
export async function recordSettlement(params: {
  merchantId: string
  amountCents: number
  periodEnd: string
  memo: string
}): Promise<string> {
  const admin = createAdminClient()
  const [vendor, cash] = await Promise.all([
    vendorAccount(admin, params.merchantId),
    pooledAccount(admin, 'cash_stripe'),
  ])

  return post(
    admin,
    'settlement',
    idem.settlement(params.merchantId, params.periodEnd),
    [
      { account_id: vendor, amount_cents: params.amountCents },
      { account_id: cash, amount_cents: -params.amountCents },
    ],
    { externalRef: params.merchantId, memo: params.memo }
  )
}

/**
 * A manual correction. Always carries a reason, always idempotent on a
 * human-supplied reference so two admins cannot apply the same fix twice.
 *
 * There is no "edit the ledger" path. A mistake is corrected by posting a
 * compensating transaction that is itself part of the permanent record.
 */
export async function postAdjustment(params: {
  ref: string
  entries: Entry[]
  memo: string
}): Promise<string> {
  const admin = createAdminClient()
  return post(admin, 'adjustment', idem.adjustment(params.ref), params.entries, {
    memo: params.memo,
  })
}

export { cardBalance, pooledAccount, cardAccount, vendorAccount } from './accounts'
export { idem } from './idempotency'
