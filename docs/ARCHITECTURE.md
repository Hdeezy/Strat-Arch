# ARCHITECTURE

**Status:** as built, Sprint 0.
**Governing document:** HOPE MVP — The Scrappy Cut.
**Companion:** `docs/LEDGER-SPEC.md` (every transaction kind, worked, with failure cases).

The Scrappy Cut downgrades this from a full architecture document to one page. This is that page.

## Scale

~150 members, 15 vendors, ~20 advocates, 4 sponsor orgs. 25,000–50,000 redemptions a year. Peak load is single-digit requests per second. **There is no scale problem and there never will be.** Nothing here is justified by throughput, caching, sharding, replicas, or future load. If a change is argued for on those grounds, the argument is wrong.

## Shape

Next.js 14 App Router on Vercel (region `yul1`), Supabase Postgres (region `ca-central-1`), Stripe on the Foundation's **own** account — not Connect. Every server path is a route handler or a React Server Component. No separate service, no queue, no container.

Five surfaces:

- **Public, no auth** — `/donate/[code]`, `/wallet/[code]`, `/where`.
- **Advocate** — `/advocate`, gated in `src/app/advocate/layout.tsx` on an active `advocates` row.
- **Vendor** — `/merchant`, gated on an active `merchant_staff` row.
- **Admin** — `/admin`, gated in `src/app/admin/layout.tsx` on `profiles.role ∈ (charity_admin, super_admin)`.
- **Three crons** (`vercel.json`) — clearance 06:00 daily, reconcile 07:00 daily, settlement Mondays 12:00. All authenticate with a bearer secret (`src/lib/cron-auth.ts`) and refuse to run if `CRON_SECRET` is unset. Daily is a Vercel Hobby-plan limit; nothing depends on a cron alone (see step 6 of the money path).

RLS policies exist in `supabase/migrations/002_rls.sql`, but every server path uses the service-role client (`src/lib/supabase/admin.ts`), which bypasses them. Authorization is enforced in route handlers, not by the database. See Tensions.

## Where the eight shape decisions live

| # | Decision | Where |
|---|---|---|
| 1 | Double-entry append-only ledger, idempotency keys | `005_ledger.sql` (tables, `post_ledger_transaction()`, deferred sum-to-zero trigger); `src/ledger/` (the only module permitted to move value); `006_grants.sql` (UPDATE/DELETE revoked from `anon`/`authenticated`/`service_role`); `.eslintrc.json` (`no-restricted-syntax` on ledger tables and the RPC) |
| 2 | `tenant_id` on every table | `005_ledger.sql` §SHAPE 2 — column, FK and `default_tenant_id()` on eleven tables. Column only: no RLS, no per-tenant config, no provisioning UI |
| 3 | Authorize then capture partial | `authorizations` table + `capture_within_authorization` CHECK (`005`); `holdAuthorization` / `captureAuthorization` / `voidAuthorization` in `src/ledger/index.ts`; `src/app/api/redemption/{authorize,capture,void}/route.ts` |
| 4 | `credential_kind` enum | `005` (enum plus `cards.credential_kind`, `credential_key_ref`, `credential_tap_counter`); `src/credentials/index.ts` — one resolver, only the verification step differs per kind. `resolveSun()` is a stub that fails closed |
| 5 | Append-only `card_events` | Triggers in `001_schema.sql`; revokes in `006_grants.sql`; liveness checked by `assert_append_only_guards()` in `007` |
| 6 | `ca-central-1` | Supabase project setting (not schema); Vercel `regions: ["yul1"]` in `vercel.json` |
| 7 | No payout execution | `settlement_instructions` view (`007`); `/api/cron/settlement` prints a list and returns it; `.eslintrc.json` bans `.payouts` and `.transfers` anywhere in the settlement path |
| 8 | Collect nothing requiring consent machinery | No clinical, narrative, eligibility or tier field exists in `001`/`004`/`005`. `credential_lookups` stores a salted SHA-256 of IP + user agent, never the raw values, pruned at 30 days by `cleanup_credential_lookups()` |

## The money path

