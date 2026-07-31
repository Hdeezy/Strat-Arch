# THREAT MODEL

**Status:** as built, Sprint 0.
**Governing document:** HOPE MVP — The Scrappy Cut, §3a and §4.
**Companion:** `docs/ARCHITECTURE.md`, `docs/LEDGER-SPEC.md`.

This document exists to say what is actually defended and what is not. Several vectors below are genuinely **OPEN** at this scope. Recording them honestly is the point; a threat model that marks everything covered is a marketing document.

Every file path here was read. Where a control is claimed, the code implementing it exists. Where it does not, the entry says so.

## Status vocabulary

| | |
|---|---|
| **ENFORCED** | A control exists in code, and something fails loudly if it is removed. |
| **PARTIAL** | A control exists but does not cover the whole vector, or detects rather than prevents. |
| **OPEN** | No control in code. Either accepted for the pilot, or a gap that needs a decision. |

## Register at a glance

| # | Vector | Status |
|---|---|---|
| 1 | Vendor phantom redemptions | PARTIAL |
| 2 | Dual-role self-dealing | **OPEN** |
| 3 | Advocate self-issuance | PARTIAL |
| 4 | Vouch fraud | **OPEN** (by design) |
| 5 | Coerced redemption | PARTIAL |
| 6 | Cloned credentials | PARTIAL (accepted for `paper_qr`) |
| 7 | Card-testing | PARTIAL |
| 8 | Quishing | **OPEN** |
| 9 | Impersonation / card-as-ID | PARTIAL |
| 10 | Grant fraud | ENFORCED for the ledger, PARTIAL for reporting |
| 11 | Institutional soft coercion | PARTIAL (control is the absence of data) |
| 12 | Staff curiosity lookups | **OPEN** |
| 13 | Account resale | PARTIAL |
| 14 | Balance-scanning enumeration | PARTIAL, with three unlogged surfaces |
| 15 | Chargeback abuse against the float | PARTIAL |

## Note on the test gate, which several entries depend on

CI (`.github/workflows/ci.yml`) has four jobs. The `ledger-invariants` job stands up Postgres 16 with pgTAP, applies migrations 001–007, and runs **only** `supabase/tests/04_ledger_invariants.sql` — 23 assertions covering the five invariants plus idempotency. It fails the build on any `not ok`.

The other three pgTAP files (`01_schema_verification.sql`, `02_rls_policies.sql`, `03_append_only_trigger.sql`) exist and are **not run by CI**. Anything relying on them is unverified on every merge.

The Jest suite runs in CI and is **currently red**: 5 of 53 tests fail across `src/__tests__/card-code.test.ts` (the format check was widened in migration 005 without updating the test) and `src/__tests__/webhook-categories.test.ts` (the webhook no longer writes `allowed_categories` or `balance_cents` to the card, but the tests still assert it does). Until those are reconciled, "tested in CI" is weaker than it sounds for anything in those files.

No test exercises `/api/redemption/authorize`, `/capture`, or `/void` end to end.

---

## 1. Vendor phantom redemptions

**Actor.** Vendor owner or counter staff with a live `merchant_staff` row.

**Mechanism.** Open authorizations and capture against cards that were never presented, or capture more than the sale, inflating the weekly payable.

**Control.** Capture requires an authorization the *same* merchant opened; a mismatch is a 403. Capture can never exceed the authorization — bounded three times: in the route, in `captureAuthorization()`, and by the `capture_within_authorization` CHECK on the row. Every capture writes an immutable `card_events` row naming the merchant. Payables accrue to `vendor_payable` and are only discharged by a human reading `settlement_instructions` and making a transfer, so no phantom capture becomes money without a person looking at the list first. Detection: `computeFlags()` raises `rapid_redemption` for a card captured 3+ times in an hour.

