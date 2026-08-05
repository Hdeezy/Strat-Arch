# LEDGER SPEC

**Status:** implemented in `supabase/migrations/005_ledger.sql` and `src/ledger/`.
**Governing document:** HOPE MVP, The Scrappy Cut §1 shape decision 1, §2.1, §3.

This is the one Sprint 0 document the Scrappy Cut says earns its time. Every
transaction kind the system can produce is here with the exact rows it
writes, its idempotency key, the resulting balance change, and its failure
case.

---

## 0. THE RULES

**Sign convention.** `amount_cents` is a signed integer. Positive is a
**debit**, negative is a **credit**. The entries of a transaction always sum
to exactly zero. This is enforced three times: in `post()` before the call,
in `post_ledger_transaction()` before any row is written, and by a deferred
constraint trigger at commit.

**Reading a balance.** Never sum `ledger_entries` by hand. Read
`ledger_balances`, which flips the sign for credit-normal accounts so every
balance is positive in its own terms. `cards.balance_cents` is a projection
of the same number, maintained inside the same database transaction, and
asserted equal by invariant 3.

**Append-only.** No ledger row is ever updated or deleted. `UPDATE` and
`DELETE` are revoked from `anon`, `authenticated`, and `service_role` in
migration 006, and blocked again by triggers. A mistake is corrected by
posting a compensating `adjustment`, which is itself permanent.

**Idempotency.** Every transaction carries a key, unique at the database
level, derived from the natural identity of the event — never from a value
generated at call time. Replaying a key returns the original transaction and
writes nothing. This is what makes a retried Stripe webhook, a double-tapped
Charge button, and a late offline sync safe by construction rather than by
care.

### Accounts

| Account | Normal | Meaning |
|---|---|---|
| `cash_stripe` | debit | Cash held at Stripe on the Foundation's own account |
| `donor_clearing` | credit | Donations received, inside the clearance hold |
| `card_float` | credit | Cleared funds, available to activate cards |
| `card` (per card) | credit | Value held on one specific card |
| `authorization_hold` | credit | Value held against open authorizations |
| `vendor_payable` (per vendor) | credit | Captured value owed to one vendor |
| `reclaimed` | credit | Value pulled off invalidated cards, awaiting reissue |

---

## 1. `donation_received`

Cash arrived at Stripe. It is **not yet spendable**.

**Trigger:** `payment_intent.succeeded` webhook.
**Key:** `donation:{payment_intent_id}`

| Account | Amount |
|---|---|
| `cash_stripe` | `+2000` |
| `donor_clearing` | `-2000` |

*A $20 gift. `cash_stripe` rises to 2000. `donor_clearing` rises to 2000
(credit-normal, so the −2000 entry reads as +2000 owed into the programme).
No card balance changes. No card becomes spendable.*

**Why value does not go straight onto the card.** A chargeback three days
later would otherwise kill a card in someone's pocket. Routing every gift
through a pooled clearance means the reversal lands on the pool.

**Failure cases**
- *Stripe retries the webhook.* Same key → returns the original transaction,
  writes nothing. The `donations` row insert is separately guarded by a
  lookup on `stripe_payment_intent_id`.
- *Metadata missing `card_id` or `amount_cents`.* Handler breaks before
  posting. Nothing is written. The payment is visible in Stripe and is
  reconciled by hand — a deliberate loud failure rather than a guess.
- *Ledger post throws.* Route returns 500, Stripe retries, the key makes the
  retry safe.

---

## 2. `donation_cleared`

The clearance window elapsed. Value joins the spendable float.

**Trigger:** `/api/cron/clearance`, hourly. Anonymous gifts serve 72 hours;
identified donors clear immediately.
**Key:** `clear:{donation_id}`

| Account | Amount |
|---|---|
| `donor_clearing` | `+2000` |
| `card_float` | `-2000` |

*`donor_clearing` falls to 0. `card_float` rises to 2000. Cards can now be
activated against it.* `donations.cleared_at` is stamped in the same call.

**Failure cases**
- *Cron runs twice.* Same key → no-op.
- *Donation already reversed.* The cron filters on `reversed_at is null`, so
  a reversed gift never clears.
- *One donation in a batch throws.* Recorded in the `errors` array; the rest
  of the batch still clears. Errors are logged at error level.

---

## 3. `chargeback_reversal`

The network reversed a donation. Two shapes depending on how far the value
got.

**Trigger:** `charge.dispute.created` or `charge.refunded`.
**Key:** `reverse:{stripe_event_id}` — keyed to the event, not the donation,
because one donation can be partially refunded more than once.

**3a. Still in clearance** (`cleared_at is null`)

| Account | Amount |
|---|---|
| `donor_clearing` | `+2000` |
| `cash_stripe` | `-2000` |

*Clean. Nothing had become spendable. No programme value is affected.*

**3b. Already cleared**

