-- ═══════════════════════════════════════════════════════════════════════════
-- THE FIVE INVARIANTS
--
-- Scrappy Cut §3: "pgTAP suite of twelve invariants → Five, run in CI:
--   entries sum to zero; no negative balances; balances equal replay;
--   capture never exceeds authorization; no ledger row updated or deleted."
--
-- Each invariant is tested twice: once that the current database satisfies
-- it, and once that ATTEMPTING TO VIOLATE IT FAILS. The second is the one
-- that matters. A test asserting an empty result set passes vacuously on an
-- empty database and tells you nothing about whether the guard works.
--
-- Run with: supabase test db
-- ═══════════════════════════════════════════════════════════════════════════

begin;

select plan(23);

-- ── Fixtures ───────────────────────────────────────────────────────────────

create temporary table t_ids (k text primary key, v uuid);

do $$
declare
  v_city     uuid;
  v_charity  uuid;
  v_merchant uuid;
  v_card     uuid;
begin
  select id into v_city from cities limit 1;
  select id into v_charity from charities limit 1;
  select id into v_merchant from merchants limit 1;

  insert into cards (city_id, charity_id, card_code, state, balance_cents)
  values (v_city, v_charity, generate_card_code('TEST'), 'unloaded', 0)
  returning id into v_card;

  insert into t_ids values
    ('city', v_city), ('charity', v_charity),
    ('merchant', v_merchant), ('card', v_card),
    ('acct_card',  ledger_card_account(v_card)),
    ('acct_float', ledger_pooled_account('card_float')),
    ('acct_hold',  ledger_pooled_account('authorization_hold')),
    ('acct_vendor', ledger_vendor_account(v_merchant));
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- INVARIANT 1 — ENTRIES SUM TO ZERO
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from find_unbalanced_transactions()),
  0,
  'invariant 1: no existing transaction is unbalanced'
);

-- A balanced transaction posts cleanly.
select lives_ok(
  $$ select post_ledger_transaction(
       'card_activation',
       'pgtap-balanced-1',
       jsonb_build_array(
         jsonb_build_object('account_id', (select v from t_ids where k='acct_float'), 'amount_cents',  5000),
         jsonb_build_object('account_id', (select v from t_ids where k='acct_card'),  'amount_cents', -5000)
       )
     ) $$,
  'invariant 1: a balanced transaction is accepted'
);

-- An unbalanced one is rejected before any row is written.
select throws_ok(
  $$ select post_ledger_transaction(
       'adjustment',
       'pgtap-unbalanced-1',
       jsonb_build_array(
         jsonb_build_object('account_id', (select v from t_ids where k='acct_float'), 'amount_cents',  5000),
         jsonb_build_object('account_id', (select v from t_ids where k='acct_card'),  'amount_cents', -4999)
       )
     ) $$,
  'entries do not balance: sum is 1 (must be 0)',
  'invariant 1: an unbalanced transaction is rejected'
);

-- A single-sided transaction is not double-entry at all.
select throws_ok(
  $$ select post_ledger_transaction(
       'adjustment',
       'pgtap-single-sided',
       jsonb_build_array(
         jsonb_build_object('account_id', (select v from t_ids where k='acct_float'), 'amount_cents', 100)
       )
     ) $$,
  'double-entry requires at least 2 entries, got 1',
  'invariant 1: a single-entry transaction is rejected'
);

select is(
  (select count(*)::int from ledger_transactions where idempotency_key = 'pgtap-unbalanced-1'),
  0,
  'invariant 1: the rejected transaction left no header row behind'
);


-- ═══════════════════════════════════════════════════════════════════════════
-- INVARIANT 2 — NO NEGATIVE CARD BALANCES
--
-- Deliberately scoped to card accounts. card_float and donor_clearing MAY go
-- negative: a chargeback against already-cleared money is exactly that, and
-- the pool absorbing the loss is the intended behaviour.
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from find_negative_card_balances()),
  0,
  'invariant 2: no card account holds a negative balance'
);

-- Overspending a card drives its projection below zero, which the CHECK on
-- cards.balance_cents refuses.
select throws_ok(
  $$ select post_ledger_transaction(
       'capture',
       'pgtap-overspend',
       jsonb_build_array(
         jsonb_build_object('account_id', (select v from t_ids where k='acct_card'),   'amount_cents',  999900),
         jsonb_build_object('account_id', (select v from t_ids where k='acct_vendor'), 'amount_cents', -999900)
       )
     ) $$,
  '23514',
  null,
  'invariant 2: spending more than a card holds is refused by the balance check'
);


