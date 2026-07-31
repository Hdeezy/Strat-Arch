/**
 * CREDENTIAL RESOLUTION — one implementation, used by every caller.
 *
 * Scrappy Cut §3a: "Credential resolution is one endpoint: take the
 * credential, return card state. The vendor sees an authorize affordance;
 * anyone else sees a read-only card. […] Building it later means a second
 * copy of credential resolution, which is the last code in the system that
 * should exist twice."
 *
 * Shape decision 4: credential_kind is pluggable from day one. Today the
 * pilot ships paper_qr. The tap memo (§6) recommends NFC NTAG 424 DNA in SUN
 * mode with a printed QR on the same card as fallback. When those cards
 * arrive, only verifySun() below changes — no caller moves.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCardPayload } from '@/lib/qr'
import { normalizeCardCode, validateCardCode } from '@/lib/utils'

export type CredentialKind = 'paper_qr' | 'nfc_sun' | 'rotating_qr'

export type ResolutionFailure =
  | 'malformed'
  | 'not_found'
  | 'invalidated'
  | 'expired'
  | 'signature_invalid'
  | 'replayed'

export interface ResolvedCredential {
  card_id: string
  card_code: string
  credential_kind: CredentialKind
  city_id: string
  charity_id: string
  /** Present only when the credential was a signed token. */
  nonce?: string
}

export type Resolution =
  | { ok: true; credential: ResolvedCredential }
  | { ok: false; failure: ResolutionFailure }

/**
 * Take whatever the scanner or the URL bar produced and turn it into a card.
 *
 * Accepts, in order of specificity:
 *   1. A SUN URL from an NFC tap        (…?picc_data=…&cmac=…)
 *   2. A signed JWT                     (three base64url segments)
 *   3. A donate URL with a card code    (/donate/HMLT-3F7K2QX9)
 *   4. A bare card code                 (typed at a counter with no camera)
 */
export async function resolveCredential(raw: string): Promise<Resolution> {
  const input = raw.trim()
  if (!input) return { ok: false, failure: 'malformed' }

  if (looksLikeSunUrl(input)) return resolveSun(input)
  if (input.split('.').length === 3) return resolveSignedToken(input)

  const code = extractCardCode(input)
  if (code) return resolveByCode(code)

  return { ok: false, failure: 'malformed' }
}

// ── paper_qr / manual entry ────────────────────────────────────────────────

function extractCardCode(raw: string): string | null {
  const fromUrl = raw.match(/\/(?:donate|wallet)\/([A-Z]{4}-[A-Z0-9]{4,10})/i)
  if (fromUrl) return normalizeCardCode(fromUrl[1])

  const bare = normalizeCardCode(raw)
  return validateCardCode(bare) ? bare : null
}

async function resolveByCode(code: string): Promise<Resolution> {
  const admin = createAdminClient()
  const { data: card } = await admin
    .from('cards')
    .select('id, card_code, credential_kind, city_id, charity_id, state')
    .eq('card_code', code)
    .maybeSingle()

  if (!card) return { ok: false, failure: 'not_found' }
  return stateGate(card)
}

// ── rotating_qr / signed token ─────────────────────────────────────────────

async function resolveSignedToken(token: string): Promise<Resolution> {
  let payload
  try {
    payload = await verifyCardPayload(token)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    return { ok: false, failure: msg.includes('expired') ? 'expired' : 'signature_invalid' }
  }

  const admin = createAdminClient()
  const { data: card } = await admin
    .from('cards')
    .select('id, card_code, credential_kind, city_id, charity_id, state')
    .eq('id', payload.card_id)
    .maybeSingle()

  if (!card) return { ok: false, failure: 'not_found' }

  const gated = stateGate(card)
  if (!gated.ok) return gated
  return { ok: true, credential: { ...gated.credential, nonce: payload.nonce } }
}

// ── nfc_sun ────────────────────────────────────────────────────────────────

function looksLikeSunUrl(raw: string): boolean {
  return /[?&]picc_data=/i.test(raw) && /[?&]cmac=/i.test(raw)
}

/**
 * NTAG 424 DNA, SUN mode. Each tap emits a URL carrying an AES-CMAC
 * cryptogram and an on-chip monotonic counter. A photograph of the card is
 * worthless because the cryptogram changes every tap.
 *
 * NOT YET IMPLEMENTED. The pilot ships paper_qr; per the tap memo §8 the
 * physical read test across handset families has to happen before we commit
 * to the hardware. This returns a clean failure rather than a silent pass so
 * that a SUN URL scanned today is declined rather than half-honoured.
 *
 * When it lands, the work is: decrypt picc_data with the per-card key found
 * via cards.credential_key_ref, verify the CMAC, assert the tap counter is
 * strictly greater than cards.credential_tap_counter, then store the new
 * counter. Nothing outside this function changes.
 */
async function resolveSun(_url: string): Promise<Resolution> {
  return { ok: false, failure: 'signature_invalid' }
}

// ── shared state gate ──────────────────────────────────────────────────────

interface CardRow {
  id: string
  card_code: string
  credential_kind: CredentialKind
  city_id: string
  charity_id: string
  state: string
}

function stateGate(card: CardRow): Resolution {
  if (card.state === 'invalidated') return { ok: false, failure: 'invalidated' }
  if (card.state === 'expired') return { ok: false, failure: 'expired' }

  return {
    ok: true,
    credential: {
      card_id: card.id,
      card_code: card.card_code,
      credential_kind: card.credential_kind,
      city_id: card.city_id,
      charity_id: card.charity_id,
    },
  }
}
