/**
 * CREDENTIAL LOOKUP AUDIT.
 *
 * Scrappy Cut §3a control 2: "Rate-limit lookups per credential and per
 * source. Repeated balance lookups on many different cards from one device,
 * with no redemption following, is the signature of someone other than the
 * member scanning cards. Log it and alert; do not silently block."
 *
 * The "do not silently block" half is load-bearing. A member checking their
 * own balance ten times in a row is normal behaviour for someone budgeting
 * carefully, and it must always work. What we watch for is one source
 * touching many DIFFERENT cards.
 *
 * Every unauthenticated route that resolves a card code calls this — not
 * just the member balance page. The routes that mint a signed token are the
 * ones an attacker would actually reach for, so leaving them unlogged while
 * watching the visible page would be watching the wrong door.
 *
 * The raw IP and user agent are never stored. Shape decision 8: collect
 * nothing that requires consent machinery.
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

/** Distinct cards from one source in an hour past which we shout. */
const ENUMERATION_THRESHOLD = 12

export type LookupOutcome = 'found' | 'not_found' | 'rate_limited'

/**
 * Salted hash of the requesting source. Reads headers from a Request rather
 * than next/headers so this works in route handlers and server components
 * alike.
 */
export function hashSource(headers: Headers): string {
  const salt = process.env.HOPE_QR_SIGNING_SECRET ?? 'unsalted'
  const raw = `${headers.get('x-forwarded-for') ?? 'unknown'}|${headers.get('user-agent') ?? 'unknown'}`
  return createHash('sha256').update(`${salt}|${raw}`).digest('hex').slice(0, 32)
}

/**
 * Record a lookup and shout if this source is walking the card space.
 *
 * Never throws and never blocks: an audit failure must not take down the
 * page a member is using to check whether they can buy dinner.
 */
export async function auditLookup(params: {
  headers: Headers
  cardId: string | null
  outcome: LookupOutcome
  surface: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const source = hashSource(params.headers)

    await admin.from('credential_lookups').insert({
      card_id: params.cardId,
      source_hash: source,
      outcome: params.outcome,
    })

    const { data } = await admin.rpc('credential_lookup_pressure', {
      p_source_hash: source,
      p_window: '01:00:00',
    })

    const pressure = Array.isArray(data) ? data[0] : data
    const distinct = Number(pressure?.distinct_cards ?? 0)

    if (distinct >= ENUMERATION_THRESHOLD) {
      // Log and alert. Deliberately NOT a block.
      console.error(
        `[ENUMERATION] source ${source} looked up ${distinct} distinct cards ` +
        `in the last hour via ${params.surface}. Investigate; do not auto-block.`
      )
    }
  } catch (err) {
    console.error('[lookup-audit] failed (non-fatal):', err)
  }
}