1. **In.** Donor pays through Stripe Checkout. `src/app/api/stripe/webhook/route.ts` is the only way money enters. Signature verified; idempotent on the payment intent. The webhook writes the donor's chosen `allowed_categories` to the card — that is configuration, not money — and deliberately never writes `balance_cents` or `state`.
2. **Clearance.** `recordDonation()` posts DEBIT `cash_stripe` / CREDIT `donor_clearing`. Not spendable yet. Anonymous gifts serve 72 hours (`donations.clearance_due_at`); identified donors clear immediately.
3. **Float.** The daily clearance cron calls `clearDonation()` — DEBIT `donor_clearing` / CREDIT `card_float`. A few hours of granularity is noise against a 72-hour window.
4. **Card.** `activateCard()`, reached through `/api/cards/[id]/credit`, moves float onto one card — DEBIT `card_float` / CREDIT `card`. `post_ledger_transaction()` refreshes `cards.balance_cents` and the card state in the same database transaction. Cards are activated from the *pooled cleared float*, never from an individual gift, so a chargeback lands on the pool rather than on a person at a counter.
5. **Hold.** Vendor scans; `/api/redemption/authorize` reserves `roomToday()` — DEBIT `card` / CREDIT `authorization_hold`. Spendable balance drops immediately, so a second terminal cannot authorize the same money. 15-minute expiry.
6. **Capture.** One atomic transaction: DEBIT `authorization_hold` (authorized) / CREDIT `vendor_payable` (captured) / CREDIT `card` (remainder). Void returns the whole hold instead. Abandoned holds are reaped by `reapExpiredAuthorizations()` (`src/ledger/expiry.ts`) in two places: lazily at the top of every `authorize` call, so any vendor touching any card self-heals every stale hold in the system, and on the daily cron as the backstop. The lazy path is the primary one — a cron-only design would leave a member unable to spend their own money for up to 24 hours.
7. **Out.** `settlement_instructions` lists who is owed what. A human makes the transfers. `recordSettlement()` records that they did — DEBIT `vendor_payable` / CREDIT `cash_stripe`.

Chargebacks reverse against `donor_clearing` if still held, against `card_float` if already cleared. Card value is never clawed back; the pool carries the loss and `/api/cron/reconcile` logs an error when `card_float` goes negative.

## Deliberately absent

Restoration track. Member app, accounts, PINs. Offline sync engine — the policy instead is that the vendor writes the sale on paper and HOPE eats up to $100 per vendor of shortfall. Notification rules engine. Consent registry. Metering and invoicing. Stripe Connect. Multi-tenant RLS. Advocate lifecycle UI. Vendor management UI. Exception queue — the nightly cron logs at error level and the founder reads it. Containerised deploy.

Transaction history on the member view is absent for a different reason. It is a design rule, not a deferral: a history on a bearer page is a location trail on a vulnerable person, readable by anyone holding the card. The rule and its reasoning are in the header of `src/app/wallet/[code]/page.tsx`.

## Tensions

Listed, not resolved. Each is a real conflict between the spec and what is on disk.

1. **The end of the money path is not wired.** `reclaimCard`, `reissueCard` and `recordSettlement` have no callers outside `src/ledger/`. Step 7 above is implemented and specified but unreachable, and `/api/cards/[id]/invalidate` flips `cards.state` without reclaiming the balance — so the "same money on a new card" promise printed on the wallet page has nothing behind it yet.
2. **The lint rule guards table names, not the invariant.** `.eslintrc.json` blocks `.from('ledger_*')` and the RPC. It does not block `.from('cards').update({ balance_cents })`, which is exactly how the two ledger bypasses that were removed during this migration got written in the first place. Nothing violates the rule today; nothing prevents the next one.
3. **RLS exists but nothing exercises it.** Policies are written in `002_rls.sql` and tested in `supabase/tests/02_rls_policies.sql`, which CI does not run. Every live path uses the service-role client, so the policies never execute on a real request. Authorization is real, but it lives in route handlers.
4. **Five unauthenticated routes read a card by code or id**, and four of them mint a signed 5-minute card token: `/api/lookup/[code]`, `/api/cards/[id]/lookup`, `/api/cards/by-code/[code]/lookup`, `/api/wallet/apple/[id]`, `/api/wallet/google/[id]`. Only the first is called by any UI.
5. **Stripe Connect residue.** `charities.stripe_connect_account_id` and `merchants.stripe_connect_account_id` still exist, and `src/app/merchant/reconcile/page.tsx` tells vendors they are paid "via Stripe Connect" — which contradicts shape decision 7.
6. **The pilot codes are enumerable.** `generate_card_code()` produces 8 characters of Crockford base32, but the 50 seeded cards are `HMLT-0001`…`HMLT-0050`, and `validateCardCode()` accepts a 4-character suffix so they keep working.
7. **`credential_lookups` is written but never read.** The wallet page logs every lookup and `credential_lookup_pressure()` exists in `007`, but nothing calls it — the enumeration signal is collected and ignored. `weekly_reconciliation` likewise has no caller.
8. **`used_nonces` has no writer.** The table and its cleanup cron survive; the only code that inserted into it went out with the legacy redemption path. Replay protection on signed tokens is expiry-only.
