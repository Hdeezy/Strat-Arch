-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 007 — INVARIANT CHECKS, RECONCILIATION, SETTLEMENT
--
-- The five invariants from Scrappy Cut §3, exposed as SQL functions so that
-- pgTAP, CI, and the nightly cron all check the same thing rather than three
-- similar things:
--
--   1. Entries sum to zero
--   2. No negative card balances
--   3. Balances equal replay
--   4. Capture never exceeds authorization
--   5. No ledger row updated or deleted
--
-- Plus the two views the thin admin needs: weekly reconciliation and the
-- settlement instruction set. Settlement produces instructions. Humans
-- execute payments. Nothing here calls a payout API.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Invariant 1: entries sum to zero ───────────────────────────────────────

create or replace function find_unbalanced_transactions()
returns table (transaction_id uuid, sum_cents bigint) as $$
  select e.transaction_id, sum(e.amount_cents)::bigint
    from ledger_entries e
   group by e.transaction_id
  having sum(e.amount_cents) <> 0;
$$ language sql stable security definer;


-- ── Invariant 2: no negative card balances ─────────────────────────────────
-- Scoped deliberately to account_type = 'card'. The float and the clearing
-- account MAY go negative: a chargeback against already-cleared money is
-- exactly that, and the pool absorbing it is the intended behaviour.

create or replace function find_negative_card_balances()
returns table (card_id uuid, balance_cents bigint) as $$
  select b.card_id, b.balance_cents
    from ledger_balances b
   where b.account_type = 'card'
     and b.balance_cents < 0;
$$ language sql stable security definer;


-- ── Invariant 3: projection equals replay ──────────────────────────────────

create or replace function find_balance_drift()
returns table (
  card_id         uuid,
  card_code       text,
  projected_cents bigint,
  replayed_cents  bigint,
  delta_cents     bigint
) as $$
  select
    c.id,
    c.card_code,
    c.balance_cents::bigint,
    coalesce(b.balance_cents, 0)::bigint,
    (c.balance_cents - coalesce(b.balance_cents, 0))::bigint
  from cards c
  left join ledger_balances b on b.card_id = c.id
  where c.balance_cents <> coalesce(b.balance_cents, 0);
$$ language sql stable security definer;


-- ── Invariant 4: capture never exceeds authorization ───────────────────────
-- Structurally impossible thanks to capture_within_authorization. Checked
-- anyway: an invariant you only enforce is an invariant you stop being able
-- to prove.

create or replace function find_over_captured_authorizations()
returns table (id uuid, authorized_cents integer, captured_cents integer) as $$
  select a.id, a.authorized_cents, a.captured_cents
    from authorizations a
   where a.captured_cents > a.authorized_cents;
$$ language sql stable security definer;


-- ── Invariant 5: no ledger row updated or deleted ──────────────────────────
-- Asserts the guards themselves are still in place. A dropped trigger is the
-- failure mode this catches — the absence of tampering evidence is not
-- evidence of absence unless the guard is known to be live.

create or replace function assert_append_only_guards()
returns table (guard_name text, present boolean) as $$
  select t.expected, (x.tgname is not null)
  from (values
    ('ledger_entries_no_update'),
    ('ledger_entries_no_delete'),
    ('ledger_transactions_no_update'),
    ('ledger_transactions_no_delete'),
    ('card_events_no_update'),
    ('card_events_no_delete')
  ) as t(expected)
  left join pg_trigger x on x.tgname = t.expected and not x.tgisinternal;
$$ language sql stable security definer;


-- ── One call that runs all five ────────────────────────────────────────────
-- Used by the nightly cron and by CI. Returns one row per invariant with a
-- pass/fail and the count of offending rows.

create or replace function check_ledger_invariants()
returns table (invariant text, passed boolean, offenders bigint) as $$
  select 'entries_sum_to_zero',        count(*) = 0, count(*) from find_unbalanced_transactions()
  union all
  select 'no_negative_card_balances',  count(*) = 0, count(*) from find_negative_card_balances()
  union all
  select 'balances_equal_replay',      count(*) = 0, count(*) from find_balance_drift()
  union all
  select 'capture_within_auth',        count(*) = 0, count(*) from find_over_captured_authorizations()
  union all
  select 'append_only_guards_present',
         bool_and(present),
         count(*) filter (where not present)
    from assert_append_only_guards();
$$ language sql stable security definer;


