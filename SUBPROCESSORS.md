# SUBPROCESSORS

Committed register of every third party that processes personal data on
HOPE's behalf.

**Rule, from Stack Decision Record §4 rule 5:** this file is updated in the
same pull request that adds a third-party dependency processing any personal
data. No exceptions.

**Status: DRAFT.** Compiled from the codebase on 2026-07-31. It has not been
reconciled against the actual deployed integrations or reviewed by counsel,
and must be before it is shown to a funder, a board, or a partner agency.

---

## What personal data exists at all

Shape decision 8 is the reason this register is short. HOPE collects nothing
that requires consent machinery: no member profiles, no photos, no stories,
no clinical or narrative fields, no member-identifiable donor attribution.

The personal data that does exist:

| Data | Subject | Where |
|---|---|---|
| Email address | Donors, staff, vendors | Supabase Auth, Stripe |
| Name and phone | Advocates, staff | `profiles`, `advocates` |
| Donor note (≤140 chars, free text) | Written by a donor, read at redemption | `donations.donor_note` |
| Card code and balance | Bearer — **not linked to a named person** | `cards` |
| Salted source hash (IP + UA) | Whoever loads a balance page | `credential_lookups` |

**Members are not in this table by name.** A card is a bearer instrument. The
system does not know who holds one, which is why a subject access request at
this scope is a SQL query rather than a subsystem.

---

## Register

| Processor | Purpose | Data | Processing location | Status |
|---|---|---|---|---|
| **Supabase** | Postgres, Auth | All of the above | **Must be `ca-central-1`** | ⚠️ **Region unverified — see DECISIONS.md** |
| **Vercel** | Application hosting, cron | Request data in transit; logs | Functions pinned to `yul1` (Montreal) | ✅ Pinned 2026-07-31 |
| **Stripe** | Donation processing | Donor email, card details, payment metadata | US / global | ✅ Foundation's own account, no Connect |
| **Sentry** | Error monitoring | Stack traces | US | ❌ **Not yet integrated.** Register before enabling, and ship the member-identifier scrubber in the same PR. |
| **Postmark / Resend** | Transactional email | Recipient address | US | ❌ **Not yet integrated.** One notification template is in scope for Sprint 3. |
| **Google Wallet** | Optional pass | Card code, balance | US | ⚠️ Route exists, returns 503 unless configured |
| **Apple Wallet** | Optional pass | Card code, balance | US | ⚠️ Route exists, returns 503 unless configured |

**Analytics: none.** No processor with any member identifier. Plausible or
nothing, per Stack Decision Record §3. The cross-border processing inventory
is short on purpose.

---

## Before launch

1. **Verify the Supabase project region is `ca-central-1`.** Everything else
   in this register is moot if the database is not in Canada. A move means a
   new project and a full data migration, which is survivable now and is not
   survivable once real money has moved.
2. Register Sentry and the email provider as subprocessors **on the day they
   are integrated**, not afterwards.
3. Confirm the Stripe account is the Foundation's own, on a restricted API
   key, with no Connect platform relationship.
4. Have counsel review this register alongside the questions in the tap memo
   §7.