**Where.** `src/app/api/redemption/capture/route.ts` (merchant-ownership check, `auth.merchant_id !== staff.merchant_id`; amount bound); `src/ledger/index.ts` `captureAuthorization()`; `supabase/migrations/005_ledger.sql` (CHECK constraint); `supabase/migrations/007_invariants_and_views.sql` (`settlement_instructions`); `src/lib/admin-flags.ts`.

**Tested by.** pgTAP invariant 4 in `supabase/tests/04_ledger_invariants.sql` — four assertions, including that a one-cent over-capture is refused and that an over-captured row cannot be inserted. Runs on every merge.

**Gap.** The merchant-ownership check has no test. Velocity flagging is per *card*, not per *vendor*: a vendor phantom-capturing across many different cards at a normal per-card rate raises nothing. There is no vendor-level anomaly signal anywhere in the codebase.

**Status: PARTIAL.**

---

## 2. Dual-role self-dealing

**Actor.** One human holding two roles — e.g. an advocate who also works a vendor counter, or a charity admin with a `merchant_staff` row.

**Mechanism.** Load a card, walk it to your own till, capture it. Or invalidate a card, reissue to yourself, spend at your own shop.

**Control.** None. Role membership lives in three unrelated places — `profiles.role`, an `advocates` row, and a `merchant_staff` row — and each route checks only the one it cares about. `/api/redemption/authorize` checks `merchant_staff` and never looks at `advocates`. `/api/cards/[id]/credit` checks `advocates`, falls back to `profiles.role`, and never looks at `merchant_staff`. Nothing in the schema forbids one `auth.users` id from appearing in both tables, and nothing flags it after the fact.

**Where.** No file. The absence is visible in `src/app/api/redemption/authorize/route.ts` lines 34–43 and `src/app/api/cards/[id]/credit/route.ts` lines 26–38.

**Tested by.** Nothing.

**Note.** The cheapest fix at this scale is not code: it is a query the founder runs, and a stated rule that no person holds both roles. But it is not in the repository, so it is open.

**Status: OPEN.**

---

## 3. Advocate self-issuance

**Actor.** A screened advocate.

**Mechanism.** Credit cards they control, or credit far beyond the intended amount, then spend or resell.

**Control.** Credits require an active `advocates` row (`is_active = true`) and are scoped to the advocate's own charity — a card belonging to another charity is a 403. Per-call ceiling of $1,000 enforced by the Zod schema. Every credit writes an append-only `card_events` row with `actor_ref = user.id`, the advocate's name, and the stated reason; that row can never be edited or deleted. Detection: `computeFlags()` raises `quick_load_redeem` when a card is redeemed within 60 seconds of being loaded.

**Where.** `src/app/api/cards/[id]/credit/route.ts`; `src/app/api/cards/[id]/issue/route.ts` (custody record with `context_note`); `supabase/migrations/001_schema.sql` (`card_events` triggers); `supabase/migrations/006_grants.sql` (revokes on `card_events`); `src/lib/admin-flags.ts`.

**Tested by.** Append-only enforcement on `card_events` is tested in `supabase/tests/03_append_only_trigger.sql` — **which CI does not run.** The guards' *presence* is asserted by `assert_append_only_guards()`, which invariant 5 does check in CI. Nothing tests the charity scoping or the credit ceiling.

**Gap.** No per-advocate daily or weekly issuance ceiling; the $1,000 bound is per call, and calls are unlimited. No second-person approval on anything. Most importantly, the credit route writes `cards.balance_cents` **directly**, so advocate-issued value never enters the ledger — it appears as invariant-3 drift the next morning rather than as a traceable transaction with an idempotency key. The audit trail for the largest discretionary money movement in the system is a `card_events` row, not a ledger entry.

**Status: PARTIAL.**

---

## 4. Vouch fraud

**Actor.** Someone who is not eligible, or an advocate vouching for friends.

**Mechanism.** Obtain a card by misrepresenting circumstances to an advocate.