| Account | Amount |
|---|---|
| `card_float` | `+2000` |
| `cash_stripe` | `-2000` |

*The float absorbs it and may go negative. That is correct and intended.*

**The card is not touched.** A person does not lose their groceries because
a donor's bank reversed a charge. Invariant 2 is deliberately scoped to
`account_type = 'card'` so the float is permitted to go negative; the nightly
reconciliation logs a negative float at error level because somebody has to
know the pool is carrying a loss.

**Failure cases**
- *Duplicate dispute events.* Same event id → same key → no-op.
- *Donation not found.* No-op; the payment intent was not ours.
- *Already reversed.* Guarded on `reversed_at`.

---

## 4. `card_activation`

Cleared float is assigned to a specific card. **This is the moment a card
becomes spendable.**

**Key:** `activate:{card_id}:{funding_ref}` — includes the funding reference
so a card can be re-activated after reissue without colliding.

| Account | Amount |
|---|---|
| `card_float` | `+2000` |
| `card:{id}` | `-2000` |

*`card_float` falls to 0. The card account rises to 2000.
`post_ledger_transaction()` refreshes `cards.balance_cents` to 2000 and moves
`state` from `unloaded` to `active`, in the same database transaction.*

**Failure cases**
- *Float has less than the activation amount.* The post **succeeds** and
  drives `card_float` negative. This is a deliberate choice: refusing to
  activate would mean an advocate standing in front of a person, unable to
  hand them a working card, because of an accounting timing question. The
  negative float is caught by the nightly job and is a funding problem, not
  a counter problem.
- *Replayed activation.* Same key → no-op. Invariant test 23 asserts the
  balance does not double.

---

## 5. `authorization_hold`

Phase one of redemption. The vendor scanned; this reserves the room.

**Key:** `auth:{authorization_id}`

| Account | Amount |
|---|---|
| `card:{id}` | `+2000` |
| `authorization_hold` | `-2000` |

*The card's spendable balance drops to 0 immediately, so a second terminal
cannot authorize the same value. Nothing is owed to the vendor yet.*

An `authorizations` row is written first, carrying `authorized_cents`,
`credential_kind`, and a 15-minute `expires_at`.

**Amount authorized is always the full room today** — `min(balance, daily cap
remaining)` — not an amount the vendor typed. The vendor captures what they
actually ring.

**Failure cases**
- *Card not `active`.* Returns `{authorized: false, reason: 'card_<state>'}`
  with HTTP 200. Nothing posted.
- *Category gate fails.* `category_not_allowed`. A genuine decline: no
  amount would work here.
- *Room is zero.* `no_room_today`, with the reset time in the UI copy. Never
  "insufficient funds".
- *Duplicate idempotency key.* Returns the existing authorization with
  `replayed: true`.

---

## 6. `capture`

Phase two. The vendor rang $4.25 against a $20 authorization.

**Key:** `capture:{authorization_id}`

| Account | Amount |
|---|---|
| `authorization_hold` | `+2000` |
| `vendor_payable:{merchant}` | `-425` |
| `card:{id}` | `-1575` |

*One atomic transaction, three entries. The hold empties. The vendor is owed
$4.25. $15.75 is back on the card before the member has walked away.*

When the capture is full, the third entry is omitted and the transaction has
two entries.

`authorizations.captured_cents` and `status = 'captured'` are written after
the post. `cards.spent_today_cents` is advanced by the **captured** amount,
not the authorized amount — the daily cap tracks what was spent.

**Failure cases**
- *Capture exceeds authorization.* Refused three times over: at the route
  (422 with `room_cents`), in `captureAuthorization()`, and by the
  `capture_within_authorization` CHECK on the row. Invariant tests 16 and 17.
- *Authorization already captured.* Returns the original outcome with
  `replayed: true`. Captures nothing more.
- *Authorization expired or voided.* HTTP 409.
- *Different merchant than the one that opened it.* HTTP 403.
- *Card balance would go negative.* The `balance_cents >= 0` CHECK on `cards`
  aborts the whole transaction. Invariant test 7.

---

## 7. `authorization_void`

The hold is released unspent.

**Key:** `void:{authorization_id}`

| Account | Amount |
|---|---|
| `authorization_hold` | `+2000` |
| `card:{id}` | `-2000` |

*The card is exactly as it was.*

Two callers: the vendor pressing cancel, and the hourly cron reaping
authorizations past `expires_at` via `expire_stale_authorizations()`. Both
route through the same ledger function.

**Why the cron matters:** without it, a vendor who opens a hold and then
closes their phone leaves a card quietly unusable until somebody notices.

**Failure case**
- *Void after capture.* `status !== 'open'` → returns `replayed: true`,
  posts nothing. Void and capture are mutually exclusive outcomes and their
  keys differ, so neither can undo the other.

---

## 8. `invalidation_reclaim`

A card was reported lost or stolen.

**Key:** `reclaim:{card_id}`

