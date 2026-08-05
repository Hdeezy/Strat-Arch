import { createAdminClient } from '@/lib/supabase/admin'

export type PooledAccount =
  | 'cash_stripe'
  | 'donor_clearing'
  | 'card_float'
  | 'authorization_hold'
  | 'reclaimed'
  | 'chargeback'
  | 'settled'

type Admin = ReturnType<typeof createAdminClient>

/**
 * Resolve the singleton account for a pooled type, creating it on first use.
 * Pooled accounts are per-tenant singletons enforced by a partial unique index.
 */
export async function pooledAccount(admin: Admin, type: PooledAccount): Promise<string> {
  const { data, error } = await admin.rpc('ledger_pooled_account', { p_type: type })
  if (error) throw new Error(`Failed to resolve pooled account ${type}: ${error.message}`)
  return data as string
}

/** Resolve the ledger account for one card, creating it on first use. */
export async function cardAccount(admin: Admin, cardId: string): Promise<string> {
  const { data, error } = await admin.rpc('ledger_card_account', { p_card_id: cardId })
  if (error) throw new Error(`Failed to resolve card account ${cardId}: ${error.message}`)
  return data as string
}

/** Resolve the payable account for one vendor, creating it on first use. */
export async function vendorAccount(admin: Admin, merchantId: string): Promise<string> {
  const { data, error } = await admin.rpc('ledger_vendor_account', { p_merchant_id: merchantId })
  if (error) throw new Error(`Failed to resolve vendor account ${merchantId}: ${error.message}`)
  return data as string
}

/**
 * Read one account's balance from the ledger.
 *
 * This is the authoritative read. cards.balance_cents is a projection of the
 * same number and is asserted equal by pgTAP invariant 3, but when the two
 * disagree, this one is right.
 */
export async function accountBalance(admin: Admin, accountId: string): Promise<number> {
  const { data, error } = await admin
    .from('ledger_balances')
    .select('balance_cents')
    .eq('account_id', accountId)
    .single()

  if (error) throw new Error(`Failed to read balance for ${accountId}: ${error.message}`)
  return Number(data.balance_cents)
}

/** Read a card's authoritative balance straight from the ledger. */
export async function cardBalance(admin: Admin, cardId: string): Promise<number> {
  const { data, error } = await admin
    .from('ledger_balances')
    .select('balance_cents')
    .eq('card_id', cardId)
    .maybeSingle()

  if (error) throw new Error(`Failed to read card balance for ${cardId}: ${error.message}`)
  return data ? Number(data.balance_cents) : 0
}