**Control.** Nothing in code, deliberately. Shape decision 8 says collect nothing that requires consent machinery; there is no eligibility record, no needs assessment, no clinical or narrative field anywhere in `001_schema.sql`, `004_org_types.sql` or `005_ledger.sql` to check a vouch against. The countermeasures are process: published vouch criteria, advocate screening, and the fact that value only moves in $20-a-day increments to closed-loop essentials. In code, the only binding is that issuance requires an active, charity-scoped advocate row.

**Where.** `src/app/api/cards/[id]/issue/route.ts` (active-advocate + charity check); the absence of any eligibility table is itself the control.

**Tested by.** Nothing, and nothing should be — there is no data to test against.

**Status: OPEN by design.** The programme accepts a fraud rate as the price of not building a surveillance apparatus around vulnerable people. This is a deliberate trade, and it should be stated to funders in those words rather than defended as a control.

---

## 5. Coerced redemption

**Actor.** An abusive partner, a dealer, a person on the street who takes the card, or anyone else in a position to compel.

**Mechanism.** Force the member to hand over the card or to spend at a chosen shop.

**Control.** Structural bounding rather than detection. `daily_cap_cents` (default $20) caps one day's loss; `roomToday()` is the lesser of balance and remaining cap, so no single coerced session drains the card. The category gate means the card cannot buy anything outside the closed loop, and the card face states it cannot be exchanged for cash — the resale value to a coercer is low by construction. If the card is taken, the member calls the number on `/wallet/[code]`; the card is invalidated and the remaining value moves to a replacement via `reclaimCard()` / `reissueCard()`. The wallet page deliberately shows no history, so a coercer holding the card learns nothing about where the member has been.

**Where.** `src/lib/utils.ts` `roomToday()` / `getDailyCapRemaining()`; `src/app/api/redemption/authorize/route.ts` (room and category gate); `src/app/wallet/[code]/page.tsx` (invalidation phone, no history); `src/app/api/cards/[id]/invalidate/route.ts`; `src/ledger/index.ts` `reclaimCard()` / `reissueCard()`.

**Tested by.** Daily-cap arithmetic and the category gate are covered by `src/__tests__/daily-cap.test.ts` and `src/__tests__/category-gate.test.ts` — both currently pass in CI.

**Gap.** `reclaimCard()` and `reissueCard()` have no callers outside `src/ledger/`. The invalidate route flips `cards.state` and writes an event, but **does not reclaim the balance to the ledger**, so the "same money on a new card" promise printed on the wallet page has no implementation behind it today. There is no PIN and no way to detect coercion; that is accepted.

**Status: PARTIAL.**

---

## 6. Cloned credentials

**Actor.** Anyone who can photograph a card or read the code over a shoulder.

**Mechanism.** `paper_qr` is a static string. Copy it, present it elsewhere.

**Control.** Accepted, not defended, and the system is shaped around the acceptance. The bearer model already assumes holder equals spender (`src/app/wallet/[code]/page.tsx` header comment). Loss is bounded by the daily cap and the category gate, and by there being no cash-out. The upgrade path is pre-built: `credential_kind` is an enum from day one, `cards.credential_key_ref` and `cards.credential_tap_counter` exist for NTAG 424 DNA in SUN mode, and `resolveSun()` is a stub that returns `signature_invalid` — failing closed, so a SUN URL scanned today is declined rather than half-honoured. For `rotating_qr`, tokens are HS256 JWTs with a 5-minute expiry and a nonce, and `used_nonces` gives single-use replay rejection.

**Where.** `src/credentials/index.ts` (`resolveCredential`, `resolveSun`, `stateGate`); `supabase/migrations/005_ledger.sql` §SHAPE 4; `src/lib/qr.ts`; `supabase/migrations/001_schema.sql` (`used_nonces`).

**Tested by.** `src/__tests__/qr.test.ts` covers signing, verification, expiry and tamper rejection. `src/__tests__/redemption-idempotency.test.ts` covers nonce replay rejection — but only against the **legacy** `attemptRedemption()` path, not the two-phase path the vendor UI actually uses.