| Account | Amount |
|---|---|
| `card:{id}` | `+1575` |
| `reclaimed` | `-1575` |

*The card drops to 0. The value is held for reissue. Returns `null` without
posting if the balance is already zero.*

---

## 9. `reissue`

Reclaimed value goes onto a replacement card.

**Key:** `reissue:{to_card_id}`

| Account | Amount |
|---|---|
| `reclaimed` | `+1575` |
| `card:{new_id}` | `-1575` |

*`cards.reissued_from_card_id` links the two, so chain of custody survives
the swap.*

**Failure case**
- *Reissue before reclaim.* Drives `reclaimed` negative. Not blocked, but
  visible: the nightly job reports it.

---

## 10. `settlement`

**This records that a human already paid. It does not pay.**

**Key:** `settle:{merchant_id}:{period_end}`

| Account | Amount |
|---|---|
| `vendor_payable:{merchant}` | `+425` |
| `cash_stripe` | `-425` |

*The payable clears. Cash leaves.*

Shape decision 7 and the RPAA boundary. `/api/cron/settlement` reads
`settlement_instructions` and produces a list. A person makes the transfers
and then records them. No file in this path may call a banking or payout
API — enforced by a lint rule on `.payouts` and `.transfers`.

---

## 11. `adjustment`

A manual correction, or an opening balance.

**Key:** `adjust:{human_supplied_ref}` — human-supplied so two admins cannot
apply the same fix twice.

Used once automatically: migration 005 backfills every pre-ledger card
balance as `opening-balance:{card_id}`, debiting `card_float` and crediting
the card. Without that backfill, invariant 3 fails on day one and the
ledger's central claim — that balances equal replay — is false from the
start.

Always carries a memo. There is no "edit the ledger" path.

---

## 12. OFFLINE CAPTURE, SYNCED LATE

The Scrappy Cut cuts the offline sync engine and replaces it with a policy:
the vendor writes the sale on paper and enters it later, and HOPE absorbs any
shortfall up to $100 per vendor.

**What the ledger does about it: nothing special, and that is the point.**

A late entry is an ordinary authorize-then-capture posted at the time it is
entered. It is not backdated. `occurred_at` is when the ledger learned of it,
which is the honest record.

**The shortfall case:** the member spent the card down between the paper sale
and the entry, so the authorization now finds less room than the paper slip
says. The vendor captures what is actually there. The difference is the
shortfall HOPE has agreed to absorb, and it is settled outside the ledger
against the vendor agreement's $100 cap.

**Track how often this fires.** The Scrappy Cut §8 names this as the weak
point of the whole cut: *"If it fires more than twice in the pilot, that is
the signal to build it properly."*

---

## 13. THE FIVE INVARIANTS

Implemented in `supabase/tests/04_ledger_invariants.sql`, 23 assertions, run
in CI. Each is tested twice: that the database satisfies it, and **that
attempting to violate it fails**. The second matters more — a test asserting
an empty result set passes vacuously on an empty database.

| # | Invariant | Structural enforcement | Detection |
|---|---|---|---|
| 1 | Entries sum to zero | Deferred constraint trigger + pre-flight in `post_ledger_transaction()` | `find_unbalanced_transactions()` |
| 2 | No negative card balances | `CHECK (balance_cents >= 0)` on `cards` | `find_negative_card_balances()` |
| 3 | Balances equal replay | — (this is the detection) | `find_balance_drift()` |
| 4 | Capture ≤ authorization | `CHECK (captured_cents <= authorized_cents)` | `find_over_captured_authorizations()` |
| 5 | No ledger row updated or deleted | Grants + triggers | `assert_append_only_guards()` |

`check_ledger_invariants()` runs all five and returns one row each. The
nightly cron calls it, and independently runs `replayAndCompare()` in
application code so a bug in the SQL views cannot mark itself healthy.

**Invariant 3 is the one with no structural enforcement.** The projection is
maintained by a `SECURITY DEFINER` function, which means a sufficiently
determined direct `UPDATE cards SET balance_cents` would drift it. Migration
006 documents why a column-level revoke was not used. Detection within 24
hours is the accepted control, and it is recorded as a known gap in
DECISIONS.md.

---

## 14. WORKED END-TO-END

Verified against Postgres 16 with the full migration chain applied:

```
1. Donation $20 received.        card balance = 0     (not yet spendable)
2. Cleared into float.           card_float   = 2000
3. Card activated.               card balance = 2000  state = active
4. Authorized $20.               card balance = 0     (held)
5. Captured $1.                  card balance = 1900
                                 vendor owed  = 100
                                 hold         = 0

check_ledger_invariants():
  entries_sum_to_zero          pass
  no_negative_card_balances    pass
  balances_equal_replay        pass
  capture_within_auth          pass
  append_only_guards_present   pass

settlement_instructions:
  541 Eatery & Exchange        100
```