-- ═══════════════════════════════════════════════════════════════════════════
-- INVARIANT 3 — BALANCES EQUAL REPLAY
--
-- cards.balance_cents is a projection. This asserts it equals a replay of
-- the entries. If these ever diverge, the projection is wrong and the ledger
-- is right.
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from find_balance_drift()),
  0,
  'invariant 3: every card projection equals a replay of its entries'
);

select is(
  (select balance_cents from cards where id = (select v from t_ids where k='card')),
  5000,
  'invariant 3: the projection reflects the activation that was posted'
);

select is(
  (select balance_cents::int from ledger_balances where card_id = (select v from t_ids where k='card')),
  5000,
  'invariant 3: the ledger agrees with the projection'
);

-- Force drift the only way the app could cause it — a direct write outside
-- the ledger module — and confirm the invariant catches it.
update cards set balance_cents = 4200 where id = (select v from t_ids where k='card');

select is(
  (select count(*)::int from find_balance_drift()),
  1,
  'invariant 3: a projection written outside the ledger is detected as drift'
);

select is(
  (select delta_cents::int from find_balance_drift() limit 1),
  -800,
  'invariant 3: the drift report states the exact discrepancy'
);

-- Put it back so the remaining tests run against a consistent state.
update cards set balance_cents = 5000 where id = (select v from t_ids where k='card');


-- ═══════════════════════════════════════════════════════════════════════════
-- INVARIANT 4 — CAPTURE NEVER EXCEEDS AUTHORIZATION
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from find_over_captured_authorizations()),
  0,
  'invariant 4: no authorization has been over-captured'
);

insert into authorizations (
  card_id, merchant_id, authorized_cents, credential_kind, nonce, idempotency_key
) values (
  (select v from t_ids where k='card'),
  (select v from t_ids where k='merchant'),
  2500, 'paper_qr', 'pgtap-nonce-1', 'pgtap-auth-1'
);

select lives_ok(
  $$ update authorizations set captured_cents = 2500 where idempotency_key = 'pgtap-auth-1' $$,
  'invariant 4: capturing the full authorized amount is allowed'
);

select lives_ok(
  $$ update authorizations set captured_cents = 1800 where idempotency_key = 'pgtap-auth-1' $$,
  'invariant 4: a partial capture is allowed'
);

select throws_ok(
  $$ update authorizations set captured_cents = 2501 where idempotency_key = 'pgtap-auth-1' $$,
  '23514',
  null,
  'invariant 4: capturing one cent more than authorized is refused'
);

select throws_ok(
  $$ insert into authorizations (card_id, merchant_id, authorized_cents, captured_cents,
                                 credential_kind, nonce, idempotency_key)
     values ((select v from t_ids where k='card'), (select v from t_ids where k='merchant'),
             1000, 1001, 'paper_qr', 'pgtap-nonce-2', 'pgtap-auth-2') $$,
  '23514',
  null,
  'invariant 4: an over-captured authorization cannot be inserted either'
);


-- ═══════════════════════════════════════════════════════════════════════════
-- INVARIANT 5 — NO LEDGER ROW UPDATED OR DELETED
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from assert_append_only_guards() where not present),
  0,
  'invariant 5: every append-only guard is installed'
);

select throws_ok(
  $$ update ledger_entries set amount_cents = 1 where id = (select id from ledger_entries limit 1) $$,
  'ledger_entries is append-only: updates and deletes are not permitted',
  'invariant 5: a ledger entry cannot be updated'
);

select throws_ok(
  $$ delete from ledger_entries where id = (select id from ledger_entries limit 1) $$,
  'ledger_entries is append-only: updates and deletes are not permitted',
  'invariant 5: a ledger entry cannot be deleted'
);

select throws_ok(
  $$ update ledger_transactions set memo = 'tampered' where id = (select id from ledger_transactions limit 1) $$,
  'ledger_transactions is append-only: updates and deletes are not permitted',
  'invariant 5: a ledger transaction cannot be rewritten'
);


-- ═══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCY — replaying a key posts nothing and returns the original
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select post_ledger_transaction(
     'card_activation',
     'pgtap-balanced-1',
     jsonb_build_array(
       jsonb_build_object('account_id', (select v from t_ids where k='acct_float'), 'amount_cents',  5000),
       jsonb_build_object('account_id', (select v from t_ids where k='acct_card'),  'amount_cents', -5000)
     )
   )),
  (select id from ledger_transactions where idempotency_key = 'pgtap-balanced-1'),
  'idempotency: replaying a key returns the original transaction'
);

select is(
  (select balance_cents from cards where id = (select v from t_ids where k='card')),
  5000,
  'idempotency: the replay did not double the balance'
);

select * from finish();

rollback;