**Gap.** The two-phase path does not consume nonces at all. `authorizations.nonce` is set to the authorization's own UUID when the credential is a bare card code (`authorize/route.ts` line 102), so for `paper_qr` the nonce column carries no replay protection. This is consistent with the bearer model but should not be mistaken for a control.

**Status: PARTIAL — accepted for `paper_qr`.**

---

## 7. Card-testing

**Actor.** A scripted attacker probing for live cards with balances.

**Mechanism.** Enumerate codes and hammer lookup endpoints until something returns a balance.

**Control.** New codes are 8 characters of Crockford base32 with ambiguous glyphs removed (~40 bits), generated by `generate_card_code()`. `validateCardCode()` rejects malformed input before any query. Sliding-window rate limits in middleware cover `/api/checkout/create` (10/min), `/api/cards/validate-token` (30/min), `/api/cards*` (60/min) and the Stripe webhook. `/wallet/*` is served `no-store`, `no-referrer`, `noindex` via `vercel.json`.

**Where.** `supabase/migrations/005_ledger.sql` (`generate_card_code`); `src/lib/utils.ts` (`validateCardCode`); `src/middleware.ts` (`RATE_LIMITS`); `vercel.json` (wallet headers).

**Tested by.** `src/__tests__/card-code.test.ts` — **currently failing**, because it still asserts the pre-005 narrow format. The format widened; the test did not.

**Gap.** Three of them. The rate limiter is an in-process `Map` (`src/middleware.ts` line 9) and Vercel runs multiple instances, so the effective limit is the stated number times the instance count. It only applies to paths under `/api/`, so the page routes `/wallet/[code]` and `/donate/[code]` — both of which return a balance — are not rate-limited at all. And `/api/lookup/[code]` matches none of the four prefixes, so it is unlimited.

**Status: PARTIAL.**

---

## 8. Quishing

**Actor.** Anyone with a sticker printer.

**Mechanism.** Cover the printed QR with one pointing at a lookalike donation page and harvest card payments intended for the programme.

**Control specified.** The Scrappy Cut names one: the printed QR sits beside the giving domain **in words**, so a person can read where they are being sent and compare it to the address bar.

**Control implemented.** None. `src/app/api/admin/print-cards-pdf/route.ts` renders each card with a leaf glyph, "HOPE Card — Hamilton", "Closed-loop essentials voucher", the card code, "Cannot be exchanged for cash", and the QR image. The domain does not appear in words anywhere on the artifact. There is no tamper-evident element on the card, and no runtime check that a scanned code resolves to the expected host.

**Where.** `src/app/api/admin/print-cards-pdf/route.ts`, lines 76–92 — the full card layout, verified.

**Tested by.** Nothing.

**Status: OPEN.** This is the cheapest unimplemented control in the document: one line of text in a PDF template.

---

## 9. Impersonation and card-as-identification

**Actor.** A fake advocate collecting cards; or a landlord, hospital desk, or officer treating the card as identification.

**Mechanism.** The card acquires an authority it was never meant to have, and the member is judged by it.

**Control.** The card carries no photo, no member name, no tier, no advocate, no sponsor and no note — there is no column for any of them. `/wallet/[code]` states, in bold, that it is **not a payment card, not identification, and not a medical ID**, and names the issuing charity. Vendor names never render on a credential-bound page; `/where` is a deliberate link, not an inline list, so vendor names are not one scan away from anyone holding the card. There are no public profiles, no scan-to-identity, and no stories anywhere in the codebase.

**Where.** `src/app/wallet/[code]/page.tsx` (the standing reminder; the `/where` link and the comment explaining why it is a link); `supabase/migrations/001_schema.sql` (the `cards` table has no identity columns).

**Tested by.** Nothing automated. This is enforced by code review against the rule in the page header.