-- ───────────────────────────────────────────────────────────────────────────
-- WEEKLY RECONCILIATION
--
-- Scrappy Cut §2.6: "one weekly reconciliation view".
--
-- Three-way: what the ledger says was captured, what the vendor is owed, and
-- what has actually been settled. A non-zero outstanding column is a payment
-- someone still has to make.
-- ───────────────────────────────────────────────────────────────────────────

create or replace view weekly_reconciliation as
with weeks as (
  select
    date_trunc('week', t.occurred_at at time zone 'America/Toronto') as week_start,
    t.kind,
    e.account_id,
    e.amount_cents
  from ledger_transactions t
  join ledger_entries e on e.transaction_id = t.id
)
select
  w.week_start,
  -- Captured: value credited to vendor payable accounts this week.
  coalesce(sum(-w.amount_cents) filter (
    where w.kind = 'capture' and a.account_type = 'vendor_payable'
  ), 0)::bigint as captured_cents,
  -- Settled: value debited out of vendor payable accounts this week.
  coalesce(sum(w.amount_cents) filter (
    where w.kind = 'settlement' and a.account_type = 'vendor_payable'
  ), 0)::bigint as settled_cents,
  -- Donations that cleared into the float this week.
  coalesce(sum(-w.amount_cents) filter (
    where w.kind = 'donation_cleared' and a.account_type = 'card_float'
  ), 0)::bigint as cleared_in_cents,
  -- Value put onto cards this week.
  coalesce(sum(-w.amount_cents) filter (
    where w.kind = 'card_activation' and a.account_type = 'card'
  ), 0)::bigint as activated_cents
from weeks w
join ledger_accounts a on a.id = w.account_id
group by w.week_start
order by w.week_start desc;


-- ───────────────────────────────────────────────────────────────────────────
-- SETTLEMENT INSTRUCTIONS
--
-- Shape decision 7 and the RPAA boundary. This view is the deliverable: a
-- list of who is owed what. A human reads it, makes the transfers, and then
-- calls recordSettlement() to say they did.
--
-- No file in the settlement path may call a banking or payout API.
-- ───────────────────────────────────────────────────────────────────────────

create or replace view settlement_instructions as
select
  m.id            as merchant_id,
  m.name          as merchant_name,
  m.address       as merchant_address,
  m.payout_schedule_days,
  b.balance_cents as outstanding_cents,
  (
    select max(t.occurred_at)
      from ledger_transactions t
      join ledger_entries e2 on e2.transaction_id = t.id
     where e2.account_id = b.account_id
       and t.kind = 'settlement'
  ) as last_settled_at
from ledger_balances b
join merchants m on m.id = b.merchant_id
where b.account_type = 'vendor_payable'
  and b.balance_cents > 0
order by b.balance_cents desc;


-- ───────────────────────────────────────────────────────────────────────────
-- CREDENTIAL LOOKUP RATE LIMIT
--
-- Scrappy Cut §3a control 2: log and alert, do NOT silently block. A member
-- checking their own balance repeatedly is normal and must never be denied.
-- What is abnormal is one source enumerating many DIFFERENT cards without a
-- redemption following — that is someone other than the member.
--
-- Returns the number of distinct cards this source has looked up in the
-- window. The caller decides what to do with it.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function credential_lookup_pressure(
  p_source_hash text,
  p_window interval default interval '1 hour'
)
returns table (distinct_cards bigint, total_lookups bigint) as $$
  select
    count(distinct card_id)::bigint,
    count(*)::bigint
  from credential_lookups
  where source_hash = p_source_hash
    and looked_up_at > now() - p_window;
$$ language sql stable security definer;


-- ───────────────────────────────────────────────────────────────────────────
-- AUTHORIZATION EXPIRY
--
-- Open authorizations hold value that the member cannot spend. If a vendor
-- opens one and never captures — the sale fell through, the phone died, the
-- app was closed — the hold must come back automatically or the card is
-- quietly broken until someone notices.
--
-- Called by the clearance cron. Returns the rows it reaped so the caller can
-- post the matching void transactions through the ledger module.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function expire_stale_authorizations()
returns table (id uuid, card_id uuid, authorized_cents integer) as $$
  update authorizations
     set status = 'expired', closed_at = now()
   where status = 'open'
     and expires_at < now()
  returning authorizations.id, authorizations.card_id, authorizations.authorized_cents;
$$ language sql volatile security definer;


grant select on weekly_reconciliation    to service_role;
grant select on settlement_instructions  to service_role;
revoke all on weekly_reconciliation      from anon, authenticated;
revoke all on settlement_instructions    from anon, authenticated;
