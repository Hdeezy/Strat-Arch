/**
 * MEMBER BALANCE VIEW — Scrappy Cut §3a.
 *
 * Read-only. No auth, no login, no session. Whoever holds the credential
 * sees the card, because whoever holds the credential can already spend it.
 * That is the bearer-instrument model, deliberately, not an oversight.
 *
 * ┌─ WHAT THIS PAGE SHOWS ─────────────────────────────────────────────────┐
 * │  Balance · Room today with the day boundary in plain words ·           │
 * │  the issuing charity · the invalidation phone number ·                 │
 * │  not a payment card, not identification, not a medical ID              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ WHAT THIS PAGE MUST NEVER SHOW ───────────────────────────────────────┐
 * │  TRANSACTION HISTORY OF ANY KIND. Balance is safe — it discloses       │
 * │  nothing a holder could not learn by spending. History is different:   │
 * │  "last used at 541 Eatery, Tuesday 6pm" is a location trail on a       │
 * │  vulnerable person, readable by anyone who takes the card, including   │
 * │  a shelter worker, an officer, or an abusive partner.                  │
 * │                                                                        │
 * │  Vendor names, in any form. Member name, tier, advocate, sponsor org,  │
 * │  or any note.                                                          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * This is not a v1 deferral. It is a design rule. Scrappy Cut §8: "If history
 * ever gets added 'just for support purposes', the trade breaks and the page
 * becomes a tracking tool. Guard that line in code review."
 *
 * Accessibility is not optional here. This population has elevated rates of
 * vision impairment and is being handed a screen-first product: large type,
 * high contrast, screen-reader labels, nothing carried by colour alone.
 */

import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeCardCode, formatCAD, roomToday } from '@/lib/utils'
import { auditLookup } from '@/lib/lookup-audit'
import { CategoryBadge } from '@/components/category-badge'
import type { CardCategory } from '@/lib/types'
import WalletPassButtons from './wallet-pass-buttons'

export const dynamic = 'force-dynamic'

const INVALIDATION_PHONE = process.env.NEXT_PUBLIC_HOPE_INVALIDATION_PHONE ?? '905-528-7625'

export default async function WalletCardPage({ params }: { params: { code: string } }) {
  const admin = createAdminClient()
  const code = normalizeCardCode(params.code)

  const { data: cardRow } = await admin
    .from('cards')
    .select('id, card_code, state, balance_cents, allowed_categories, daily_cap_cents, spent_today_cents, last_spent_reset_at, charity_id')
    .eq('card_code', code)
    .maybeSingle()

  const card = cardRow as unknown as {
    id: string
    card_code: string
    state: string
    balance_cents: number
    allowed_categories: CardCategory[]
    daily_cap_cents: number
    spent_today_cents: number
    last_spent_reset_at: string
    charity_id: string
  } | null

  // Log the lookup either way. Scrappy Cut §3a control 2: repeated lookups on
  // many different cards from one source, with no redemption following, is
  // the signature of someone other than the member. Log it and alert; never
  // silently block — a member checking their own balance ten times is normal
  // and must always work.
  await auditLookup({
    headers: headers(),
    cardId: card?.id ?? null,
    outcome: card ? 'found' : 'not_found',
    surface: 'wallet',
  })

  if (!card || card.state === 'invalidated') notFound()

  const { data: charity } = await admin
    .from('charities')
    .select('name')
    .eq('id', card.charity_id)
    .maybeSingle()

  const room = roomToday(card)

  return (
    <main className="min-h-screen bg-hope-dark pb-10">
      <div className="px-4 pt-6 space-y-4 max-w-md mx-auto">

        {/* ── Balance ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="balance-heading"
          className="bg-white rounded-2xl p-6 space-y-5 shadow-xl"
        >
          <div>
            <h1 id="balance-heading" className="text-base font-semibold text-gray-700">
              Your HOPE Card
            </h1>
            <p className="text-xl font-mono font-bold text-gray-900 mt-1 tracking-wide">
              {card.card_code}
            </p>
          </div>

          <div>
            <p className="text-base font-medium text-gray-700">Balance</p>
            <p
              className="text-6xl font-bold text-gray-900 leading-tight"
              aria-label={`Your balance is ${formatCAD(card.balance_cents)}`}
            >
              {formatCAD(card.balance_cents)}
            </p>
          </div>

          {/* Room today, with the day boundary in plain words. */}
          <div className="border-t-2 border-gray-200 pt-4">
            <p className="text-base font-medium text-gray-700">You can spend today</p>
            <p
              className="text-4xl font-bold text-gray-900"
              aria-label={`You can spend ${formatCAD(room)} today`}
            >
              {formatCAD(room)}
            </p>
            <p className="text-base text-gray-700 mt-1">
              This resets at midnight.
            </p>
          </div>

          {/* Categories are a property of the instrument, not of the person.
              A member cannot use the card without knowing what it buys.
              Recorded as an interpretation in DECISIONS.md. */}
          <div className="border-t-2 border-gray-200 pt-4">
            <p className="text-base font-medium text-gray-700 mb-2">This card buys</p>
            <div className="flex flex-wrap gap-2">
              {card.allowed_categories.map((cat: CardCategory) => (
                <CategoryBadge key={cat} category={cat} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Where to use it ─────────────────────────────────────────────
            Deliberately a LINK, not a list. Vendor names never render on a
            credential-bound page: the list of participating vendors is the
            same for every card and discloses nothing, but rendering it here
            puts vendor names one scan away from anyone holding the card. */}
        <Link
          href="/where"
          className="block bg-white/10 hover:bg-white/20 rounded-2xl p-5 text-center
                     text-white text-lg font-semibold border-2 border-white/30
                     focus:outline-none focus:ring-4 focus:ring-white/50 transition-colors"
        >
          Find places that accept this card →
        </Link>

        <WalletPassButtons cardId={card.id} />

        {/* ── Lost or stolen ──────────────────────────────────────────────
            Freeze is a phone call to an advocate. Scrappy Cut §3: the member
            app, accounts, PINs and freeze-from-any-device are all cut. */}
        <section
          aria-labelledby="lost-heading"
          className="bg-white rounded-2xl p-5 space-y-2"
        >
          <h2 id="lost-heading" className="text-base font-bold text-gray-900">
            Lost or stolen?
          </h2>
          <p className="text-base text-gray-800">
            Call us and we will stop this card and give you a new one with the
            same money on it.
          </p>
          <a
            href={`tel:${INVALIDATION_PHONE.replace(/\D/g, '')}`}
            className="block text-2xl font-bold text-hope-dark underline
                       focus:outline-none focus:ring-4 focus:ring-hope-green rounded"
          >
            {INVALIDATION_PHONE}
          </a>
        </section>

        {/* ── The standing reminder ───────────────────────────────────────
            Also printed on the card back. It matters that a police officer,
            a hospital admissions desk, and a landlord all read the same
            sentence. */}
        <section
          aria-label="What this card is not"
          className="bg-white/10 rounded-2xl p-5 border-2 border-white/25"
        >
          <p className="text-base text-white leading-relaxed">
            This is <strong>not a payment card</strong>,{' '}
            <strong>not identification</strong>, and{' '}
            <strong>not a medical ID</strong>. It cannot be exchanged for cash.
          </p>
          {charity?.name && (
            <p className="text-base text-hope-light mt-3">
              Issued by {charity.name}
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