**Gap.** The printed card carries only "Cannot be exchanged for cash". The not-ID / not-medical-ID triple — the sentence that matters when a police officer or an admissions desk is reading the physical object rather than the web page — is **not on the printed artifact**. Same file, same fix, as vector 8.

**Status: PARTIAL.**

---

## 10. Grant fraud

**Actor.** Anyone inside the programme reporting numbers to a funder.

**Mechanism.** Overstate redemptions or members served; quietly restate history after the fact.

**Control.** The ledger is the reporting substrate and it cannot be rewritten. `UPDATE`, `DELETE` and `TRUNCATE` on `ledger_entries`, `ledger_transactions` and `card_events` are revoked from `anon`, `authenticated` **and** `service_role`, and blocked again by triggers that catch even the migration role. Corrections are compensating `adjustment` transactions carrying a mandatory memo, themselves permanent. `weekly_reconciliation` gives a three-way view — captured, settled, cleared in, activated. Five invariants run nightly and in CI; `assert_append_only_guards()` specifically checks that the guards themselves are still installed, because a dropped trigger is the failure mode that makes an absence of tampering evidence meaningless.

**Where.** `supabase/migrations/006_grants.sql`; `supabase/migrations/005_ledger.sql` (`prevent_ledger_modification`); `supabase/migrations/007_invariants_and_views.sql` (`check_ledger_invariants`, `weekly_reconciliation`); `src/ledger/replay.ts`; `src/app/api/cron/reconcile/route.ts`.

**Tested by.** `supabase/tests/04_ledger_invariants.sql`, invariant 5 — three `throws_ok` assertions proving an entry cannot be updated or deleted and a transaction cannot be rewritten, plus a check that all six guards are present. Runs on every merge. `replayAndCompare()` in the nightly cron re-derives balances independently of the SQL views, so a bug in a view cannot mark itself healthy.

**Gap.** The reporting surface people will actually use does not read the ledger. `/api/admin/export` builds its CSV from the legacy `redemptions` table, and it is **not charity-scoped** — a `charity_admin` exports every charity's redemptions and donations, including donor notes. `weekly_reconciliation` has no caller in `src/` at all.

**Status: ENFORCED for the ledger, PARTIAL for reporting.**

---

## 11. Institutional soft coercion

**Actor.** A shelter, agency or programme that makes services contingent on showing, surrendering, or "letting us check" the card.

**Mechanism.** The card becomes a compliance instrument — a way for an institution to observe or gate a person's behaviour.

**Control.** The control is the absence of data, and it holds. Someone who demands to see the card and scans it gets: a balance, a room-today figure, a category list, an issuing charity name, and a phone number. No name. No history. No vendor. No advocate. No tier. No notes. There is nothing to observe and nothing to condition services on beyond a dollar figure. The category list is shown deliberately — a member cannot use the card without knowing what it buys — and is a property of the instrument, not of the person.

**Where.** `src/app/wallet/[code]/page.tsx` — the "WHAT THIS PAGE MUST NEVER SHOW" block is the specification, and the query on lines 65–69 selects exactly the columns needed and no more.

**Tested by.** Nothing automated. The page header says explicitly: guard that line in code review.

**Gap.** No code control, and none is possible — the vector is social. The risk is drift: the first "just for support purposes" history feature turns this page into a tracking tool. A test that fails when the wallet query grows a column would be a cheap guard and does not exist.

**Status: PARTIAL — control is architectural, not enforced.**

---

## 12. Staff curiosity lookups

**Actor.** A charity admin, super admin, or advocate with legitimate credentials and no legitimate reason.

**Mechanism.** Browse member records — which cards, which balances, which redemptions, whose notes — out of curiosity, or on someone else's behalf.

**Control specified.** The Scrappy Cut keeps two free controls here: purpose-prompted, logged admin access to member records; and `charity_admin` separated from `platform_support` as distinct roles.

**Control implemented.** Neither. There is no purpose prompt on any admin surface — `grep` across `src/app/admin` finds no reason or purpose field on any read path. Admin reads write no `card_events` row and no access log of any kind, so a lookup leaves no trace at all; only *writes* are recorded. The `user_role` enum in `001_schema.sql` is `donor, advocate, merchant_staff, charity_admin, super_admin` — `platform_support` does not exist, and `004_org_types.sql` does not add it. Every admin page and API route uses `createAdminClient()`, the service-role client that bypasses RLS entirely, so the charity-scoping policies written in `002_rls.sql` never execute on a live request. `/api/admin/export` applies no charity scope at all.

What does exist: role gates on the layouts, and a charity scope on the fraud-flags route.

**Where.** `src/app/admin/layout.tsx` and `src/app/advocate/layout.tsx` (role gates — these do work); `src/lib/supabase/admin.ts` (the RLS bypass); `supabase/migrations/002_rls.sql` (policies that are written and unexercised); `src/app/api/admin/export/route.ts` (unscoped, unlogged); `src/app/api/admin/flags/route.ts` (the one route that scopes by charity).

**Tested by.** `supabase/tests/02_rls_policies.sql` exists and **CI does not run it** — and it would be testing policies that no live path invokes.

**Status: OPEN.** This is the largest gap in the document relative to what the spec explicitly asked for, and the spec called it free.

---

## 13. Account resale

**Actor.** A member selling their card, or someone buying cards in bulk at a discount.

**Mechanism.** Convert programme value to cash at a discount, defeating the closed loop.

**Control.** Resale value is suppressed by construction: no cash-out path exists anywhere in the codebase, the category gate confines spend to vetted essentials merchants, and the daily cap means a bought card yields $20 a day rather than a lump. A reported card is invalidated and the value follows the member to a replacement. Detection: `rapid_redemption` (3+ captures on one card in an hour) and `quick_load_redeem` (redemption within 60 seconds of a load).

**Where.** `src/lib/utils.ts` (`isCategoryAllowed`, `roomToday`); `src/app/api/redemption/authorize/route.ts` (category gate as a genuine decline, room as a number); `src/app/api/cards/[id]/invalidate/route.ts`; `src/lib/admin-flags.ts`.

**Tested by.** `src/__tests__/category-gate.test.ts` (9 assertions) and `src/__tests__/daily-cap.test.ts` — both pass in CI.

**Gap.** Both flags read the legacy `redemptions` table rather than the ledger, so they see only what the capture route writes there as a compatibility record. There is no vendor-concentration signal: a card that redeems at exactly one shop, far from its issuing charity, every day, looks entirely normal to `computeFlags()`.

**Status: PARTIAL.**

---

## 14. Balance-scanning enumeration of card codes

**Actor.** Anyone with a script, or a person in a shelter with a phone and a handful of cards.

**Mechanism.** Walk the card-code space, read balances, and either target the fat cards or build a picture of who is carrying what.

**Control.** New codes are non-enumerable (~40 bits, `generate_card_code()`), which is the primary defence. `/wallet/[code]` logs every lookup — hit or miss — to `credential_lookups` with a salted SHA-256 of IP plus user agent; the raw values are never stored, per shape decision 8. `credential_lookup_pressure()` returns distinct-cards-per-source over a window so a caller can spot one device scanning many different cards. Rows are pruned at 30 days by the hourly cron. Per the spec, the design is to log and alert, never to silently block — a member checking their own balance ten times must always work.

**Where.** `supabase/migrations/005_ledger.sql` (`credential_lookups`, `cleanup_credential_lookups`); `supabase/migrations/007_invariants_and_views.sql` (`credential_lookup_pressure`); `src/app/wallet/[code]/page.tsx` lines 53–58 and 88–92 (`sourceHash()` and the insert); `src/app/api/cron/clearance/route.ts` (the prune).

**Tested by.** Nothing.

**Gaps**, and there are four:

1. **The signal is collected and never read.** `credential_lookup_pressure()` has no caller anywhere in `src/`. Nothing alerts. The logging is real; the alerting the spec asked for does not exist.
2. **`/donate/[code]` returns a balance and logs nothing.** It is public, unauthenticated, un-rate-limited, and it renders balance, daily cap, state and categories. It is also the URL the printed QR points at.
3. **`/api/cards/by-code/[code]/lookup` and `/api/cards/[id]/lookup` are unauthenticated and mint a signed JWT.** Both take a card code, return the full card row, and hand back a freshly signed 5-minute bearer token for the card — to any caller, with no auth. `/api/lookup/[code]` is likewise unauthenticated and matches none of the middleware rate-limit prefixes. None of the three writes a `credential_lookups` row.
4. **The 50 seeded pilot cards are `HMLT-0001`…`HMLT-0050`.** For the pilot cohort, the non-enumerability control does not apply.

**Status: PARTIAL.** Item 3 is the one to fix first: it turns knowledge of a card code into a signed credential.

---

## 15. Chargeback abuse against the float

**Actor.** A donor reversing in bad faith, or someone donating with a stolen card.

**Mechanism.** Fund cards, let the value be spent, then dispute the charge — extracting programme value at the Foundation's expense.

**Control.** The clearance hold is the primary defence, and the indirection is deliberate: anonymous gifts sit in `donor_clearing` for 72 hours before joining `card_float`, and cards are activated from the **pooled cleared float**, never from an individual gift. So a reversal three days later lands on the pool, not on a person standing at a counter with a card that just went dead. `reverseDonation()` routes the loss to `donor_clearing` if the gift is still held and to `card_float` if it has cleared; the float is permitted to go negative and invariant 2 is deliberately scoped to card accounts so that this is recorded rather than rejected. **Card value is never clawed back.** The nightly cron logs an error when `card_float` is negative, and the reversal handler is idempotent on the Stripe event id and short-circuits on `donation.reversed_at`.

**Where.** `src/app/api/stripe/webhook/route.ts` (`charge.dispute.created`, `charge.refunded`); `src/ledger/index.ts` `reverseDonation()`; `supabase/migrations/005_ledger.sql` (`clearance_due_at`, `reversed_at`); `supabase/migrations/007_invariants_and_views.sql` (`find_negative_card_balances`, scoped to `account_type = 'card'`); `src/app/api/cron/reconcile/route.ts` (float-health alert).

**Tested by.** Nothing. No Jest test and no pgTAP case exercises `chargeback_reversal`, the cleared-versus-uncleared branch, or the negative-float alert. The one webhook test file in the repository tests category metadata, and is currently failing.

**Gaps.** Identified donors clear **immediately** (`clearance_due_at` is set to `now()` when `donor_user_id` is present), so any donor who signs in bypasses the hold entirely — and "signed in" is a self-serve Supabase account, not a verified identity. There is no cap on total float exposure and no velocity limit on donations from one source. The negative-float condition logs at error level and nothing else; there is no circuit breaker that pauses activations while the pool is underwater.

**Status: PARTIAL.**

---

## What to fix first

Ordered by cost against consequence, not by severity alone.

1. **Vector 14, item 3** — put auth on the two `lookup` routes that mint signed card tokens, or delete them. They are unused by any UI.
2. **Vectors 8 and 9** — add the giving domain in words and the not-ID / not-medical-ID line to the printed card. One template edit covers both.
3. **Vector 12** — a purpose prompt and an access log on admin reads of member records, and a `platform_support` role. The spec called these free; they are not free, but they are cheap, and nothing else in the document is a bigger gap against stated intent.
4. **The red test gate** — reconcile `card-code.test.ts` and `webhook-categories.test.ts` with the code as it now stands. A failing suite trains everyone to ignore CI, which silently disarms every control in this document that is enforced by a test.
5. **Vector 3 and Architecture tension 2** — route advocate credit through `activateCard()` so the largest discretionary money movement in the system is a ledger transaction rather than drift discovered the next morning.
